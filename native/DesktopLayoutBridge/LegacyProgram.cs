using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

internal static class LegacyProgram
{
    const uint LVM_FIRST = 0x1000;
    const uint LVM_GETITEMCOUNT = LVM_FIRST + 4;
    const uint LVM_GETITEMPOSITION = LVM_FIRST + 16;
    const uint LVM_SETITEMPOSITION32 = LVM_FIRST + 49;
    const uint LVM_GETITEMTEXTW = LVM_FIRST + 115;
    const uint LVM_GETNEXTITEM = LVM_FIRST + 12;
    const uint LVM_GETITEMSPACING = LVM_FIRST + 51;
    const uint LVM_SETICONSPACING = LVM_FIRST + 53;
    const uint LVM_REDRAWITEMS = LVM_FIRST + 21;
    const uint LVIF_TEXT = 0x0001;
    const int LVNI_SELECTED = 0x0002;
    const uint GWL_STYLE = 0xFFFFFFF0;
    const long LVS_AUTOARRANGE = 0x0100;
    const uint PROCESS_VM_OPERATION = 0x0008;
    const uint PROCESS_VM_READ = 0x0010;
    const uint PROCESS_VM_WRITE = 0x0020;
    const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    const uint MEM_COMMIT = 0x1000;
    const uint MEM_RESERVE = 0x2000;
    const uint MEM_RELEASE = 0x8000;
    const uint PAGE_READWRITE = 0x04;
    const uint SHCNE_ASSOCCHANGED = 0x08000000;
    const uint SHCNF_IDLIST = 0x0000;

    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

    static int Main(string[] args)
    {
        try
        {
            var command = args.Length > 0 ? args[0].ToLowerInvariant() : "status";
            if (command == "status") return Print(Status());
            if (command == "read") return Print(new Dictionary<string, object> { { "ok", true }, { "layout", ReadLayout() } });
            if (command == "apply") return Apply(args);
            if (command == "snap") return Snap();
            if (command == "snap-edge") return SnapSelectedToEdge();
            if (command == "spacing") return SetSpacing(args);
            if (command == "refresh") return Refresh();
            return Fail("Unsupported command.");
        }
        catch (Exception error) { return Fail(error.Message); }
    }

    static int Apply(string[] args)
    {
        if (args.Length < 2 || !File.Exists(args[1])) return Fail("Layout payload file is missing.");
        var snapshot = Json.Deserialize<LayoutSnapshot>(File.ReadAllText(args[1]));
        if (snapshot == null || snapshot.Entries == null || snapshot.Entries.Count == 0) return Fail("Layout payload contains no entries.");
        return Print(new Dictionary<string, object> { { "ok", true }, { "applied", ApplyLayout(snapshot) } });
    }

    static int Snap()
    {
        var layout = ReadLayout();
        foreach (var item in layout.Entries)
        {
            item.X = Round(item.X, Math.Max(layout.SpacingX, 1));
            item.Y = Round(item.Y, Math.Max(layout.SpacingY, 1));
        }
        var applied = ApplyLayout(layout);
        return Print(new Dictionary<string, object> { { "ok", true }, { "applied", applied }, { "mode", "grid" } });
    }

    static int SnapSelectedToEdge()
    {
        var context = GetDesktopListView();
        var spacing = GetSpacing(context.ListView);
        RECT rect;
        if (!GetClientRect(context.ListView, out rect)) return Fail("Unable to read desktop icon bounds.");
        var applied = 0;
        using (var remote = new RemoteProcess(context.ProcessId))
        {
            var index = -1;
            while ((index = SendMessage(context.ListView, LVM_GETNEXTITEM, new IntPtr(index), new IntPtr(LVNI_SELECTED)).ToInt32()) >= 0)
            {
                var point = ReadItemPosition(context.ListView, remote, index);
                var distances = new[] { point.X, Math.Max(0, rect.Right - point.X - spacing.X), point.Y, Math.Max(0, rect.Bottom - point.Y - spacing.Y) };
                var nearest = Array.IndexOf(distances, distances.Min());
                var targetX = point.X;
                var targetY = point.Y;
                if (nearest == 0) targetX = 0;
                if (nearest == 1) targetX = Math.Max(0, rect.Right - spacing.X);
                if (nearest == 2) targetY = 0;
                if (nearest == 3) targetY = Math.Max(0, rect.Bottom - spacing.Y);
                WriteItemPosition(context.ListView, remote, index, targetX, targetY);
                applied++;
            }
        }
        RefreshListView(context.ListView);
        return Print(new Dictionary<string, object> { { "ok", true }, { "applied", applied }, { "mode", "edge-selected" } });
    }

    static int SetSpacing(string[] args)
    {
        int x, y;
        if (args.Length < 3 || !Int32.TryParse(args[1], out x) || !Int32.TryParse(args[2], out y)) return Fail("Spacing requires positive X and Y pixel values.");
        if (x < 32 || x > 512 || y < 32 || y > 512) return Fail("Spacing must be between 32 and 512 pixels.");
        var context = GetDesktopListView();
        SendMessage(context.ListView, LVM_SETICONSPACING, IntPtr.Zero, new IntPtr((y << 16) | (x & 0xffff)));
        RefreshListView(context.ListView);
        return Print(new Dictionary<string, object> { { "ok", true }, { "spacingX", x }, { "spacingY", y } });
    }

    static int Refresh()
    {
        var context = GetDesktopListView();
        var count = SendMessage(context.ListView, LVM_GETITEMCOUNT, IntPtr.Zero, IntPtr.Zero).ToInt32();
        if (count > 0) SendMessage(context.ListView, LVM_REDRAWITEMS, IntPtr.Zero, new IntPtr(count - 1));
        RefreshListView(context.ListView);
        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, IntPtr.Zero, IntPtr.Zero);
        return Print(new Dictionary<string, object> { { "ok", true }, { "redrawn", Math.Max(count, 0) } });
    }

    static object Status()
    {
        try
        {
            var context = GetDesktopListView();
            var count = SendMessage(context.ListView, LVM_GETITEMCOUNT, IntPtr.Zero, IntPtr.Zero).ToInt32();
            var spacing = GetSpacing(context.ListView);
            var style = GetWindowLongPtr(context.ListView, unchecked((int)GWL_STYLE)).ToInt64();
            return new Dictionary<string, object>
            {
                { "ok", true }, { "explorerProcessId", context.ProcessId }, { "itemCount", Math.Max(count, 0) },
                { "spacingX", spacing.X }, { "spacingY", spacing.Y }, { "autoArrange", (style & LVS_AUTOARRANGE) == LVS_AUTOARRANGE }
            };
        }
        catch (Exception error) { return new Dictionary<string, object> { { "ok", false }, { "error", error.Message } }; }
    }

    static LayoutSnapshot ReadLayout()
    {
        var context = GetDesktopListView();
        using (var remote = new RemoteProcess(context.ProcessId))
        {
            var count = SendMessage(context.ListView, LVM_GETITEMCOUNT, IntPtr.Zero, IntPtr.Zero).ToInt32();
            if (count < 0) throw new InvalidOperationException("Unable to read desktop item count.");
            var result = new LayoutSnapshot();
            result.CreatedAt = DateTime.UtcNow.ToString("o");
            var spacing = GetSpacing(context.ListView);
            result.SpacingX = spacing.X;
            result.SpacingY = spacing.Y;
            result.Entries = new List<LayoutEntry>();
            for (var index = 0; index < count; index++)
            {
                var name = ReadItemName(context.ListView, remote, index);
                if (String.IsNullOrWhiteSpace(name)) continue;
                var point = ReadItemPosition(context.ListView, remote, index);
                result.Entries.Add(new LayoutEntry { Key = name, Name = name, X = point.X, Y = point.Y });
            }
            return result;
        }
    }

    static int ApplyLayout(LayoutSnapshot requested)
    {
        var context = GetDesktopListView();
        var current = ReadLayout();
        var target = requested.Entries.GroupBy(i => i.Name, StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.Last(), StringComparer.OrdinalIgnoreCase);
        var applied = 0;
        using (var remote = new RemoteProcess(context.ProcessId))
        {
            for (var index = 0; index < current.Entries.Count; index++)
            {
                LayoutEntry next;
                if (!target.TryGetValue(current.Entries[index].Name, out next)) continue;
                if (next.X < 0 || next.Y < 0 || next.X > 32760 || next.Y > 32760) continue;
                WriteItemPosition(context.ListView, remote, index, next.X, next.Y);
                applied++;
            }
        }
        if (requested.SpacingX >= 32 && requested.SpacingX <= 512 && requested.SpacingY >= 32 && requested.SpacingY <= 512)
            SendMessage(context.ListView, LVM_SETICONSPACING, IntPtr.Zero, new IntPtr((requested.SpacingY << 16) | (requested.SpacingX & 0xffff)));
        RefreshListView(context.ListView);
        return applied;
    }

    static string ReadItemName(IntPtr listView, RemoteProcess remote, int index)
    {
        const int characterCount = 1024;
        var textPointer = remote.Allocate(characterCount * 2);
        var itemPointer = remote.Allocate(Marshal.SizeOf(typeof(LVITEM)));
        try
        {
            var item = new LVITEM { mask = LVIF_TEXT, iItem = index, iSubItem = 0, pszText = textPointer, cchTextMax = characterCount };
            remote.WriteStruct(itemPointer, item);
            SendMessage(listView, LVM_GETITEMTEXTW, new IntPtr(index), itemPointer);
            return Encoding.Unicode.GetString(remote.Read(textPointer, characterCount * 2)).TrimEnd('\0');
        }
        finally { remote.Free(textPointer); remote.Free(itemPointer); }
    }

    static POINT ReadItemPosition(IntPtr listView, RemoteProcess remote, int index)
    {
        var pointer = remote.Allocate(Marshal.SizeOf(typeof(POINT)));
        try
        {
            if (SendMessage(listView, LVM_GETITEMPOSITION, new IntPtr(index), pointer) == IntPtr.Zero) throw new InvalidOperationException("Unable to read desktop icon position.");
            return remote.ReadStruct<POINT>(pointer);
        }
        finally { remote.Free(pointer); }
    }

    static void WriteItemPosition(IntPtr listView, RemoteProcess remote, int index, int x, int y)
    {
        var pointer = remote.Allocate(Marshal.SizeOf(typeof(POINT)));
        try
        {
            remote.WriteStruct(pointer, new POINT { X = x, Y = y });
            if (SendMessage(listView, LVM_SETITEMPOSITION32, new IntPtr(index), pointer) == IntPtr.Zero) throw new InvalidOperationException("Unable to set desktop icon position.");
        }
        finally { remote.Free(pointer); }
    }

    static POINT GetSpacing(IntPtr listView)
    {
        var packed = SendMessage(listView, LVM_GETITEMSPACING, IntPtr.Zero, IntPtr.Zero).ToInt64();
        return new POINT { X = unchecked((short)(packed & 0xffff)), Y = unchecked((short)((packed >> 16) & 0xffff)) };
    }

    static int Round(int value, int unit) { return (int)Math.Round(value / (double)unit, MidpointRounding.AwayFromZero) * unit; }

    static DesktopContext GetDesktopListView()
    {
        var progman = FindWindow("Progman", null);
        var defView = progman != IntPtr.Zero ? FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null) : IntPtr.Zero;
        if (defView == IntPtr.Zero)
        {
            IntPtr worker = IntPtr.Zero;
            while ((worker = FindWindowEx(IntPtr.Zero, worker, "WorkerW", null)) != IntPtr.Zero)
            {
                defView = FindWindowEx(worker, IntPtr.Zero, "SHELLDLL_DefView", null);
                if (defView != IntPtr.Zero) break;
            }
        }
        if (defView == IntPtr.Zero) throw new InvalidOperationException("Windows Explorer desktop view is unavailable. Start Explorer and try again.");
        var list = FindWindowEx(defView, IntPtr.Zero, "SysListView32", "FolderView");
        if (list == IntPtr.Zero) list = FindWindowEx(defView, IntPtr.Zero, "SysListView32", null);
        if (list == IntPtr.Zero) throw new InvalidOperationException("Windows Explorer desktop icon control was not found.");
        uint processId;
        GetWindowThreadProcessId(list, out processId);
        if (processId == 0) throw new InvalidOperationException("Windows Explorer process could not be resolved.");
        return new DesktopContext { ListView = list, ProcessId = processId };
    }

    static void RefreshListView(IntPtr list) { InvalidateRect(list, IntPtr.Zero, true); UpdateWindow(list); }
    static int Print(object result) { Console.Out.WriteLine(Json.Serialize(result)); return 0; }
    static int Fail(string error) { Console.Out.WriteLine(Json.Serialize(new Dictionary<string, object> { { "ok", false }, { "error", error } })); return 1; }

    sealed class RemoteProcess : IDisposable
    {
        readonly IntPtr handle;
        public RemoteProcess(uint processId)
        {
            handle = OpenProcess(PROCESS_VM_OPERATION | PROCESS_VM_READ | PROCESS_VM_WRITE | PROCESS_QUERY_LIMITED_INFORMATION, false, processId);
            if (handle == IntPtr.Zero) throw new InvalidOperationException("Desktop Explorer memory cannot be accessed. Run the app in the same user session.");
        }
        public IntPtr Allocate(int bytes)
        {
            var pointer = VirtualAllocEx(handle, IntPtr.Zero, new UIntPtr((uint)bytes), MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
            if (pointer == IntPtr.Zero) throw new InvalidOperationException("Unable to allocate Explorer memory.");
            return pointer;
        }
        public void Free(IntPtr pointer) { if (pointer != IntPtr.Zero) VirtualFreeEx(handle, pointer, UIntPtr.Zero, MEM_RELEASE); }
        public byte[] Read(IntPtr pointer, int count)
        {
            var bytes = new byte[count]; UIntPtr read;
            if (!ReadProcessMemory(handle, pointer, bytes, count, out read) || read.ToUInt64() < (ulong)count) throw new InvalidOperationException("Unable to read Explorer memory.");
            return bytes;
        }
        public T ReadStruct<T>(IntPtr pointer) where T : struct
        {
            var bytes = Read(pointer, Marshal.SizeOf(typeof(T)));
            var pin = GCHandle.Alloc(bytes, GCHandleType.Pinned);
            try { return (T)Marshal.PtrToStructure(pin.AddrOfPinnedObject(), typeof(T)); }
            finally { pin.Free(); }
        }
        public void WriteStruct<T>(IntPtr pointer, T value) where T : struct
        {
            var size = Marshal.SizeOf(typeof(T));
            var local = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(value, local, false);
                var bytes = new byte[size]; Marshal.Copy(local, bytes, 0, size); UIntPtr written;
                if (!WriteProcessMemory(handle, pointer, bytes, bytes.Length, out written) || written.ToUInt64() < (ulong)bytes.Length) throw new InvalidOperationException("Unable to write Explorer memory.");
            }
            finally { Marshal.FreeHGlobal(local); }
        }
        public void Dispose() { if (handle != IntPtr.Zero) CloseHandle(handle); }
    }

    public class LayoutEntry { public string Key { get; set; } public string Name { get; set; } public int X { get; set; } public int Y { get; set; } }
    public class LayoutSnapshot { public string CreatedAt { get; set; } public int SpacingX { get; set; } public int SpacingY { get; set; } public List<LayoutEntry> Entries { get; set; } }
    struct DesktopContext { public IntPtr ListView; public uint ProcessId; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct LVITEM { public uint mask; public int iItem; public int iSubItem; public uint state; public uint stateMask; public IntPtr pszText; public int cchTextMax; public int iImage; public IntPtr lParam; public int iIndent; public int iGroupId; public uint cColumns; public IntPtr puColumns; public IntPtr piColFmt; public int iGroup; }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string className, string windowName);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string className, string windowName);
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int index);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] static extern bool InvalidateRect(IntPtr hWnd, IntPtr rect, bool erase);
    [DllImport("user32.dll")] static extern bool UpdateWindow(IntPtr hWnd);
    [DllImport("shell32.dll")] static extern void SHChangeNotify(uint eventId, uint flags, IntPtr item1, IntPtr item2);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
    [DllImport("kernel32.dll")] static extern IntPtr VirtualAllocEx(IntPtr process, IntPtr address, UIntPtr size, uint allocation, uint protect);
    [DllImport("kernel32.dll")] static extern bool VirtualFreeEx(IntPtr process, IntPtr address, UIntPtr size, uint freeType);
    [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr process, IntPtr address, [Out] byte[] buffer, int count, out UIntPtr read);
    [DllImport("kernel32.dll")] static extern bool WriteProcessMemory(IntPtr process, IntPtr address, byte[] buffer, int count, out UIntPtr written);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
}
