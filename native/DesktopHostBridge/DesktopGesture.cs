using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

internal static partial class DesktopHostBridge
{
    [StructLayout(LayoutKind.Sequential)] struct MousePoint { public int X,Y; }
    [StructLayout(LayoutKind.Sequential)] struct MouseData { public MousePoint Point; public uint Mouse,Flags,Time; public IntPtr Extra; }
    delegate IntPtr MouseHook(int code,IntPtr message,IntPtr data);
    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int hook,MouseHook callback,IntPtr module,uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr message,IntPtr data);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(MousePoint point);
    [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr window,ref MousePoint point);
    [DllImport("user32.dll")] static extern uint GetDoubleClickTime();
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool PostThreadMessage(uint thread,uint message,IntPtr first,IntPtr second);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint rights,bool inherit,uint process);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern IntPtr VirtualAllocEx(IntPtr process,IntPtr address,UIntPtr size,uint type,uint protection);
    [DllImport("kernel32.dll")] static extern bool VirtualFreeEx(IntPtr process,IntPtr address,UIntPtr size,uint type);
    [DllImport("kernel32.dll")] static extern bool WriteProcessMemory(IntPtr process,IntPtr address,byte[] data,UIntPtr size,out UIntPtr written);
    [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SendMessageTimeout(IntPtr window,uint message,IntPtr first,IntPtr second,uint flags,uint timeout,out IntPtr result);

    static string WindowClass(IntPtr window) { var text=new System.Text.StringBuilder(64); GetClassName(window,text,64); return text.ToString(); }
    static bool ClickPair(uint previousTime,uint time,MousePoint first,MousePoint next,uint interval,int width,int height) {
        return previousTime!=0 && unchecked(time-previousTime)<=interval
            && Math.Abs(next.X-first.X)<=Math.Max(2,width/2) && Math.Abs(next.Y-first.Y)<=Math.Max(2,height/2);
    }
    static void CheckGestureTiming() {
        var point=new MousePoint {X=-100,Y=120};
        if(!ClickPair(1,200,point,point,500,4,4) || ClickPair(1,600,point,point,500,4,4)
            || ClickPair(1,200,point,new MousePoint {X=-80,Y=120},500,4,4)
            || ClickPair(0,200,point,point,500,4,4) || !ClickPair(UInt32.MaxValue-50,20,point,point,500,4,4))
            throw new InvalidOperationException("Desktop double-click timing check failed.");
        Console.WriteLine("{\"ok\":true,\"checks\":[\"double click timing\",\"distance threshold\",\"single click ignored\",\"timer wrap\"]}");
    }
    static bool BlankDesktopPoint(MousePoint point) {
        var window=WindowFromPoint(point);
        string name=WindowClass(window);
        if(name=="Progman" || name=="WorkerW") return true;
        if(name=="SHELLDLL_DefView") return WindowClass(GetParent(window))=="Progman" || WindowClass(GetParent(window))=="WorkerW";
        if(name!="SysListView32" || WindowClass(GetParent(window))!="SHELLDLL_DefView") return false;
        uint pid; GetWindowThreadProcessId(window,out pid);
        var process=OpenProcess(0x28,false,pid);
        if(process==IntPtr.Zero) return false;
        IntPtr memory=IntPtr.Zero;
        try {
            if(!ScreenToClient(window,ref point)) return false;
            byte[] hit=new byte[24]; Array.Copy(BitConverter.GetBytes(point.X),0,hit,0,4); Array.Copy(BitConverter.GetBytes(point.Y),0,hit,4,4);
            memory=VirtualAllocEx(process,IntPtr.Zero,(UIntPtr)hit.Length,0x3000,4);
            UIntPtr written; if(memory==IntPtr.Zero || !WriteProcessMemory(process,memory,hit,(UIntPtr)hit.Length,out written)) return false;
            IntPtr result;
            return SendMessageTimeout(window,0x1012,IntPtr.Zero,memory,2,80,out result)!=IntPtr.Zero && result.ToInt64()==-1;
        } finally { if(memory!=IntPtr.Zero) VirtualFreeEx(process,memory,UIntPtr.Zero,0x8000); CloseHandle(process); }
    }
    static int WatchDesktopClicks(int ownerPid) {
        using(var owner=Process.GetProcessById(ownerPid)) {
            uint thread=GetCurrentThreadId();
            uint previousTime=0; MousePoint previousPoint=new MousePoint();
            MouseHook callback=delegate(int code,IntPtr message,IntPtr memory) {
                if(code>=0 && message.ToInt64()==0x202) {
                    var data=(MouseData)Marshal.PtrToStructure(memory,typeof(MouseData));
                    bool pair=ClickPair(previousTime,data.Time,previousPoint,data.Point,GetDoubleClickTime(),GetSystemMetrics(36),GetSystemMetrics(37));
                    if(pair) {
                        if(BlankDesktopPoint(previousPoint) && BlankDesktopPoint(data.Point)) {
                            Console.WriteLine("{\"event\":\"desktop-double-click\"}"); Console.Out.Flush();
                        }
                        previousTime=0;
                    } else { previousTime=data.Time; previousPoint=data.Point; }
                }
                return CallNextHookEx(IntPtr.Zero,code,message,memory);
            };
            var hook=SetWindowsHookEx(14,callback,GetModuleHandle(null),0);
            if(hook==IntPtr.Zero) throw new InvalidOperationException("Desktop gesture listener could not start.");
            var exitWatcher=new Thread(delegate() { owner.WaitForExit(); while(!PostThreadMessage(thread,0x12,IntPtr.Zero,IntPtr.Zero)) Thread.Sleep(10); });
            exitWatcher.IsBackground=true; exitWatcher.Start();
            Console.WriteLine("{\"event\":\"desktop-listener-ready\"}"); Console.Out.Flush();
            try { Application.Run(); }
            finally { UnhookWindowsHookEx(hook); GC.KeepAlive(callback); }
        }
        return 0;
    }
}
