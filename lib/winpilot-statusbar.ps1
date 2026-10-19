# Win-Pilot status pill: top-center dark bar with one low-contrast accent dot.
# Visible while the helper is acting (status.state fresh), hides shortly after
# the last action. Click-through, never activates, per-pixel-alpha layered
# window — same technique as the virtual cursor overlay (PS 5.1 + PS7 compatible).
param(
  [string]$RenderSample = "",
  [switch]$SampleActivity
)
$ErrorActionPreference = "Stop"
$rendererMutex = $null
$rendererDir = Join-Path $env:TEMP 'win-pilot'
$rendererVersion = ''
if (-not $RenderSample) {
  [IO.Directory]::CreateDirectory($rendererDir) | Out-Null
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { $rendererVersion = [BitConverter]::ToString($hasher.ComputeHash([IO.File]::ReadAllBytes($PSCommandPath))).Replace('-', '') }
  finally { $hasher.Dispose() }
  $rendererMutex = New-Object Threading.Mutex($false, ('Local\WinPilotActivity-' + [Security.Principal.WindowsIdentity]::GetCurrent().User.Value))
  try {
    if (-not $rendererMutex.WaitOne(0)) {
      $previous = ''
      try { $previous = [IO.File]::ReadAllText((Join-Path $rendererDir 'renderer.version')) } catch { }
      if ($previous -eq $rendererVersion) { $rendererMutex.Dispose(); exit 0 }
      if (-not $previous) {
        # Upgrade a pre-handshake renderer only when its saved PID and creation
        # time still identify this application's PowerShell status worker.
        try {
          $marker = ([IO.File]::ReadAllText((Join-Path $rendererDir 'statusbar.pid'))).Trim().Split('|')
          $oldProcess = [Diagnostics.Process]::GetProcessById([int]$marker[0])
          $details = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $oldProcess.Id)
          if ($oldProcess.StartTime.ToFileTimeUtc() -eq [long]$marker[1] -and $oldProcess.ProcessName -eq 'powershell' -and
              $details.CommandLine -match '(?i)-File\s+.*winpilot-statusbar\.ps1"?\s*$') {
            Stop-Process -Id $oldProcess.Id -Force
          }
        } catch { }
      }
      [IO.File]::WriteAllText((Join-Path $rendererDir 'renderer.restart'), $rendererVersion)
      if (-not $rendererMutex.WaitOne(4000)) { $rendererMutex.Dispose(); exit 0 }
    }
  }
  catch [Threading.AbandonedMutexException] { }
  [IO.File]::WriteAllText((Join-Path $rendererDir 'renderer.version'), $rendererVersion)
  Remove-Item -LiteralPath (Join-Path $rendererDir 'renderer.restart') -Force -ErrorAction SilentlyContinue
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
# Windows PowerShell otherwise opts the .NET Framework controls into legacy
# accessibility, which omits UIA InvokePattern for these action buttons.
[AppContext]::SetSwitch('Switch.UseLegacyAccessibilityFeatures', $false)
[AppContext]::SetSwitch('Switch.UseLegacyAccessibilityFeatures.2', $false)
[AppContext]::SetSwitch('Switch.UseLegacyAccessibilityFeatures.3', $false)
$dpiSig = @"
using System;
using System.Runtime.InteropServices;

public static class DshStatusDpi
{
  [DllImport("user32.dll", SetLastError = true)] public static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();

  public static void InitDpiAwareness()
  {
    try
    {
      if (!SetProcessDpiAwarenessContext((IntPtr)(-4)))
      {
        SetProcessDPIAware();
      }
    }
    catch
    {
      try { SetProcessDPIAware(); } catch { }
    }
  }
}
"@
Add-Type -TypeDefinition $dpiSig
[DshStatusDpi]::InitDpiAwareness()
$dir = Join-Path $env:TEMP "win-pilot"
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

$cs = @"
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class DshStatusPill
{
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct SIZE { public int cx; public int cy; }
  [StructLayout(LayoutKind.Sequential)] public struct BLENDFUNCTION { public byte BlendOp; public byte BlendFlags; public byte SourceConstantAlpha; public byte AlphaFormat; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct WNDCLASSW
  {
    public uint style; public IntPtr lpfnWndProc; public int cbClsExtra; public int cbWndExtra;
    public IntPtr hInstance; public IntPtr hIcon; public IntPtr hCursor; public IntPtr hbrBackground;
    [MarshalAs(UnmanagedType.LPWStr)] public string lpszMenuName; [MarshalAs(UnmanagedType.LPWStr)] public string lpszClassName;
  }

  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern ushort RegisterClassW(ref WNDCLASSW wc);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateWindowExW(uint ex, string cls, string name, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr inst, IntPtr param);
  [DllImport("user32.dll")] public static extern IntPtr DefWindowProcW(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
  [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern IntPtr CreateDIBSection(IntPtr dc, ref BITMAPINFO bmi, uint usage, out IntPtr bits, IntPtr section, uint offset);
  [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
  [DllImport("user32.dll")] static extern bool UpdateLayeredWindow(IntPtr h, IntPtr dst, ref POINT p, ref SIZE s, IntPtr src, ref POINT p2, uint key, ref BLENDFUNCTION bf, uint flags);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandleW(string n);

  [StructLayout(LayoutKind.Sequential)]
  public struct BITMAPINFO
  {
    public BITMAPINFOHEADER bmiHeader;
    public uint bmiColors;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct BITMAPINFOHEADER
  {
    public uint biSize; public int biWidth; public int biHeight; public ushort biPlanes; public ushort biBitCount;
    public uint biCompression; public uint biSizeImage; public int biXPelsPerMeter; public int biYPelsPerMeter;
    public uint biClrUsed; public uint biClrImportant;
  }

  public static int W { get { return activityLabel == null ? 320 : 400; } }
  public static int H { get { return activityLabel == null ? 56 : 88; } }
  static IntPtr hwnd = IntPtr.Zero;
  static IntPtr hdcMem = IntPtr.Zero;
  static IntPtr hbm = IntPtr.Zero;
  static IntPtr hbmOld = IntPtr.Zero;
  static IntPtr bitsAt = IntPtr.Zero;
  static WndProc _wndProc;
  delegate IntPtr WndProc(IntPtr h, uint m, IntPtr w, IntPtr l);

  public static void InitDpiAwareness()
  {
    try { if (!SetProcessDpiAwarenessContext((IntPtr)(-4))) SetProcessDPIAware(); }
    catch { try { SetProcessDPIAware(); } catch { } }
  }
  [DllImport("user32.dll", SetLastError = true)] static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

  static GraphicsPath RoundedRect(RectangleF r, float radius)
  {
    GraphicsPath p = new GraphicsPath();
    p.AddArc(r.X, r.Y, radius, radius, 180, 90);
    p.AddArc(r.X + r.Width - radius, r.Y, radius, radius, 270, 90);
    p.AddArc(r.X + r.Width - radius, r.Y + r.Height - radius, radius, radius, 0, 90);
    p.AddArc(r.X, r.Y + r.Height - radius, radius, radius, 90, 90);
    p.CloseFigure();
    return p;
  }

  // The pill follows the Windows display language, so an English install does
  // not show a Chinese label. Resolved once: the pill repaints on a timer.
  static readonly string Label = System.Globalization.CultureInfo
    .CurrentUICulture.TwoLetterISOLanguageName.Equals("zh", StringComparison.OrdinalIgnoreCase)
    ? "Win-Pilot \u8fd0\u884c\u4e2d"
    : "Win-Pilot running";
  static string activityLabel = null;
  public static void SetLabel(string value) { activityLabel = value; }
  static string PillLabel() { return activityLabel ?? Label; }
  static Bitmap RenderBitmap(double breath)
  {
    Bitmap bmp = new Bitmap(W, H, PixelFormat.Format32bppPArgb);
    using (Graphics g = Graphics.FromImage(bmp))
    {
      g.SmoothingMode = SmoothingMode.AntiAlias;
      g.PixelOffsetMode = PixelOffsetMode.HighQuality;
      g.Clear(Color.Transparent);

      var rect = new RectangleF(0.5f, 0.5f, W - 1.0f, H - 1.0f);
      var radius = activityLabel == null ? (float)(H - 1.0) : 40f;
      using (GraphicsPath pill = RoundedRect(rect, radius))
      {
        // Harness dark surface (neutral-bluish-950) with a hairline edge. The old
        // gradient plus a white sheen read as glossy chrome, which is a different
        // product language from the flat, near-black harness surfaces.
        using (var fill = new SolidBrush(Color.FromArgb(activityLabel == null ? 242 : 255, 21, 21, 23)))
        {
          g.FillPath(fill, pill);
        }
        using (var edge = new Pen(Color.FromArgb(31, 255, 255, 255), 1.0f))
        {
          edge.Alignment = PenAlignment.Inset;
          g.DrawPath(edge, pill);
        }
      }

      using (var font = new Font("Segoe UI", activityLabel == null ? 13f : 11f, FontStyle.Regular, GraphicsUnit.Point))
      {
        var fmt = new StringFormat { Alignment = StringAlignment.Near, LineAlignment = StringAlignment.Center,
          Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap };
        var textRect = new RectangleF(20, 0, W - 70, activityLabel == null ? H : 44);
        using (var brush = new SolidBrush(Color.FromArgb(242, 249, 250, 251)))
        {
          g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
          g.DrawString(PillLabel(), font, brush, textRect, fmt);
        }
      }

      // A single soft dot marks the live session. The previous version layered a
      // pulsing halo over a saturated green; this keeps one low-contrast tone so
      // the pill cannot compete with the user's own windows.
      float cx = W - 30f, cy = activityLabel == null ? H / 2f : 22f;
      float alpha = (float)(0.45 + 0.55 * (0.5 + 0.5 * Math.Sin(breath)));
      using (SolidBrush dot = new SolidBrush(Color.FromArgb((int)(255 * alpha), 86, 134, 254)))
      {
        g.FillEllipse(dot, cx - 4, cy - 4, 8, 8);
      }
    }
    return bmp;
  }

  static void RenderSurface(double breath)
  {
    // Legacy and activity layouts can alternate within the same renderer.
    if (hbm != IntPtr.Zero && surfaceHeight != H) {
      SelectObject(hdcMem, hbmOld); DeleteObject(hbm); DeleteDC(hdcMem);
      hbm = hdcMem = hbmOld = IntPtr.Zero;
    }
    using (Bitmap bmp = RenderBitmap(breath))
    {
      var bmi = new BITMAPINFO();
      bmi.bmiHeader.biSize = (uint)Marshal.SizeOf(typeof(BITMAPINFOHEADER));
      bmi.bmiHeader.biWidth = W;
      bmi.bmiHeader.biHeight = -H;
      bmi.bmiHeader.biPlanes = 1;
      bmi.bmiHeader.biBitCount = 32;
      bmi.bmiHeader.biCompression = 0;

      IntPtr dc = GetDC(IntPtr.Zero);
      if (hdcMem == IntPtr.Zero)
      {
        hdcMem = CreateCompatibleDC(dc);
        hbm = CreateDIBSection(hdcMem, ref bmi, 0, out bitsAt, IntPtr.Zero, 0);
        hbmOld = SelectObject(hdcMem, hbm);
        surfaceHeight = H;
      }
      BitmapData data = bmp.LockBits(new Rectangle(0, 0, W, H), ImageLockMode.ReadOnly, PixelFormat.Format32bppPArgb);
      try
      {
        int bytes = Math.Abs(data.Stride) * H;
        byte[] buf = new byte[bytes];
        Marshal.Copy(data.Scan0, buf, 0, bytes);
        Marshal.Copy(buf, 0, bitsAt, bytes);
      }
      finally { bmp.UnlockBits(data); }
      ReleaseDC(IntPtr.Zero, dc);
    }
  }
  static int surfaceHeight;

  static void EnsureWindow()
  {
    InitDpiAwareness();
    if (hwnd != IntPtr.Zero) return;
    var wc = new WNDCLASSW();
    _wndProc = new WndProc(DefWindowProcW);
    wc.lpfnWndProc = Marshal.GetFunctionPointerForDelegate(_wndProc);
    wc.hInstance = GetModuleHandleW(null);
    wc.lpszClassName = "DshStatusPillCls";
    RegisterClassW(ref wc);
    uint ex = 0x80000 | 0x20 | 0x80 | 0x8000000 | 0x8; // LAYERED|TRANSPARENT|TOOLWINDOW|TOPMOST|NOACTIVATE
    uint st = 0x80000000; // WS_POPUP
    hwnd = CreateWindowExW(ex, "DshStatusPillCls", "", st, -4000, -4000, W, H, IntPtr.Zero, IntPtr.Zero, wc.hInstance, IntPtr.Zero);
    RenderSurface(0);
  }

  public static void Show(int x, int y, double breath)
  {
    EnsureWindow();
    if (hwnd == IntPtr.Zero) return;
    RenderSurface(breath);
    POINT p; p.X = x; p.Y = y;
    SIZE s; s.cx = W; s.cy = H;
    POINT p2; p2.X = 0; p2.Y = 0;
    var bf = new BLENDFUNCTION();
    bf.BlendOp = 0; bf.BlendFlags = 0; bf.SourceConstantAlpha = 255; bf.AlphaFormat = 1;
    IntPtr dc = GetDC(IntPtr.Zero);
    UpdateLayeredWindow(hwnd, dc, ref p, ref s, hdcMem, ref p2, 0, ref bf, 2);
    ReleaseDC(IntPtr.Zero, dc);
    SetWindowPos(hwnd, (IntPtr)(-1), x, y, W, H, 0x0010 | 0x0040); // NOACTIVATE|SHOWWINDOW
    ShowWindow(hwnd, 4);
  }

  public static void Hide()
  {
    if (hwnd != IntPtr.Zero) ShowWindow(hwnd, 0);
  }
  public static void RaiseControls(IntPtr controls)
  {
    SetWindowPos(controls, (IntPtr)(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010 | 0x0040);
  }

  public static void Cleanup()
  {
    if (hdcMem != IntPtr.Zero && hbmOld != IntPtr.Zero) { SelectObject(hdcMem, hbmOld); hbmOld = IntPtr.Zero; }
    if (hbm != IntPtr.Zero) { DeleteObject(hbm); hbm = IntPtr.Zero; }
    if (hdcMem != IntPtr.Zero) { DeleteDC(hdcMem); hdcMem = IntPtr.Zero; }
    if (hwnd != IntPtr.Zero) { ShowWindow(hwnd, 0); hwnd = IntPtr.Zero; }
  }

  public static void SaveSampleImage(string path, double breath)
  {
    using (Bitmap bmp = RenderBitmap(breath))
    {
      string dir = System.IO.Path.GetDirectoryName(path);
      if (!string.IsNullOrEmpty(dir) && !System.IO.Directory.Exists(dir)) System.IO.Directory.CreateDirectory(dir);
      bmp.Save(path, ImageFormat.Png);
    }
  }
}
"@
$csFile = Join-Path $dir "dsh-status-pill.cs"
[System.IO.File]::WriteAllText($csFile, $cs, [System.Text.Encoding]::UTF8)
if ($PSVersionTable.PSEdition -eq 'Core') {
  Add-Type -Path $csFile -ReferencedAssemblies "System.Drawing.Common", "System.Drawing.Primitives", "System.Private.Windows.GdiPlus", "System.Private.Windows.Core"
} else {
  Add-Type -Path $csFile -ReferencedAssemblies "System.Drawing"
}

if ($RenderSample -and -not $SampleActivity) {
  [DshStatusPill]::SaveSampleImage($RenderSample, 1.2)
  exit 0
}

$processMarker = "$PID|$([Diagnostics.Process]::GetCurrentProcess().StartTime.ToFileTimeUtc())"
if (-not $RenderSample) { [IO.File]::WriteAllText((Join-Path $dir 'statusbar.pid'), $processMarker) }

Add-Type -TypeDefinition @'
using System;
using System.Drawing;
using System.Windows.Forms;
public class WinPilotChoiceItem {
  public string Name { get; set; }
  public object Record { get; set; }
}
public class WinPilotMenuColors : ProfessionalColorTable {
  public override Color ToolStripDropDownBackground { get { return Color.FromArgb(21,21,23); } }
  public override Color MenuItemSelected { get { return Color.FromArgb(44,44,46); } }
  public override Color MenuItemBorder { get { return Color.FromArgb(44,44,46); } }
  public override Color MenuBorder { get { return Color.FromArgb(49,49,51); } }
}
public class WinPilotChoice : Button {
  public System.Collections.Generic.List<WinPilotChoiceItem> Items = new System.Collections.Generic.List<WinPilotChoiceItem>();
  public string DisplayMember { get; set; }
  public bool DroppedDown { get; private set; }
  int selected = -1;
  public event EventHandler SelectedIndexChanged;
  public WinPilotChoiceItem SelectedItem { get { return selected >= 0 && selected < Items.Count ? Items[selected] : null; } }
  public int SelectedIndex { get { return selected; } set {
    selected = value; Text = SelectedItem == null ? "" : SelectedItem.Name;
    if (SelectedIndexChanged != null) SelectedIndexChanged(this, EventArgs.Empty);
    Invalidate();
  } }
  public void BeginUpdate() { }
  public void EndUpdate() { Invalidate(); }
  protected override void OnClick(EventArgs e) {
    base.OnClick(e);
    var menu = new ContextMenuStrip();
    menu.ShowImageMargin = false; menu.ShowCheckMargin = false; menu.Font = Font;
    menu.Renderer = new ToolStripProfessionalRenderer(new WinPilotMenuColors());
    for (int i = 0; i < Items.Count; i++) {
      int index = i;
      var item = new ToolStripMenuItem(Items[i].Name);
      item.ForeColor = ForeColor; item.Padding = new Padding(8,6,8,6);
      item.Click += delegate { SelectedIndex = index; };
      menu.Items.Add(item);
    }
    DroppedDown = true;
    menu.Closed += delegate { DroppedDown = false; menu.Dispose(); };
    menu.Show(this, new Point(0, Height + 6));
  }
  protected override void OnPaint(PaintEventArgs e) {
    base.OnPaint(e);
    using (var brush = new SolidBrush(BackColor)) e.Graphics.FillRectangle(brush, new Rectangle(0,0,Width,Height));
    TextRenderer.DrawText(e.Graphics, Text, Font, new Rectangle(10,0,Width-32,Height), ForeColor,
      TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
    using (var pen = new Pen(ForeColor,1.2f)) {
      int x=Width-16, y=Height/2-1;
      e.Graphics.DrawLines(pen,new Point[]{ new Point(x-3,y),new Point(x,y+3),new Point(x+3,y) });
    }
  }
}
public class WinPilotControlForm : System.Windows.Forms.Form {
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override System.Windows.Forms.CreateParams CreateParams {
    get { var value = base.CreateParams; value.ExStyle |= 0x08000000 | 0x80; return value; }
  }
}
'@ -ReferencedAssemblies System.Windows.Forms,System.Drawing
$zh = [Globalization.CultureInfo]::CurrentUICulture.TwoLetterISOLanguageName -eq 'zh'
$activityDir = Join-Path $dir 'activity'
$controls = New-Object WinPilotControlForm
$controls.Text = 'Win-Pilot controls'
$controls.FormBorderStyle = 'None'
$controls.ShowInTaskbar = $false
$controls.TopMost = $true
$controls.StartPosition = 'Manual'
$controls.Size = New-Object Drawing.Size(368, 32)
$controls.BackColor = [Drawing.Color]::FromArgb(21, 21, 23)
$controls.Font = New-Object Drawing.Font('Segoe UI', 9)
$selector = New-Object WinPilotChoice
$selector.DisplayMember = 'Name'
$selector.SetBounds(0, 3, 184, 26)
$selector.FlatStyle = 'Flat'
$selector.BackColor = [Drawing.Color]::FromArgb(32, 32, 35)
$selector.ForeColor = [Drawing.Color]::FromArgb(208, 208, 215)
$pauseButton = New-Object Windows.Forms.Button
$pauseButton.SetBounds(192, 2, 80, 28)
$endButton = New-Object Windows.Forms.Button
$endButton.SetBounds(280, 2, 88, 28)
$endButton.Text = $(if ($zh) { '结束控制' } else { 'End' })
foreach ($button in @($selector, $pauseButton, $endButton)) {
  $button.AccessibleRole = 'PushButton'
  $button.FlatStyle = 'Flat'
  $button.FlatAppearance.BorderSize = 0
  # DSH: label-secondary, bg-layer-1, bg-layer-2 and hover-solid.
  $button.ForeColor = [Drawing.Color]::FromArgb(207, 211, 214)
  $button.BackColor = [Drawing.Color]::FromArgb(35, 35, 36)
  $button.FlatAppearance.MouseOverBackColor = [Drawing.Color]::FromArgb(44, 44, 46)
  $button.FlatAppearance.MouseDownBackColor = [Drawing.Color]::FromArgb(53, 54, 56)
  $shape = New-Object Drawing.Drawing2D.GraphicsPath
  $shape.AddArc(0, 0, 12, 12, 180, 90)
  $shape.AddArc(($button.Width - 13), 0, 12, 12, 270, 90)
  $shape.AddArc(($button.Width - 13), ($button.Height - 13), 12, 12, 0, 90)
  $shape.AddArc(0, ($button.Height - 13), 12, 12, 90, 90)
  $shape.CloseFigure()
  $button.Region = New-Object Drawing.Region($shape)
  $shape.Dispose()
}
$controls.Controls.AddRange(@($selector, $pauseButton, $endButton))
$tooltip = New-Object Windows.Forms.ToolTip
$script:controlBusy = $false
$script:activitySignature = ''
function State-Label([string]$State) {
  switch ($State) {
    'running' { if ($zh) { return '运行中' }; return 'Running' }
    'paused' { if ($zh) { return '已暂停' }; return 'Paused' }
    'pausing' { if ($zh) { return '正在暂停' }; return 'Pausing' }
    'takeover' { if ($zh) { return '用户接管' }; return 'Manual control' }
    'login_settings' { if ($zh) { return '等待登录设置' }; return 'Sign-in setup' }
    { $_ -in 'awaiting_login','awaiting_windows_login' } { if ($zh) { return '等待登录' }; return 'Waiting for sign-in' }
    { $_ -in 'preparing','needs_preparation' } { if ($zh) { return '等待系统授权' }; return 'Setup required' }
    'connecting' { if ($zh) { return '正在连接' }; return 'Connecting' }
    'error' { if ($zh) { return '连接失败' }; return 'Connection failed' }
    'disconnected' { if ($zh) { return '已断开' }; return 'Disconnected' }
    'ended' { if ($zh) { return '已结束' }; return 'Ended' }
    default { if ($zh) { return '已完成' }; return 'Complete' }
  }
}
function Environment-Label([string]$Environment) {
  if ($Environment -eq 'task') { if ($zh) { return '独立桌面' }; return 'Task' }
  if ($zh) { return '当前桌面' }; return 'Current'
}
function Update-ControlButtons {
  $entry = $selector.SelectedItem
  $record = if ($entry) { $entry.Record } else { $null }
  $interactive = $record -and $record.endpoint -and $record.state -notin @('ended','idle') -and -not $script:controlBusy
  $canToggle = $record -and $record.state -in @('running','paused','takeover')
  $pauseButton.Enabled = [bool]($interactive -and $canToggle)
  $endButton.Enabled = [bool]$interactive
  $resume = $record -and $record.state -in @('paused','takeover')
  $pauseButton.Text = if ($resume) { if ($zh) { '继续' } else { 'Resume' } } else { if ($zh) { '暂停' } else { 'Pause' } }
  $pauseButton.AccessibleName = $pauseButton.Text
  $endButton.AccessibleName = $endButton.Text
}
function Invoke-ActivityControl([string]$Command) {
  $entry = $selector.SelectedItem
  if (-not $entry -or $script:controlBusy) { return }
  $record = $entry.Record
  if (-not $record.endpoint -or -not $record.token) { return }
  $script:controlBusy = $true
  Update-ControlButtons
  $pipe = $null
  try {
    $pipeName = ([string]$record.endpoint) -replace '^\\\\\.\\pipe\\', ''
    $pipe = New-Object IO.Pipes.NamedPipeClientStream('.', $pipeName, [IO.Pipes.PipeDirection]::InOut, [IO.Pipes.PipeOptions]::Asynchronous)
    $pipe.Connect(1000)
    $writer = New-Object IO.StreamWriter($pipe)
    $writer.AutoFlush = $true
    $reader = New-Object IO.StreamReader($pipe)
    $writer.WriteLine((@{ token=$record.token; command=$Command; session_id=$record.id } | ConvertTo-Json -Compress))
    $pending = $reader.ReadLineAsync()
    $watch = [Diagnostics.Stopwatch]::StartNew()
    while (-not $pending.IsCompleted -and $watch.ElapsedMilliseconds -lt 10000) {
      [Windows.Forms.Application]::DoEvents()
      Start-Sleep -Milliseconds 20
    }
    if (-not $pending.IsCompleted) { throw 'Control is still being processed; inspect its state before trying again.' }
    $response = $pending.GetAwaiter().GetResult() | ConvertFrom-Json
    if (-not $response.ok) { throw ([string]$response.message) }
    $tooltip.SetToolTip($controls, '')
  } catch { $tooltip.SetToolTip($controls, $_.Exception.Message) }
  finally { if ($pipe) { $pipe.Dispose() }; $script:controlBusy = $false; Update-ControlButtons }
}
$selector.Add_SelectedIndexChanged({ Update-ControlButtons })
$pauseButton.Add_Click({
  $record = $selector.SelectedItem.Record
  Invoke-ActivityControl $(if ($record.state -in @('paused','takeover')) { 'resume' } else { 'pause' })
})
$endButton.Add_Click({ Invoke-ActivityControl 'end' })

if ($RenderSample -and $SampleActivity) {
  [DshStatusPill]::SetLabel(('Win-Pilot · ' + (Environment-Label 'task') + ' · ' + (State-Label 'running')))
  $selector.Items.Add((New-Object WinPilotChoiceItem -Property @{ Name=((Environment-Label 'task') + ' 1 · ' + (State-Label 'running')); Record=@{ state='running'; endpoint='sample' } }))
  $selector.SelectedIndex = 0
  Update-ControlButtons
  [DshStatusPill]::SaveSampleImage($RenderSample, 1.2)
  $image = [Drawing.Bitmap]::FromFile($RenderSample)
  $footer = New-Object Drawing.Bitmap(368, 32)
  $controls.Location = New-Object Drawing.Point(-4000, -4000)
  $controls.Show()
  [Windows.Forms.Application]::DoEvents()
  $controls.DrawToBitmap($footer, (New-Object Drawing.Rectangle(0, 0, 368, 32)))
  $graphics = [Drawing.Graphics]::FromImage($image)
  $graphics.DrawImageUnscaled($footer, 16, 44)
  $temporary = $RenderSample + '.tmp.png'
  $image.Save($temporary, [Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose(); $footer.Dispose(); $image.Dispose(); $controls.Dispose(); $tooltip.Dispose()
  Move-Item -LiteralPath $temporary -Destination $RenderSample -Force
  exit 0
}

$lastActive = [DateTime]::Now
$visible = $false
$readyFile = Join-Path $dir 'renderer.ready'
[IO.File]::WriteAllText($readyFile, (@{pid=$PID;version=$rendererVersion} | ConvertTo-Json -Compress))
try {
  while ($true) {
    [Windows.Forms.Application]::DoEvents()
    $restartFile = Join-Path $rendererDir 'renderer.restart'
    if (Test-Path -LiteralPath $restartFile) {
      if ([IO.File]::ReadAllText($restartFile) -ne $rendererVersion) { break }
    }
    $now = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
    $records = @()
    if (Test-Path -LiteralPath $activityDir) {
      foreach ($file in Get-ChildItem -LiteralPath $activityDir -Filter '*.json' -File | Sort-Object Name) {
        try {
          $record = [IO.File]::ReadAllText($file.FullName) | ConvertFrom-Json
          if ($record.expires -gt $now -and $record.expires -lt ($now + 30000)) { $records += $record }
          elseif ($record.expires -le $now) { Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue }
        } catch { }
      }
    }
    $legacy = $false
    if ($records.Count -eq 0) {
      try {
        $old = [IO.File]::ReadAllText((Join-Path $dir 'status.state')) | ConvertFrom-Json
        $legacy = $old.show -and ($now - [double]$old.ts) -ge 0 -and ($now - [double]$old.ts) -lt 6000
      } catch { }
    }
    if ($records.Count -gt 0 -or $legacy) {
      $lastActive = [DateTime]::Now
      if ($records.Count -gt 0) {
        $signature = ($records | ForEach-Object { $_.owner + ':' + $_.id + ':' + $_.state }) -join '|'
        if ($signature -ne $script:activitySignature -and -not $selector.DroppedDown -and -not $script:controlBusy) {
          $selectedId = if ($selector.SelectedItem) { $selector.SelectedItem.Record.id } else { '' }
          $selector.BeginUpdate(); $selector.Items.Clear(); $index = 0; $selectedIndex = 0
          foreach ($item in $records) {
            $name = (Environment-Label $item.environment) + ' ' + ($index + 1) + ' · ' + (State-Label $item.state)
            $selector.Items.Add((New-Object WinPilotChoiceItem -Property @{ Name=$name; Record=$item }))
            if ($item.id -eq $selectedId) { $selectedIndex = $index }
            $index++
          }
          $selector.SelectedIndex = $selectedIndex; $selector.EndUpdate()
          $script:activitySignature = $signature
          Update-ControlButtons
        }
        $record = $selector.SelectedItem.Record
        $label = 'Win-Pilot · ' + (Environment-Label $record.environment) + ' · ' + (State-Label $record.state)
        if ($records.Count -gt 1) { $label += ' (+' + ($records.Count - 1) + ')' }
        [DshStatusPill]::SetLabel($label)
        $x = [int](([Windows.Forms.Screen]::PrimaryScreen.Bounds.Width - [DshStatusPill]::W) / 2)
        $controls.Location = New-Object Drawing.Point(($x + 16), 58)
        if (-not $controls.Visible) { $controls.Show() }
      } else {
        [DshStatusPill]::SetLabel($null); $controls.Hide()
        $x = [int](([Windows.Forms.Screen]::PrimaryScreen.Bounds.Width - [DshStatusPill]::W) / 2)
      }
      $breath = $now / 1000.0 * (2 * [Math]::PI / 1.8)
      [DshStatusPill]::Show($x, 14, $breath)
      if ($records.Count -gt 0) { [DshStatusPill]::RaiseControls($controls.Handle) }
      $visible = $true
    } elseif ($visible) { [DshStatusPill]::Hide(); $controls.Hide(); $visible = $false }
    if (([DateTime]::Now - $lastActive).TotalSeconds -ge 120) { break }
    Start-Sleep -Milliseconds 80
  }
} finally {
  [DshStatusPill]::Hide(); [DshStatusPill]::Cleanup(); $controls.Dispose(); $tooltip.Dispose()
  $pidFile = Join-Path $dir 'statusbar.pid'
  if (Test-Path -LiteralPath $pidFile) {
    if (([IO.File]::ReadAllText($pidFile)).Trim() -eq $processMarker) { Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue }
  }
  if ($rendererMutex) { $rendererMutex.ReleaseMutex(); $rendererMutex.Dispose() }
  try {
    if (([IO.File]::ReadAllText($readyFile) | ConvertFrom-Json).pid -eq $PID) { Remove-Item -LiteralPath $readyFile -Force }
  } catch { }
}
