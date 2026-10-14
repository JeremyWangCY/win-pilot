$ErrorActionPreference = 'Stop'
$bundle = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../../lib/win-pilot-helper.ps1'))
$definition = [regex]::Match($bundle, "(?s)Add-Type -TypeDefinition @'\r?\n(.*?)\r?\n'@")
if (-not $definition.Success) { throw 'Native helper Add-Type source was not found' }
Add-Type -TypeDefinition $definition.Groups[1].Value
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Threading;
using System.Windows.Forms;
using System.Runtime.InteropServices;
public static class OwnedInputFixture {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
  private delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
  [DllImport("user32.dll")] private static extern IntPtr SetWindowsHookEx(int id, HookProc hook, IntPtr module, uint thread);
  [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
  [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string name);
  private static readonly HookProc observer = Observe;
  private static IntPtr observerHook;
  [DllImport("user32.dll")] private static extern void keybd_event(byte key, byte scan, uint flags, IntPtr extra);
  private static Form window;
  private static TextBox editor;
  private static readonly ManualResetEvent ready = new ManualResetEvent(false);
  public static IntPtr Handle;
  public static int X, Y, ExternalKeys;
  public static bool SawHeldInput;
  private static IntPtr Observe(int code, IntPtr message, IntPtr data) {
    if (code >= 0 && Marshal.ReadInt32(data) == 0x87 && Marshal.ReadIntPtr(data, 16) == IntPtr.Zero)
      Interlocked.Increment(ref ExternalKeys);
    return CallNextHookEx(IntPtr.Zero, code, message, data);
  }
  public static void Start() {
    Thread ui = new Thread(delegate() {
      window = new Form();
      window.Text = "Win-Pilot owned-input interruption fixture";
      window.StartPosition = FormStartPosition.CenterScreen;
      window.Width = 480; window.Height = 240;
      editor = new TextBox(); editor.Multiline = true; editor.Dock = DockStyle.Fill;
      window.Controls.Add(editor);
      window.Shown += delegate {
        // Install before the production hooks, so this observer is next in chain.
        observerHook = SetWindowsHookEx(13, observer, GetModuleHandle(null), 0);
        if (observerHook == IntPtr.Zero) throw new Exception("Fixture observer hook did not install");
        Handle = window.Handle;
        System.Drawing.Point point = editor.PointToScreen(new System.Drawing.Point(40, 40));
        X = point.X; Y = point.Y;
        editor.Focus(); ready.Set();
      };
      Application.Run(window);
    });
    ui.IsBackground = true; ui.SetApartmentState(ApartmentState.STA); ui.Start();
    if (!ready.WaitOne(5000)) throw new Exception("Owned fixture window did not start");
  }
  public static bool Focus() {
    window.Invoke(new Action(delegate {
      uint process;
      uint foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), out process);
      uint ownThread = GetCurrentThreadId();
      bool attached = foregroundThread != 0 && foregroundThread != ownThread && AttachThreadInput(ownThread, foregroundThread, true);
      try { window.Activate(); SetForegroundWindow(Handle); editor.Focus(); }
      finally { if (attached) AttachThreadInput(ownThread, foregroundThread, false); }
    }));
    Thread.Sleep(80);
    return GetForegroundWindow() == Handle;
  }
  public static void BeginGuard(Type monitor) {
    for (int attempt = 0; attempt < 40; attempt++) {
      object token = monitor.GetMethod("BeginObservation").Invoke(null, null);
      if ((bool)monitor.GetMethod("AcceptObservation").Invoke(null, new object[] { token })) {
        try { monitor.GetMethod("BeginAction").Invoke(null, null); return; }
        catch (System.Reflection.TargetInvocationException error) {
          if (!error.InnerException.Message.StartsWith("observation_required:")) throw;
        }
      }
      Thread.Sleep(25);
    }
    throw new Exception("Owned fixture could not obtain an uninterrupted observation");
  }
  public static Thread Interrupt(int heldKey, int delay) {
    SawHeldInput = false;
    Thread injection = new Thread(delegate() {
      if (heldKey != 0) {
        for (int i = 0; i < 1000 && (GetAsyncKeyState(heldKey) & 0x8000) == 0; i++) Thread.Sleep(1);
        SawHeldInput = (GetAsyncKeyState(heldKey) & 0x8000) != 0;
      } else Thread.Sleep(delay);
      keybd_event(0x87, 0, 0, IntPtr.Zero);
      keybd_event(0x87, 0, 2, IntPtr.Zero);
    });
    injection.IsBackground = true; injection.Start(); return injection;
  }
  public static int TextLength() { return (int)editor.Invoke(new Func<int>(delegate { return editor.TextLength; })); }
  public static void Close() { if (window != null && !window.IsDisposed) window.Invoke(new Action(delegate { if (observerHook != IntPtr.Zero) UnhookWindowsHookEx(observerHook); window.Close(); })); }
}
'@ -ReferencedAssemblies System.Windows.Forms, System.Drawing

function Assert-True([bool]$condition, [string]$message) {
  if (-not $condition) { throw $message }
}
function Invoke-Interrupted([scriptblock]$action, [int]$heldKey, [int]$delay = 80) {
  Assert-True ([OwnedInputFixture]::Focus()) 'Refuse to send test input unless the owned fixture has foreground'
  [OwnedInputFixture]::BeginGuard([WinPilotInputMonitor])
  $injection = [OwnedInputFixture]::Interrupt($heldKey, $delay)
  $interrupted = $false
  try { & $action } catch {
    Assert-True ($_.Exception.ToString().Contains('user_input_interrupted:')) "Unexpected input failure: $($_.Exception)"
    $interrupted = $true
  } finally {
    [DshWin32]::ReleaseOwnedInput()
    [WinPilotInputMonitor]::EndAction()
    $injection.Join()
  }
  Assert-True $interrupted 'Input sequence must stop on external F24'
  Assert-True ([WinPilotInputMonitor]::HasDispatched) 'Interrupted sequence must report partial input'
  if ($heldKey -ne 0) {
    Assert-True ([OwnedInputFixture]::SawHeldInput) 'Fixture must interrupt after the owned input is actually held'
    Assert-True (([OwnedInputFixture]::GetAsyncKeyState($heldKey) -band 0x8000) -eq 0) 'Cleanup must release owned input'
  }
}

try {
  [OwnedInputFixture]::Start()
  [WinPilotInputMonitor]::EnsureStarted()
  Invoke-Interrupted { [DshWin32]::HoldKey('F23', '', 2000) } 0x86
  Invoke-Interrupted { [DshWin32]::TypeText(('x' * 2000)) } 0
  Assert-True ([OwnedInputFixture]::TextLength() -lt 2000) 'Typing must stop before the remaining text is sent'
  Assert-True (([OwnedInputFixture]::GetAsyncKeyState(0xE7) -band 0x8000) -eq 0) 'Typing must not leave VK_PACKET down'
  Invoke-Interrupted { [DshWin32]::Drag([OwnedInputFixture]::X, [OwnedInputFixture]::Y, ([OwnedInputFixture]::X + 180), [OwnedInputFixture]::Y) } 0x01
  Start-Sleep -Milliseconds 80
  Assert-True ([OwnedInputFixture]::ExternalKeys -ge 6) 'User input must still reach the next hook after passing the production monitor'
  'INPUT_OWNED_CLEANUP_OK'
} finally {
  [DshWin32]::ReleaseOwnedInput()
  [WinPilotInputMonitor]::EndAction()
  # Closing the owned foreground form lets Windows choose the previous window.
  [OwnedInputFixture]::Close()
  [WinPilotInputMonitor]::Stop()
}
