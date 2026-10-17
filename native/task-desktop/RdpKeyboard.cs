using System.Runtime.InteropServices;

namespace WinPilotTaskDesktop;

static class RdpKeyboard
{
    // The ten password methods are inherited from IMsTscNonScriptable. The
    // installed mstscax type library places SendKeys at vtable offset 112 (x64).
    [ComImport,Guid("2f079c4c-87b2-4afd-97ab-20cdb43038ae"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface NonScriptable {
        void SetClearTextPassword([MarshalAs(UnmanagedType.BStr)]string value);
        void SetPortablePassword([MarshalAs(UnmanagedType.BStr)]string value);
        void GetPortablePassword([MarshalAs(UnmanagedType.BStr)]out string value);
        void SetPortableSalt([MarshalAs(UnmanagedType.BStr)]string value);
        void GetPortableSalt([MarshalAs(UnmanagedType.BStr)]out string value);
        void SetBinaryPassword([MarshalAs(UnmanagedType.BStr)]string value);
        void GetBinaryPassword([MarshalAs(UnmanagedType.BStr)]out string value);
        void SetBinarySalt([MarshalAs(UnmanagedType.BStr)]string value);
        void GetBinarySalt([MarshalAs(UnmanagedType.BStr)]out string value);
        void ResetPassword();
        void NotifyRedirectDeviceChange(UIntPtr wParam,IntPtr lParam);
        [PreserveSig]int SendKeys(int count,[In,MarshalAs(UnmanagedType.LPArray,SizeParamIndex=0)]short[] up,[In,MarshalAs(UnmanagedType.LPArray,SizeParamIndex=0)]int[] data);
    }
    [DllImport("user32.dll")]static extern uint MapVirtualKeyW(uint code,uint type);
    internal static int KeyData(ushort scan,bool up,bool extended)=>unchecked((int)(1u|((uint)scan<<16)|(extended?1u<<24:0)|(up?3u<<30:0)));
    internal static void Send(object client,(uint vk,bool up,bool extended)[] events)
    {
        if(events.Length==0||events.Length>20)throw new ArgumentOutOfRangeException(nameof(events));
        var input=(NonScriptable)client;
        var held=new List<(ushort scan,bool extended)>();
        try {
            var up=new short[events.Length];var data=new int[events.Length];
            for(int i=0;i<events.Length;i++) {
                var e=events[i];ushort scan=(ushort)MapVirtualKeyW(e.vk,0);
                if(scan==0)throw new InvalidOperationException("无法映射远程按键。");
                up[i]=e.up?(short)-1:(short)0;data[i]=KeyData(scan,e.up,e.extended);
                if(e.up)held.Remove((scan,e.extended));else held.Add((scan,e.extended));
            }
            // This API sends one atomic sequence to this RDP control; it does
            // not inject keys into the caller's desktop or mix local keystrokes.
            Marshal.ThrowExceptionForHR(input.SendKeys(events.Length,up,data));
        }finally {
            foreach(var key in held)input.SendKeys(1,[-1],[KeyData(key.scan,true,key.extended)]);
        }
    }
}
