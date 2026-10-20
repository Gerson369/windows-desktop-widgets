using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class GersonDesktopLeaseFixture
{
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window, uint command);
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static void Assert(bool condition, string message) { if (!condition) throw new Exception(message); }
    static string Line(Process process)
    {
        var reading = System.Threading.Tasks.Task.Factory.StartNew(() => process.StandardOutput.ReadLine());
        var deadline = DateTime.UtcNow.AddSeconds(8);
        while (!reading.IsCompleted && DateTime.UtcNow < deadline) { Application.DoEvents(); Thread.Sleep(10); }
        Assert(reading.IsCompleted, "Fixture response timed out.");
        return reading.Result;
    }
    static bool Exited(Process process, int milliseconds)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(milliseconds);
        while (!process.HasExited && DateTime.UtcNow < deadline) { Application.DoEvents(); Thread.Sleep(10); }
        return process.HasExited;
    }
    static Process Worker(string executable)
    {
        var worker = Process.Start(new ProcessStartInfo(executable, "worker") { UseShellExecute = false, RedirectStandardOutput = true, CreateNoWindow = true });
        return worker;
    }
    static void Request(string file, IntPtr widget, bool stop)
    {
        File.WriteAllText(file, Json.Serialize(new { Windows = new long[] { widget.ToInt64() }, Collect = true, Stop = stop }));
    }
    static Process Guardian(string bridge, int owner, string file, IntPtr host, IntPtr icons)
    {
        return Process.Start(new ProcessStartInfo(bridge, owner + " \"" + file + "\" " + host.ToInt64() + " " + icons.ToInt64()) { UseShellExecute = false, RedirectStandardOutput = true, CreateNoWindow = true });
    }
    [STAThread] static int Main(string[] args)
    {
        try
        {
            if (args.Length == 1 && args[0] == "worker")
            {
                var window = new Form { Width = 280, Height = 160, Opacity = 0, ShowInTaskbar = false };
                window.Shown += delegate { Console.WriteLine(window.Handle.ToInt64()); Console.Out.Flush(); };
                Application.Run(window); return 0;
            }
            string bridge = Path.GetFullPath(args[0]);
            string file = Path.Combine(Path.GetTempPath(), "gerson-desktop-lease-fixture-" + Process.GetCurrentProcess().Id + ".json");
            using (var host = new Form { Opacity = 0, ShowInTaskbar = false })
            using (var icons = new ListView { Dock = DockStyle.Fill })
            {
                host.Controls.Add(icons); host.Show(); Application.DoEvents();
                IntPtr originalIcons = icons.Handle;
                var worker = Worker(Application.ExecutablePath);
                try
                {
                    IntPtr widget = new IntPtr(Int64.Parse(Line(worker)));
                    IntPtr previousOwner = GetWindow(widget, 4);
                    icons.Hide(); Application.DoEvents();
                    Request(file, widget, false);
                    using (var guard = Guardian(bridge, worker.Id, file, host.Handle, originalIcons))
                    {
                        string ready = Line(guard);
                        Assert(ready.Contains("\"collected\":true"), "Collection did not become ready: " + ready);
                        Assert(!IsWindowVisible(originalIcons), "Original icons remained visible.");
                        Assert(GetWindow(widget, 4) == host.Handle, "Widget was not attached to desktop owner.");
                        Request(file, widget, true);
                        Assert(Exited(guard, 5000), "Graceful release timed out.");
                        Assert(guard.ExitCode == 0 && IsWindowVisible(originalIcons), "Graceful release did not restore icons.");
                        Assert(GetWindow(widget, 4) == previousOwner, "Widget owner was not restored.");
                    }
                    icons.Hide(); Application.DoEvents();
                    Request(file, widget, false);
                    using (var guard = Guardian(bridge, worker.Id, file, host.Handle, originalIcons))
                    {
                        string ready = Line(guard);
                        Assert(ready.Contains("\"collected\":true"), "Second collection failed.");
                        worker.Kill(); worker.WaitForExit();
                        Assert(Exited(guard, 5000), "Crash recovery timed out.");
                        Assert(guard.ExitCode == 0 && IsWindowVisible(originalIcons), "Owner crash did not restore icons.");
                    }
                }
                finally { if (!worker.HasExited) worker.Kill(); worker.Dispose(); }
                var next = Worker(Application.ExecutablePath);
                try
                {
                    IntPtr widget = new IntPtr(Int64.Parse(Line(next)));
                    IntPtr originalOwner = GetWindow(widget, 4);
                    File.WriteAllText(file, Json.Serialize(new { Windows = new long[] { widget.ToInt64(), 0 }, Collect = true, Stop = false }));
                    using (var guard = Guardian(bridge, next.Id, file, host.Handle, originalIcons))
                    {
                        Assert(Exited(guard, 5000), "Invalid-window rejection timed out.");
                        Assert(guard.ExitCode == 1 && IsWindowVisible(originalIcons), "Invalid window list must not hide icons.");
                        Assert(GetWindow(widget, 4) == originalOwner, "Validation mutated a valid widget before rejecting the list.");
                    }
                }
                finally { if (!next.HasExited) next.Kill(); next.Dispose(); }
                host.Close();
            }
            File.Delete(file);
            Console.WriteLine("{\"ok\":true,\"checks\":[\"collect hides original view\",\"desktop ownership\",\"release repairs initially hidden view and ownership\",\"owner crash repairs initially hidden view\",\"invalid windows fail before mutation\"]}");
            return 0;
        }
        catch (Exception error) { Console.WriteLine(error.ToString()); return 1; }
    }
}
