using System.Runtime.InteropServices;

namespace WinPilotTaskDesktop;

static class RdpCredentials
{
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]delegate int PutBoolean(IntPtr self,short value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]delegate int GetBoolean(IntPtr self,out short value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]delegate int PutPassword(IntPtr self,IntPtr value);
    internal static void ApplyLogin(object client,WindowsLogin login)
    {
        var (user,domain)=login.Parts();
        dynamic rdp=client;rdp.UserName=user;rdp.Domain=domain??"";
        // Installed mstscax type library: IMsTscNonScriptable, put password
        // byte offset 24 (IUnknown slot 3), BSTR parameter. Never use SendKeys.
        var iid=new Guid("c1e6743a-41c1-4a74-832a-0dd06c1c7a0e");
        IntPtr unknown=Marshal.GetIUnknownForObject(client),settings=IntPtr.Zero,password=IntPtr.Zero;
        try {
            Marshal.ThrowExceptionForHR(Marshal.QueryInterface(unknown,ref iid,out settings));
            password=Marshal.StringToBSTR(new string('\0',login.Password.Length/2));
            Marshal.Copy(login.Password,0,password,login.Password.Length);
            var put=Marshal.GetDelegateForFunctionPointer<PutPassword>(Marshal.ReadIntPtr(Marshal.ReadIntPtr(settings),3*IntPtr.Size));
            Marshal.ThrowExceptionForHR(put(settings,password));
        }finally{if(password!=IntPtr.Zero)Marshal.ZeroFreeBSTR(password);if(settings!=IntPtr.Zero)Marshal.Release(settings);Marshal.Release(unknown);}
    }
    internal static void ConfigureChildSession(object client,bool promptWindowsLogin=false)
    {
        // IMsRdpClientNonScriptable5: the installed mstscax type library confirms
        // AllowPromptingForCredentials put/get slots 63/64 including inheritance.
        // Windows owns any server-side sign-in UI. Optional saved credentials
        // are applied separately through IMsTscNonScriptable before Connect.
        var iid=new Guid("4f6996d5-d7b1-412c-b0ff-063718566907");
        IntPtr unknown=Marshal.GetIUnknownForObject(client),settings=IntPtr.Zero;
        try {
            Marshal.ThrowExceptionForHR(Marshal.QueryInterface(unknown,ref iid,out settings));
            IntPtr vtable=Marshal.ReadIntPtr(settings);
            var put=Marshal.GetDelegateForFunctionPointer<PutBoolean>(Marshal.ReadIntPtr(vtable,63*IntPtr.Size));
            var get=Marshal.GetDelegateForFunctionPointer<GetBoolean>(Marshal.ReadIntPtr(vtable,64*IntPtr.Size));
            short requested=promptWindowsLogin?(short)-1:(short)0;
            Marshal.ThrowExceptionForHR(put(settings,requested));
            Marshal.ThrowExceptionForHR(get(settings,out short enabled));
            if(enabled!=requested)throw new InvalidOperationException("Windows 子会话凭据配置未生效。");
            // Allow a system prompt when needed, but first reuse Windows' current
            // logon. PromptForCredentials=true would force another prompt even
            // after the user has already enabled and authenticated the desktop.
            // This property is inherited from NonScriptable3 (slots 19/20).
            {
                var prompt=Marshal.GetDelegateForFunctionPointer<PutBoolean>(Marshal.ReadIntPtr(vtable,19*IntPtr.Size));
                var readPrompt=Marshal.GetDelegateForFunctionPointer<GetBoolean>(Marshal.ReadIntPtr(vtable,20*IntPtr.Size));
                Marshal.ThrowExceptionForHR(prompt(settings,0));Marshal.ThrowExceptionForHR(readPrompt(settings,out short actual));
                if(actual!=0)throw new InvalidOperationException("Windows 自动登录配置未生效。");
            }
        }finally{if(settings!=IntPtr.Zero)Marshal.Release(settings);Marshal.Release(unknown);}
    }
}
