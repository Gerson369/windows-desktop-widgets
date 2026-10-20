using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;

internal static partial class DesktopHostBridge
{
    internal delegate bool EnumCallback(IntPtr window, IntPtr state);
    [DllImport("user32.dll")] internal static extern bool EnumWindows(EnumCallback callback, IntPtr state);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string className, string title);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern int GetClassName(IntPtr window, System.Text.StringBuilder text, int size);
    [DllImport("user32.dll")] internal static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] internal static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] internal static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] internal static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll", SetLastError = true)] internal static extern IntPtr SetWindowLongPtr(IntPtr window, int index, IntPtr value);
    [DllImport("user32.dll")] internal static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] internal static extern IntPtr GetWindowLongPtr(IntPtr window, int index);
    [DllImport("user32.dll")] internal static extern IntPtr GetParent(IntPtr window);
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

    public sealed class LeaseRequest
    {
        public long[] Windows { get; set; }
        public bool Collect { get; set; }
        public bool Stop { get; set; }
    }

    internal sealed class DesktopSurface
    {
        internal IntPtr Host;
        internal IntPtr Icons;
        internal DesktopSurface(IntPtr host, IntPtr icons) { Host = host; Icons = icons;  }
        internal void Restore()
        {
            if (!IsWindow(Icons)) { FindDesktop().Restore(); return; }
            ShowWindow(Icons, 8);
            if (!IsWindowVisible(Icons)) throw new InvalidOperationException("Desktop icons could not be restored.");
        }
    }

    static DesktopSurface FindDesktop()
    {
        DesktopSurface result = null;
        EnumWindows(delegate(IntPtr window, IntPtr state) {
            var name = new System.Text.StringBuilder(64);
            GetClassName(window, name, name.Capacity);
            if (name.ToString() != "Progman" && name.ToString() != "WorkerW") return true;
            var view = FindWindowEx(window, IntPtr.Zero, "SHELLDLL_DefView", null);
            var icons = FindWindowEx(view, IntPtr.Zero, "SysListView32", null);
            if (view == IntPtr.Zero || icons == IntPtr.Zero) return true;
            result = new DesktopSurface(window, icons);
            return false;
        }, IntPtr.Zero);
        if (result == null) throw new InvalidOperationException("Windows desktop is unavailable.");
        return result;
    }

    internal sealed class DesktopLease : IDisposable
    {
        readonly uint ownerId;
        readonly DesktopSurface surface;
        readonly Dictionary<IntPtr, IntPtr> previousOwners = new Dictionary<IntPtr, IntPtr>();
        internal DesktopLease(uint owner, DesktopSurface desktop) { ownerId = owner; surface = desktop; }
        internal void Apply(LeaseRequest request)
        {
            if (request.Windows == null || request.Windows.Length == 0 || request.Windows.Length > 32) throw new InvalidOperationException("No ready desktop widgets.");
            var wanted = new HashSet<IntPtr>();
            foreach (long value in request.Windows)
            {
                var window = new IntPtr(value);
                uint processId;
                GetWindowThreadProcessId(window, out processId);
                if (!IsWindow(window) || processId != ownerId) throw new InvalidOperationException("A desktop widget is unavailable.");
                wanted.Add(window);
            }
            // Validate every window before changing either ownership or icon visibility.
            foreach (var window in wanted)
            {
                if (previousOwners.ContainsKey(window)) continue;
                if (!IsWindowVisible(window)) throw new InvalidOperationException("A widget is not ready.");
                previousOwners.Add(window, GetWindow(window, 4));
                SetWindowLongPtr(window, -8, surface.Host);
                if (GetWindow(window, 4) != surface.Host) throw new InvalidOperationException("Cannot attach widget to desktop owner.");
                SetWindowPos(window, new IntPtr(1), 0, 0, 0, 0, 0x13);
            }
            foreach (var window in new List<IntPtr>(previousOwners.Keys))
            {
                if (wanted.Contains(window)) continue;
                if (IsWindow(window)) SetWindowLongPtr(window, -8, previousOwners[window]);
                previousOwners.Remove(window);
            }
            bool visible = !request.Collect;
            if (IsWindowVisible(surface.Icons) != visible) ShowWindow(surface.Icons, visible ? 8 : 0);
            if (request.Collect && IsWindowVisible(surface.Icons)) throw new InvalidOperationException("Windows desktop icons are still visible.");
        }
        public void Dispose()
        {
            foreach (var item in previousOwners) if (IsWindow(item.Key)) SetWindowLongPtr(item.Key, -8, item.Value);
            previousOwners.Clear();
            surface.Restore();
        }
    }

    static int WatchOwner(int ownerId)
    {
        try { using (var owner = Process.GetProcessById(ownerId)) owner.WaitForExit(); }
        catch (ArgumentException) { /* Owner already exited before the watcher started. */ }
        using (var mutex = new Mutex(false, "Local\\GersonDesktopLease"))
        {
            bool acquired;
            try { acquired = mutex.WaitOne(5000); }
            catch (AbandonedMutexException) { acquired = true; }
            if (!acquired) return 0;
            try {
                for (int attempt = 0; attempt < 40; attempt++) {
                    try { FindDesktop().Restore(); return 0; }
                    catch (InvalidOperationException) { Thread.Sleep(250); }
                }
                return 1;
            } finally { mutex.ReleaseMutex(); }
        }
    }

    [STAThread]
    static int Main(string[] args)
    {
        try
        {
            if(args.Length==2 && args[0]=="watch-owner") return WatchOwner(Int32.Parse(args[1]));
            if(args.Length==2 && args[0]=="watch-desktop") return WatchDesktopClicks(Int32.Parse(args[1]));
            if(args.Length==1 && args[0]=="gesture-self-test") { CheckGestureTiming(); return 0; }
            if(args.Length==2 && args[0]=="icon") { PrintShellIcon(args[1]); return 0; }
            if(args.Length==3 && args[0]=="icon") { PrintShellIcon(args[1],Int32.Parse(args[2])); return 0; }
            if(args.Length==2 && args[0]=="thumbnail") { PrintThumbnail(args[1]); return 0; }
            if(args.Length==3 && args[0]=="desktop-point") {
                Console.WriteLine(Json.Serialize(new {ok=true,blank=BlankDesktopPoint(new MousePoint {X=Int32.Parse(args[1]),Y=Int32.Parse(args[2])})})); return 0;
            }
            if (args.Length == 2 && args[0] == "restore" && (args[1] == "0" || args[1] == "1"))
            {
                var desktop = FindDesktop();
                bool visible = args[1] == "1";
                ShowWindow(desktop.Icons, visible ? 8 : 0);
                if (IsWindowVisible(desktop.Icons) != visible) throw new InvalidOperationException("Desktop visibility was not restored.");
                Console.WriteLine(Json.Serialize(new { ok = true, restored = true }));
                return 0;
            }
            if (args.Length > 0 && args[0] == "status")
            {
                var desktop = FindDesktop();
                var windows = new List<object>();
                int processId;
                if (args.Length > 1 && Int32.TryParse(args[1], out processId))
                {
                    EnumWindows(delegate(IntPtr window, IntPtr state) {
                        uint id; GetWindowThreadProcessId(window, out id);
                        if (id == processId && IsWindowVisible(window)) windows.Add(new { handle = window.ToInt64(), owner = GetWindow(window, 4).ToInt64() });
                        return true;
                    }, IntPtr.Zero);
                }
                var name = new System.Text.StringBuilder(64); GetClassName(desktop.Host, name, name.Capacity);
                Console.WriteLine(Json.Serialize(new { ok = true, iconViewVisible = IsWindowVisible(desktop.Icons), iconStyleVisible = (GetWindowLongPtr(desktop.Icons, -16).ToInt64() & 0x10000000) != 0, viewVisible = IsWindowVisible(GetParent(desktop.Icons)), hostVisible = IsWindowVisible(desktop.Host), host = desktop.Host.ToInt64(), hostClass = name.ToString(), windows }));
                return 0;
            }
            if (args.Length < 2) throw new ArgumentException("Owner PID and request file are required.");
            int ownerId;
            if (!Int32.TryParse(args[0], out ownerId) || ownerId <= 0) throw new ArgumentException("Owner PID is invalid.");
            string file = Path.GetFullPath(args[1]);
            bool test = args.Length == 4;
            DesktopSurface surface;
            if (test)
            {
                var host = new IntPtr(Int64.Parse(args[2]));
                var icons = new IntPtr(Int64.Parse(args[3]));
                uint hostOwner, iconOwner;
                GetWindowThreadProcessId(host, out hostOwner); GetWindowThreadProcessId(icons, out iconOwner);
                if (hostOwner != iconOwner || Process.GetProcessById((int)hostOwner).ProcessName != "GersonDesktopLeaseFixture") throw new ArgumentException("Test windows must belong to the owner process.");
                surface = new DesktopSurface(host, icons);
            }
            else surface = FindDesktop();
            using (var owner = Process.GetProcessById(ownerId))
            using (var mutex = new Mutex(false, test ? "Local\\GersonDesktopTestLease-" + ownerId : "Local\\GersonDesktopLease"))
            {
                if (!mutex.WaitOne(0)) throw new InvalidOperationException("Desktop collection is already active in another instance.");
                try
                {
                    using (var lease = new DesktopLease((uint)ownerId, surface))
                    {
                        string previous = null;
                        while (!owner.WaitForExit(150))
                        {
                            if (!IsWindow(surface.Host) || !IsWindow(surface.Icons)) throw new InvalidOperationException("Windows desktop restarted; collection stopped.");
                            string text;
                            try {
                                // Requests are replaced atomically; keep the reader from locking that replacement.
                                using (var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                                using (var reader = new StreamReader(stream)) text = reader.ReadToEnd();
                            } catch (IOException) { continue; }
                            var request = Json.Deserialize<LeaseRequest>(text);
                            if (request == null) throw new InvalidOperationException("Invalid desktop request.");
                            if (request.Stop) break;
                            lease.Apply(request);
                            if (text != previous)
                            {
                                Console.WriteLine(Json.Serialize(new { ok = true, collected = request.Collect, windows = request.Windows.Length }));
                                Console.Out.Flush();
                                previous = text;
                            }
                        }
                    }
                }
                finally { mutex.ReleaseMutex(); }
            }
            Console.WriteLine(Json.Serialize(new { ok = true, restored = true }));
            return 0;
        }
        catch (Exception error)
        {
            Console.WriteLine(Json.Serialize(new { ok = false, error = error.Message }));
            return 1;
        }
    }
}
