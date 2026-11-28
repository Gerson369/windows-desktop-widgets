using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class Program {
    private static void WriteStatus(string path, string message) {
        File.WriteAllText(path + ".tmp", message, new UTF8Encoding(false));
        File.Move(path + ".tmp", path);
    }

    private static Process StartExecutable(string path) {
        return Process.Start(new ProcessStartInfo(path) {
            WorkingDirectory = Path.GetDirectoryName(path),
            UseShellExecute = true
        });
    }

    private static void WaitForExit(Process process) {
        if (!process.WaitForExit(120000)) throw new IOException("旧版仍在运行。");
    }

    private static void ReplacePortable(string staged, string target, string backup) {
        var elapsed = Stopwatch.StartNew();
        while (true) {
            try {
                File.Replace(staged, target, backup);
                break;
            } catch (IOException) {
                if (elapsed.Elapsed.TotalSeconds >= 30 || File.Exists(backup)) throw;
                Thread.Sleep(250);
            }
        }
        try {
            using (StartExecutable(target)) { }
        } catch {
            File.Replace(backup, target, staged);
            throw;
        }
        File.Delete(backup);
    }

    [STAThread]
    private static int Main(string[] args) {
        if (args.Length != 2 && args.Length != 4) return 1;
        string download = args[0];
        string directory = Path.GetDirectoryName(download);
        string status = Path.Combine(directory, "handoff.status");
        string target = args.Length == 4 ? args[2] : null;
        string staged = null, backup = null;
        bool ready = false;
        try {
            using (var app = Process.GetProcessById(int.Parse(args[1])))
            using (var launcher = target == null ? null : Process.GetProcessById(int.Parse(args[3]))) {
                // Bind to both process instances before allowing the old version to quit.
                var appHandle = app.Handle;
                if (!File.Exists(download)) throw new FileNotFoundException("找不到下载文件。");
                if (launcher != null) {
                    var launcherHandle = launcher.Handle;
                    if (!String.Equals(launcher.MainModule.FileName, target, StringComparison.OrdinalIgnoreCase))
                        throw new IOException("无法确认正在运行的免安装版文件。");
                    if ((File.GetAttributes(target) & FileAttributes.ReadOnly) != 0)
                        throw new IOException("免安装版文件为只读。");
                    string prefix = Path.Combine(Path.GetDirectoryName(target), ".gerson-update-" + Guid.NewGuid().ToString("N"));
                    staged = prefix + ".new";
                    backup = prefix + ".bak";
                    File.Copy(download, staged, false);
                }
                WriteStatus(status, "ready");
                ready = true;
                WaitForExit(app);
                if (launcher != null) {
                    // electron-builder's NSIS wrapper finishes cleaning its extracted app after Electron exits.
                    WaitForExit(launcher);
                    ReplacePortable(staged, target, backup);
                } else {
                    using (var installer = StartExecutable(download)) { installer.WaitForExit(); }
                }
                File.Delete(download);
            }
            return 0;
        } catch (Exception error) {
            if (ready) {
                string message = "更新未完成。请关闭旧版后，手动运行已下载的新版：\n" + download;
                if (File.Exists(backup)) message += "\n旧文件备份：\n" + backup;
                MessageBox.Show(message, "桌面搭子", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            } else {
                WriteStatus(status, "error: " + error.Message);
            }
            return 1;
        } finally {
            if (staged != null) File.Delete(staged);
            if (ready) {
                File.Delete(status);
                if (!File.Exists(download) && Directory.GetFileSystemEntries(directory).Length == 0)
                    Directory.Delete(directory);
            }
        }
    }
}
