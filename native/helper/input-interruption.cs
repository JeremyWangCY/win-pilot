using System;
using System.Runtime.InteropServices;
using System.Threading;

// Shared by every action in the helper process. No key contents are retained.
public static class WinPilotInputMonitor
{
  public static readonly IntPtr SelfTag = new IntPtr(0x5750494E);
  private static readonly object State = new object();
  private static readonly object Lifecycle = new object();
  private static readonly ManualResetEvent Ready = new ManualResetEvent(false);
  private static readonly ManualResetEvent Interrupted = new ManualResetEvent(false);
  private static readonly HookProc KeyboardCallback = KeyboardHook;
  private static readonly HookProc MouseCallback = MouseHook;
  private static Thread worker;
  private static uint threadId;
  private static IntPtr keyboardHook, mouseHook;
  private static bool started, stopped, active, requiresObservation, dispatched;
  private static long generation;
  private static string failure;

  static WinPilotInputMonitor()
  {
    AppDomain.CurrentDomain.ProcessExit += delegate { Stop(); };
    AppDomain.CurrentDomain.DomainUnload += delegate { Stop(); };
  }

  public static bool HasDispatched { get { lock (State) { return dispatched; } } }

  public static void EnsureStarted()
  {
    lock (Lifecycle)
    {
      lock (State)
      {
        if (stopped) throw Unavailable("monitor stopped");
        if (!started)
        {
          started = true;
          worker = new Thread(Run);
          worker.IsBackground = true;
          worker.Name = "Win-Pilot input hooks";
          worker.Start();
        }
      }
      if (!Ready.WaitOne(5000))
      {
        lock (State) { failure = "hook thread did not initialize"; Interrupted.Set(); }
      }
      lock (State) { CheckHealth(); }
    }
  }

  public static void BeginAction()
  {
    lock (State) { dispatched = false; }
    EnsureStarted();
    lock (State)
    {
      CheckHealth();
      if (requiresObservation)
        throw new InvalidOperationException("observation_required: observe the window after user input before sending more input");
      Interrupted.Reset();
      active = true;
    }
  }

  public static void Check()
  {
    lock (State)
    {
      if (!active) return;
      CheckHealth();
      if (requiresObservation)
        throw new InvalidOperationException("user_input_interrupted: user input interrupted the active action");
    }
  }

  public static void EndAction() { lock (State) { active = false; } }
  public static void MarkDispatched() { lock (State) { if (active) dispatched = true; } }

  public static long BeginObservation()
  {
    EnsureStarted();
    lock (State) { CheckHealth(); return generation; }
  }

  public static bool AcceptObservation(long observedGeneration)
  {
    lock (State)
    {
      CheckHealth();
      // Checking and clearing under the callback's lock closes the re-arm race.
      if (active || observedGeneration != generation) return false;
      requiresObservation = false;
      Interrupted.Reset();
      return true;
    }
  }

  public static void Sleep(int milliseconds)
  {
    if (milliseconds < 0) throw new ArgumentOutOfRangeException("milliseconds");
    bool guarded;
    lock (State) { guarded = active; }
    // Observation/housekeeping waits must keep their duration after cancellation.
    if (!guarded) { Thread.Sleep(milliseconds); return; }
    Check();
    Interrupted.WaitOne(milliseconds);
    Check();
  }

  public static void Stop()
  {
    lock (Lifecycle)
    {
      Thread ending;
      uint endingId;
      lock (State)
      {
        if (stopped) return;
        stopped = true;
        ending = worker;
        endingId = threadId;
        Interrupted.Set();
      }
      if (endingId != 0) PostThreadMessage(endingId, 0x0012, UIntPtr.Zero, IntPtr.Zero);
      if (ending != null && ending != Thread.CurrentThread) ending.Join(2000);
    }
  }

  private static InvalidOperationException Unavailable(string detail)
  {
    return new InvalidOperationException("input_monitor_unavailable: " + detail);
  }

  // Caller holds State. A failed monitor is never silently restarted.
  private static void CheckHealth()
  {
    if (stopped || failure != null || worker == null || !worker.IsAlive ||
        keyboardHook == IntPtr.Zero || mouseHook == IntPtr.Zero)
      throw Unavailable(failure ?? (stopped ? "monitor stopped" : "hook thread is unavailable"));
  }

  private static void RecordInput(IntPtr extraInfo)
  {
    if (extraInfo == SelfTag) return;
    lock (State)
    {
      // Injected flags do not reveal the sender. Other applications count too.
      generation++;
      requiresObservation = true;
      if (active)
      {
        Interrupted.Set();
      }
    }
  }

  private static IntPtr KeyboardHook(int code, IntPtr message, IntPtr data)
  {
    if (code >= 0)
    {
      try { RecordInput(Marshal.ReadIntPtr(data, 16)); }
      catch { CallbackFailed(); }
    }
    return CallNextHookEx(IntPtr.Zero, code, message, data);
  }

  private static IntPtr MouseHook(int code, IntPtr message, IntPtr data)
  {
    if (code >= 0)
    {
      // MSLLHOOKSTRUCT aligns ULONG_PTR after its five 32-bit fields.
      try { RecordInput(Marshal.ReadIntPtr(data, IntPtr.Size == 8 ? 24 : 20)); }
      catch { CallbackFailed(); }
    }
    return CallNextHookEx(IntPtr.Zero, code, message, data);
  }

  private static void CallbackFailed()
  {
    lock (State) { failure = "input hook callback failed"; Interrupted.Set(); }
  }

  private static void Run()
  {
    IntPtr keyboard = IntPtr.Zero, mouse = IntPtr.Zero;
    try
    {
      MSG message;
      // Ensure the thread owns a queue before Stop can post WM_QUIT.
      PeekMessage(out message, IntPtr.Zero, 0, 0, 0);
      lock (State) { threadId = GetCurrentThreadId(); }
      IntPtr module = GetModuleHandle(null);
      keyboard = SetWindowsHookEx(13, KeyboardCallback, module, 0);
      if (keyboard == IntPtr.Zero) throw new InvalidOperationException("keyboard hook installation failed (" + Marshal.GetLastWin32Error() + ")");
      mouse = SetWindowsHookEx(14, MouseCallback, module, 0);
      if (mouse == IntPtr.Zero) throw new InvalidOperationException("mouse hook installation failed (" + Marshal.GetLastWin32Error() + ")");
      lock (State) { keyboardHook = keyboard; mouseHook = mouse; }
      Ready.Set();
      int result;
      while ((result = GetMessage(out message, IntPtr.Zero, 0, 0)) > 0)
      {
        TranslateMessage(ref message);
        DispatchMessage(ref message);
      }
      if (result < 0) throw new InvalidOperationException("hook message loop failed (" + Marshal.GetLastWin32Error() + ")");
    }
    catch (Exception exception)
    {
      lock (State) { failure = exception.Message; }
    }
    finally
    {
      if (mouse != IntPtr.Zero) UnhookWindowsHookEx(mouse);
      if (keyboard != IntPtr.Zero) UnhookWindowsHookEx(keyboard);
      lock (State)
      {
        keyboardHook = mouseHook = IntPtr.Zero;
        if (!stopped && failure == null) failure = "hook thread exited";
        Interrupted.Set();
      }
      Ready.Set();
    }
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct MSG
  {
    public IntPtr hwnd;
    public uint message;
    public UIntPtr wParam;
    public IntPtr lParam;
    public uint time;
    public int x, y;
    public uint privateData;
  }

  private delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
  [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int id, HookProc callback, IntPtr module, uint thread);
  [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
  [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll", SetLastError = true)] private static extern int GetMessage(out MSG message, IntPtr hwnd, uint min, uint max);
  [DllImport("user32.dll")] private static extern bool PeekMessage(out MSG message, IntPtr hwnd, uint min, uint max, uint remove);
  [DllImport("user32.dll")] private static extern bool TranslateMessage(ref MSG message);
  [DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref MSG message);
  [DllImport("user32.dll")] private static extern bool PostThreadMessage(uint thread, uint message, UIntPtr wParam, IntPtr lParam);
  [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string name);
}
