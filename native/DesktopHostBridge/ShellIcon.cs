using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

internal static partial class DesktopHostBridge
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct ShellFileInfo {
        public IntPtr Icon; public int IconIndex; public uint Attributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string DisplayName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=80)] public string TypeName;
    }
    [DllImport("shell32.dll", CharSet=CharSet.Unicode)] static extern IntPtr SHGetFileInfo(string path, uint attributes, ref ShellFileInfo info, uint size, uint flags);
    [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr icon);
    [DllImport("shell32.dll", CharSet=CharSet.Unicode)] static extern uint ExtractIconEx(string path, int index, out IntPtr large, out IntPtr small, uint count);
    [StructLayout(LayoutKind.Sequential)] struct ThumbnailSize { public int Width,Height; }
    [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IShellItemImageFactory {
        [PreserveSig] int GetImage(ThumbnailSize size,uint flags,out IntPtr bitmap);
    }
    [DllImport("shell32.dll",CharSet=CharSet.Unicode,PreserveSig=true)] static extern int SHCreateItemFromParsingName(string path,IntPtr context,ref Guid iid,out IShellItemImageFactory factory);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr value);
    static void PrintBitmap(Bitmap bitmap) {
        bool visible=false;
        for(int y=0;y<bitmap.Height && !visible;y++) for(int x=0;x<bitmap.Width;x++) if(bitmap.GetPixel(x,y).A!=0) { visible=true; break; }
        if(!visible) throw new IOException("Windows returned a transparent image.");
        using(var stream=new MemoryStream()) {
            bitmap.Save(stream,ImageFormat.Png);
            Console.WriteLine(Json.Serialize(new { ok=true, dataUrl="data:image/png;base64,"+Convert.ToBase64String(stream.ToArray()) }));
        }
    }
    static void PrintThumbnail(string path) {
        var iid=typeof(IShellItemImageFactory).GUID;
        IShellItemImageFactory factory=null;
        IntPtr handle=IntPtr.Zero;
        try {
            Marshal.ThrowExceptionForHR(SHCreateItemFromParsingName(path,IntPtr.Zero,ref iid,out factory));
            Marshal.ThrowExceptionForHR(factory.GetImage(new ThumbnailSize {Width=96,Height=96},8,out handle));
            if(handle==IntPtr.Zero) throw new IOException("No thumbnail is available.");
            using(var bitmap=Image.FromHbitmap(handle)) PrintBitmap(bitmap);
        } finally {
            if(handle!=IntPtr.Zero) DeleteObject(handle);
            if(factory!=null) Marshal.FinalReleaseComObject(factory);
        }
    }
    static void PrintShellIcon(string path, int? index = null) {
        var info = new ShellFileInfo();
        path=Environment.ExpandEnvironmentVariables(path);
        if(index.HasValue) {
            IntPtr large,small;
            ExtractIconEx(path,index.Value,out large,out small,1);
            info.Icon=large!=IntPtr.Zero ? large : small;
            if(small!=IntPtr.Zero && small!=info.Icon) DestroyIcon(small);
        } else SHGetFileInfo(path,0,ref info,(uint)Marshal.SizeOf(typeof(ShellFileInfo)),0x100);
        if(info.Icon==IntPtr.Zero) throw new IOException("No Windows shell icon is available.");
        try {
            using(var icon=Icon.FromHandle(info.Icon))
            using(var bitmap=icon.ToBitmap()) PrintBitmap(bitmap);
        } finally { DestroyIcon(info.Icon); }
    }
}
