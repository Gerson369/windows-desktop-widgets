param([Parameter(Mandatory=$true)][string]$Executable, [Parameter(Mandatory=$true)][string]$Icon)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
public static class ToolboxIconResource {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern IntPtr BeginUpdateResource(string file, bool deleteExisting);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool UpdateResource(IntPtr handle, IntPtr type, IntPtr name, ushort language, byte[] data, uint size);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool EndUpdateResource(IntPtr handle, bool discard);
    public static void SetIcon(string executable, string iconPath) {
        byte[] icon = File.ReadAllBytes(iconPath);
        // ponytail: one PNG frame; add multi-frame support if the icon asset changes.
        if (icon.Length < 22 || BitConverter.ToUInt16(icon, 0) != 0 || BitConverter.ToUInt16(icon, 2) != 1 || BitConverter.ToUInt16(icon, 4) != 1)
            throw new InvalidDataException("Expected a single-frame Windows icon.");
        int size = checked((int)BitConverter.ToUInt32(icon, 14));
        int offset = checked((int)BitConverter.ToUInt32(icon, 18));
        if (size <= 0 || offset < 22 || offset > icon.Length - size) throw new InvalidDataException("Invalid icon frame.");
        byte[] frame = new byte[size], group = new byte[20];
        Buffer.BlockCopy(icon, offset, frame, 0, size);
        Buffer.BlockCopy(icon, 0, group, 0, 6);
        Buffer.BlockCopy(icon, 6, group, 6, 12);
        group[18] = 1;
        IntPtr handle = BeginUpdateResource(executable, false);
        if (handle == IntPtr.Zero) throw new Win32Exception();
        bool written = false;
        try {
            if (!UpdateResource(handle, (IntPtr)3, (IntPtr)1, 0, frame, (uint)frame.Length) ||
                !UpdateResource(handle, (IntPtr)14, (IntPtr)1, 0, group, (uint)group.Length)) throw new Win32Exception();
            written = true;
        } finally {
            if (!EndUpdateResource(handle, !written)) throw new Win32Exception();
        }
    }
}
"@
[ToolboxIconResource]::SetIcon((Resolve-Path -LiteralPath $Executable).Path, (Resolve-Path -LiteralPath $Icon).Path)