param(
  [string]$RenderSample = "",
  [string]$TransitionSample = ""
)
$ErrorActionPreference = "SilentlyContinue"

function Get-CursorTransitionPoints {
  param(
    [int]$StartX,
    [int]$StartY,
    [int]$EndX,
    [int]$EndY,
    [int]$DurationMs
  )
  $frameCount = [Math]::Max(2, [int][Math]::Ceiling($DurationMs / 16.0))
  $points = @()
  for ($frame = 0; $frame -le $frameCount; $frame++) {
    $t = $frame / [double]$frameCount
    # Smoothstep eases both ends, avoiding a mechanical jump or abrupt stop.
    $eased = $t * $t * (3.0 - (2.0 * $t))
    $points += [pscustomobject]@{
      x = [int][Math]::Round($StartX + (($EndX - $StartX) * $eased))
      y = [int][Math]::Round($StartY + (($EndY - $StartY) * $eased))
    }
  }
  return $points
}

if ($TransitionSample) {
  $values = @($TransitionSample.Split(',') | ForEach-Object { [int]$_.Trim() })
  if ($values.Count -ne 5) { throw 'TransitionSample must be startX,startY,endX,endY,durationMs' }
  @(Get-CursorTransitionPoints @values) | ConvertTo-Json -Compress
  exit 0
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
# DPI-aware FIRST: window coords are then physical pixels, matching the physical UIA coords
# the helper writes into cursor.state. Without this, DWM scales our position by the DPI factor.
$dpiSig = @"
using System;
using System.Runtime.InteropServices;

public static class DshDpi
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
[DshDpi]::InitDpiAwareness()
$dir = Join-Path $env:TEMP "win-pilot"
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$processMarker = "$PID|$([Diagnostics.Process]::GetCurrentProcess().StartTime.ToFileTimeUtc())"
Set-Content -Path (Join-Path $dir "overlay.pid") -Value $processMarker -Encoding ascii
$b64 = "dXNpbmcgU3lzdGVtOwp1c2luZyBTeXN0ZW0uRHJhd2luZzsKdXNpbmcgU3lzdGVtLkRyYXdpbmcuRHJhd2luZzJEOwp1c2luZyBTeXN0ZW0uRHJhd2luZy5JbWFnaW5nOwp1c2luZyBTeXN0ZW0uUnVudGltZS5JbnRlcm9wU2VydmljZXM7CgpwdWJsaWMgc3RhdGljIGNsYXNzIERzaFZjTGF5ZXIKewogIFtTdHJ1Y3RMYXlvdXQoTGF5b3V0S2luZC5TZXF1ZW50aWFsKV0gcHVibGljIHN0cnVjdCBQT0lOVCB7IHB1YmxpYyBpbnQgWDsgcHVibGljIGludCBZOyB9CiAgW1N0cnVjdExheW91dChMYXlvdXRLaW5kLlNlcXVlbnRpYWwpXSBwdWJsaWMgc3RydWN0IFNJWkUgeyBwdWJsaWMgaW50IGN4OyBwdWJsaWMgaW50IGN5OyB9CiAgW1N0cnVjdExheW91dChMYXlvdXRLaW5kLlNlcXVlbnRpYWwpXSBwdWJsaWMgc3RydWN0IEJMRU5ERlVOQ1RJT04geyBwdWJsaWMgYnl0ZSBCbGVuZE9wOyBwdWJsaWMgYnl0ZSBCbGVuZEZsYWdzOyBwdWJsaWMgYnl0ZSBTb3VyY2VDb25zdGFudEFscGhhOyBwdWJsaWMgYnl0ZSBBbHBoYUZvcm1hdDsgfQogIFtTdHJ1Y3RMYXlvdXQoTGF5b3V0S2luZC5TZXF1ZW50aWFsKV0gcHVibGljIHN0cnVjdCBXTkRDTEFTU1cKICB7CiAgICBwdWJsaWMgdWludCBzdHlsZTsKICAgIHB1YmxpYyBJbnRQdHIgbHBmblduZFByb2M7CiAgICBwdWJsaWMgaW50IGNiQ2xzRXh0cmE7CiAgICBwdWJsaWMgaW50IGNiV25kRXh0cmE7CiAgICBwdWJsaWMgSW50UHRyIGhJbnN0YW5jZTsKICAgIHB1YmxpYyBJbnRQdHIgaEljb247CiAgICBwdWJsaWMgSW50UHRyIGhDdXJzb3I7CiAgICBwdWJsaWMgSW50UHRyIGhickJhY2tncm91bmQ7CiAgICBbTWFyc2hhbEFzKFVubWFuYWdlZFR5cGUuTFBXU3RyKV0gcHVibGljIHN0cmluZyBscHN6TWVudU5hbWU7CiAgICBbTWFyc2hhbEFzKFVubWFuYWdlZFR5cGUuTFBXU3RyKV0gcHVibGljIHN0cmluZyBscHN6Q2xhc3NOYW1lOwogIH0KICBbU3RydWN0TGF5b3V0KExheW91dEtpbmQuU2VxdWVudGlhbCldIHB1YmxpYyBzdHJ1Y3QgQklUTUFQSU5GT0hFQURFUgogIHsKICAgIHB1YmxpYyB1aW50IGJpU2l6ZTsKICAgIHB1YmxpYyBpbnQgYmlXaWR0aDsKICAgIHB1YmxpYyBpbnQgYmlIZWlnaHQ7CiAgICBwdWJsaWMgdXNob3J0IGJpUGxhbmVzOwogICAgcHVibGljIHVzaG9ydCBiaUJpdENvdW50OwogICAgcHVibGljIHVpbnQgYmlDb21wcmVzc2lvbjsKICAgIHB1YmxpYyB1aW50IGJpU2l6ZUltYWdlOwogICAgcHVibGljIGludCBiaVhQZWxzUGVyTWV0ZXI7CiAgICBwdWJsaWMgaW50IGJpWVBlbHNQZXJNZXRlcjsKICAgIHB1YmxpYyB1aW50IGJpQ2xyVXNlZDsKICAgIHB1YmxpYyB1aW50IGJpQ2xySW1wb3J0YW50OwogIH0KICBbU3RydWN0TGF5b3V0KExheW91dEtpbmQuU2VxdWVudGlhbCldIHB1YmxpYyBzdHJ1Y3QgQklUTUFQSU5GTwogIHsKICAgIHB1YmxpYyBCSVRNQVBJTkZPSEVBREVSIGJtaUhlYWRlcjsKICAgIHB1YmxpYyB1aW50IGJtaUNvbG9yczsKICB9CgogIFtEbGxJbXBvcnQoInVzZXIzMi5kbGwiLCBDaGFyU2V0ID0gQ2hhclNldC5Vbmljb2RlKV0gc3RhdGljIGV4dGVybiB1c2hvcnQgUmVnaXN0ZXJDbGFzc1cocmVmIFdORENMQVNTVyB3Yyk7CiAgW0RsbEltcG9ydCgidXNlcjMyLmRsbCIsIENoYXJTZXQgPSBDaGFyU2V0LlVuaWNvZGUpXSBzdGF0aWMgZXh0ZXJuIEludFB0ciBDcmVhdGVXaW5kb3dFeFcodWludCBleCwgc3RyaW5nIGNscywgc3RyaW5nIG5hbWUsIHVpbnQgc3R5bGUsIGludCB4LCBpbnQgeSwgaW50IHcsIGludCBoLCBJbnRQdHIgcGFyZW50LCBJbnRQdHIgbWVudSwgSW50UHRyIGluc3QsIEludFB0ciBwYXJhbSk7CiAgW0RsbEltcG9ydCgidXNlcjMyLmRsbCIpXSBzdGF0aWMgZXh0ZXJuIEludFB0ciBEZWZXaW5kb3dQcm9jVyhJbnRQdHIgaCwgdWludCBtLCBJbnRQdHIgdywgSW50UHRyIGwpOwogICAgW0RsbEltcG9ydCgidXNlcjMyLmRsbCIpXSBwdWJsaWMgc3RhdGljIGV4dGVybiBib29sIFNob3dXaW5kb3coSW50UHRyIGgsIGludCBjbWQpOwogIFtEbGxJbXBvcnQoInVzZXIzMi5kbGwiKV0gcHVibGljIHN0YXRpYyBleHRlcm4gYm9vbCBTZXRXaW5kb3dQb3MoSW50UHRyIGhXbmQsIEludFB0ciBoV25kSW5zZXJ0QWZ0ZXIsIGludCBYLCBpbnQgWSwgaW50IGN4LCBpbnQgY3ksIHVpbnQgdUZsYWdzKTsKICBwdWJsaWMgc3RhdGljIHJlYWRvbmx5IEludFB0ciBIV05EX1RPUE1PU1QgPSBuZXcgSW50UHRyKC0xKTsKICBwdWJsaWMgY29uc3QgdWludCBTV1BfTk9TSVpFID0gMHgwMDAxOwogIHB1YmxpYyBjb25zdCB1aW50IFNXUF9OT01PVkUgPSAweDAwMDI7CiAgcHVibGljIGNvbnN0IHVpbnQgU1dQX05PQUNUSVZBVEUgPSAweDAwMTA7CiAgcHVibGljIGNvbnN0IHVpbnQgU1dQX1NIT1dXSU5ET1cgPSAweDAwNDA7CiAgW0RsbEltcG9ydCgidXNlcjMyLmRsbCIpXSBzdGF0aWMgZXh0ZXJuIGJvb2wgRGVzdHJveVdpbmRvdyhJbnRQdHIgaCk7CiAgW0RsbEltcG9ydCgidXNlcjMyLmRsbCIsIFNldExhc3RFcnJvciA9IHRydWUpXSBwdWJsaWMgc3RhdGljIGV4dGVybiBib29sIFNldFByb2Nlc3NEcGlBd2FyZW5lc3NDb250ZXh0KEludFB0ciBkcGlDb250ZXh0KTsKICBbRGxsSW1wb3J0KCJ1c2VyMzIuZGxsIildIHB1YmxpYyBzdGF0aWMgZXh0ZXJuIGJvb2wgU2V0UHJvY2Vzc0RQSUF3YXJlKCk7CiAgW0RsbEltcG9ydCgia2VybmVsMzIuZGxsIildIHN0YXRpYyBleHRlcm4gSW50UHRyIEdldE1vZHVsZUhhbmRsZVcoc3RyaW5nIG4pOwogIFtEbGxJbXBvcnQoInVzZXIzMi5kbGwiKV0gc3RhdGljIGV4dGVybiBJbnRQdHIgR2V0REMoSW50UHRyIGgpOwogIFtEbGxJbXBvcnQoInVzZXIzMi5kbGwiKV0gc3RhdGljIGV4dGVybiBpbnQgUmVsZWFzZURDKEludFB0ciBoLCBJbnRQdHIgZGMpOwogIFtEbGxJbXBvcnQoImdkaTMyLmRsbCIpXSBzdGF0aWMgZXh0ZXJuIEludFB0ciBDcmVhdGVDb21wYXRpYmxlREMoSW50UHRyIGRjKTsKICBbRGxsSW1wb3J0KCJnZGkzMi5kbGwiKV0gc3RhdGljIGV4dGVybiBib29sIERlbGV0ZURDKEludFB0ciBkYyk7CiAgW0RsbEltcG9ydCgiZ2RpMzIuZGxsIildIHN0YXRpYyBleHRlcm4gSW50UHRyIENyZWF0ZURJQlNlY3Rpb24oSW50UHRyIGRjLCByZWYgQklUTUFQSU5GTyBibWksIHVpbnQgdXNhZ2UsIG91dCBJbnRQdHIgYml0cywgSW50UHRyIHNlY3Rpb24sIHVpbnQgb2Zmc2V0KTsKICBbRGxsSW1wb3J0KCJnZGkzMi5kbGwiKV0gc3RhdGljIGV4dGVybiBJbnRQdHIgU2VsZWN0T2JqZWN0KEludFB0ciBkYywgSW50UHRyIG9iaik7CiAgW0RsbEltcG9ydCgiZ2RpMzIuZGxsIildIHN0YXRpYyBleHRlcm4gYm9vbCBEZWxldGVPYmplY3QoSW50UHRyIG9iaik7CiAgW0RsbEltcG9ydCgidXNlcjMyLmRsbCIpXSBzdGF0aWMgZXh0ZXJuIGJvb2wgVXBkYXRlTGF5ZXJlZFdpbmRvdyhJbnRQdHIgaCwgSW50UHRyIGRzdCwgcmVmIFBPSU5UIHAsIHJlZiBTSVpFIHMsIEludFB0ciBzcmMsIHJlZiBQT0lOVCBwMiwgdWludCBrZXksIHJlZiBCTEVOREZVTkNUSU9OIGJmLCB1aW50IGZsYWdzKTsKCiAgcHVibGljIGNvbnN0IGludCBXID0gOTYsIEggPSA5NjsKICBwdWJsaWMgY29uc3QgaW50IFRpcFggPSAzNiwgVGlwWSA9IDM4OwoKICBzdGF0aWMgSW50UHRyIGh3bmQgPSBJbnRQdHIuWmVybzsKICBzdGF0aWMgSW50UHRyIGhkY01lbSA9IEludFB0ci5aZXJvOwogIHN0YXRpYyBJbnRQdHIgaGJtID0gSW50UHRyLlplcm87CiAgc3RhdGljIEludFB0ciBoYm1PbGQgPSBJbnRQdHIuWmVybzsKICBzdGF0aWMgYm9vbCBkcGlEb25lID0gZmFsc2U7CiAgcHJpdmF0ZSBzdGF0aWMgV25kUHJvYyBfd25kUHJvYzsKCiAgZGVsZWdhdGUgSW50UHRyIFduZFByb2MoSW50UHRyIGgsIHVpbnQgbSwgSW50UHRyIHcsIEludFB0ciBsKTsKCiAgcHVibGljIHN0YXRpYyB2b2lkIEluaXREcGlBd2FyZW5lc3MoKQogIHsKICAgIGlmIChkcGlEb25lKSByZXR1cm47CiAgICBkcGlEb25lID0gdHJ1ZTsKICAgIHRyeQogICAgewogICAgICBpZiAoIVNldFByb2Nlc3NEcGlBd2FyZW5lc3NDb250ZXh0KChJbnRQdHIpKC00KSkpCiAgICAgIHsKICAgICAgICBTZXRQcm9jZXNzRFBJQXdhcmUoKTsKICAgICAgfQogICAgfQogICAgY2F0Y2gKICAgIHsKICAgICAgdHJ5IHsgU2V0UHJvY2Vzc0RQSUF3YXJlKCk7IH0gY2F0Y2ggeyB9CiAgICB9CiAgfQoKICBwdWJsaWMgc3RhdGljIEJpdG1hcCBSZW5kZXJCaXRtYXAoKQogIHsKICAgIEJpdG1hcCBibXAgPSBuZXcgQml0bWFwKFcsIEgsIFBpeGVsRm9ybWF0LkZvcm1hdDMyYnBwUEFyZ2IpOwogICAgdXNpbmcgKEdyYXBoaWNzIGcgPSBHcmFwaGljcy5Gcm9tSW1hZ2UoYm1wKSkKICAgIHsKICAgICAgZy5TbW9vdGhpbmdNb2RlID0gU21vb3RoaW5nTW9kZS5BbnRpQWxpYXM7CiAgICAgIGcuUGl4ZWxPZmZzZXRNb2RlID0gUGl4ZWxPZmZzZXRNb2RlLkhpZ2hRdWFsaXR5OwogICAgICBnLkludGVycG9sYXRpb25Nb2RlID0gSW50ZXJwb2xhdGlvbk1vZGUuSGlnaFF1YWxpdHlCaWN1YmljOwogICAgICBnLkNsZWFyKENvbG9yLlRyYW5zcGFyZW50KTsKCiAgICAgIC8vIExheWVyIDEgKEJhY2tncm91bmQpOiBTb2Z0IHJhZGlhbCBibHVlIGdsb3cgY2VudGVyZWQgbmVhciB0aGUgdGlwIChyYWRpdXMgfjIycHgsICMwQTg0RkYpCiAgICAgIGZsb2F0IGdsb3dSYWRpdXMgPSAyMmY7CiAgICAgIHVzaW5nIChHcmFwaGljc1BhdGggZ2xvd1BhdGggPSBuZXcgR3JhcGhpY3NQYXRoKCkpCiAgICAgIHsKICAgICAgICBnbG93UGF0aC5BZGRFbGxpcHNlKChmbG9hdClUaXBYIC0gZ2xvd1JhZGl1cywgKGZsb2F0KVRpcFkgLSBnbG93UmFkaXVzLCBnbG93UmFkaXVzICogMmYsIGdsb3dSYWRpdXMgKiAyZik7CiAgICAgICAgdXNpbmcgKFBhdGhHcmFkaWVudEJydXNoIHBnYiA9IG5ldyBQYXRoR3JhZGllbnRCcnVzaChnbG93UGF0aCkpCiAgICAgICAgewogICAgICAgICAgcGdiLkNlbnRlclBvaW50ID0gbmV3IFBvaW50RigoZmxvYXQpVGlwWCwgKGZsb2F0KVRpcFkpOwogICAgICAgICAgcGdiLkNlbnRlckNvbG9yID0gQ29sb3IuRnJvbUFyZ2IoMTQwLCAzNywgOTksIDIzNSk7CiAgICAgICAgICBwZ2IuU3Vycm91bmRDb2xvcnMgPSBuZXcgQ29sb3JbXSB7IENvbG9yLkZyb21BcmdiKDAsIDM3LCA5OSwgMjM1KSB9OwogICAgICAgICAgZy5GaWxsUGF0aChwZ2IsIGdsb3dQYXRoKTsKICAgICAgICB9CiAgICAgIH0KCiAgICAgIC8vIFBvaW50ZXIgdmVjdG9yIGdlb21ldHJ5OiBzbGVlaywgY3Jpc3AgbWFjT1MvQ29kZXgtc3R5bGUgcG9pbnRlciAofjEzLjUgeCAyMS41cHgpCiAgICAgIFBvaW50RltdIHB0cyA9IG5ldyBQb2ludEZbXQogICAgICB7CiAgICAgICAgbmV3IFBvaW50RigoZmxvYXQpVGlwWCArIDAuMGYsICAoZmxvYXQpVGlwWSArIDAuMGYpLAogICAgICAgIG5ldyBQb2ludEYoKGZsb2F0KVRpcFggKyAwLjBmLCAgKGZsb2F0KVRpcFkgKyAxNy4wZiksCiAgICAgICAgbmV3IFBvaW50RigoZmxvYXQpVGlwWCArIDQuM2YsICAoZmxvYXQpVGlwWSArIDEzLjVmKSwKICAgICAgICBuZXcgUG9pbnRGKChmbG9hdClUaXBYICsgNy40ZiwgIChmbG9hdClUaXBZICsgMjEuNWYpLAogICAgICAgIG5ldyBQb2ludEYoKGZsb2F0KVRpcFggKyAxMC41ZiwgKGZsb2F0KVRpcFkgKyAyMC4zZiksCiAgICAgICAgbmV3IFBvaW50RigoZmxvYXQpVGlwWCArIDcuNGYsICAoZmxvYXQpVGlwWSArIDEyLjNmKSwKICAgICAgICBuZXcgUG9pbnRGKChmbG9hdClUaXBYICsgMTMuNWYsIChmbG9hdClUaXBZICsgMTIuM2YpCiAgICAgIH07CgogICAgICB1c2luZyAoR3JhcGhpY3NQYXRoIHBvaW50ZXJQYXRoID0gbmV3IEdyYXBoaWNzUGF0aCgpKQogICAgICB7CiAgICAgICAgcG9pbnRlclBhdGguQWRkUG9seWdvbihwdHMpOwoKICAgICAgICAvLyBMYXllciAyIChCb3JkZXIgLyBDb250cmFzdCk6IENyaXNwIG91dGxpbmUgY29udG91ciBzbyBjdXJzb3Igc3RhbmRzIG91dCBvbiB3aGl0ZSBhbmQgZGFyayBiYWNrZ3JvdW5kcwogICAgICAgIHVzaW5nIChQZW4gZGFya1BlbiA9IG5ldyBQZW4oQ29sb3IuRnJvbUFyZ2IoMjAwLCAxNSwgMTcsIDIxKSwgMi44ZikpCiAgICAgICAgewogICAgICAgICAgZGFya1Blbi5MaW5lSm9pbiA9IExpbmVKb2luLk1pdGVyOwogICAgICAgICAgZGFya1Blbi5NaXRlckxpbWl0ID0gMy4wZjsKICAgICAgICAgIGcuRHJhd1BhdGgoZGFya1BlbiwgcG9pbnRlclBhdGgpOwogICAgICAgIH0KICAgICAgICB1c2luZyAoUGVuIGJsdWVQZW4gPSBuZXcgUGVuKENvbG9yLkZyb21BcmdiKDI1NSwgMzcsIDk5LCAyMzUpLCAyLjBmKSkKICAgICAgICB7CiAgICAgICAgICBibHVlUGVuLkxpbmVKb2luID0gTGluZUpvaW4uTWl0ZXI7CiAgICAgICAgICBibHVlUGVuLk1pdGVyTGltaXQgPSAzLjBmOwogICAgICAgICAgZy5EcmF3UGF0aChibHVlUGVuLCBwb2ludGVyUGF0aCk7CiAgICAgICAgfQoKICAgICAgICAvLyBMYXllciAzIChCb2R5KTogUHVyZSBjcmlzcCB3aGl0ZSAoI0ZGRkZGRiwgYWxwaGEgPj0gMjUwKSBib2R5IHdpdGggc21vb3RoIHN1YnBpeGVsIGFudGktYWxpYXNlZCBlZGdlcwogICAgICAgIHVzaW5nIChCcnVzaCB3aGl0ZUJydXNoID0gbmV3IFNvbGlkQnJ1c2goQ29sb3IuRnJvbUFyZ2IoMjU1LCAyNTUsIDI1NSwgMjU1KSkpCiAgICAgICAgewogICAgICAgICAgZy5GaWxsUGF0aCh3aGl0ZUJydXNoLCBwb2ludGVyUGF0aCk7CiAgICAgICAgfQogICAgICB9CiAgICB9CiAgICByZXR1cm4gYm1wOwogIH0KCiAgcHVibGljIHN0YXRpYyB2b2lkIFNhdmVTYW1wbGVJbWFnZShzdHJpbmcgcGF0aCkKICB7CiAgICB1c2luZyAoQml0bWFwIGJtcCA9IFJlbmRlckJpdG1hcCgpKQogICAgewogICAgICBzdHJpbmcgZGlyID0gU3lzdGVtLklPLlBhdGguR2V0RGlyZWN0b3J5TmFtZShwYXRoKTsKICAgICAgaWYgKCFzdHJpbmcuSXNOdWxsT3JFbXB0eShkaXIpICYmICFTeXN0ZW0uSU8uRGlyZWN0b3J5LkV4aXN0cyhkaXIpKQogICAgICB7CiAgICAgICAgU3lzdGVtLklPLkRpcmVjdG9yeS5DcmVhdGVEaXJlY3RvcnkoZGlyKTsKICAgICAgfQogICAgICBibXAuU2F2ZShwYXRoLCBJbWFnZUZvcm1hdC5QbmcpOwogICAgfQogIH0KCiAgc3RhdGljIHZvaWQgUmVuZGVyU3VyZmFjZSgpCiAgewogICAgdXNpbmcgKEJpdG1hcCBibXAgPSBSZW5kZXJCaXRtYXAoKSkKICAgIHsKICAgICAgdmFyIGJtaSA9IG5ldyBCSVRNQVBJTkZPKCk7CiAgICAgIGJtaS5ibWlIZWFkZXIuYmlTaXplID0gKHVpbnQpTWFyc2hhbC5TaXplT2YodHlwZW9mKEJJVE1BUElORk9IRUFERVIpKTsKICAgICAgYm1pLmJtaUhlYWRlci5iaVdpZHRoID0gVzsKICAgICAgYm1pLmJtaUhlYWRlci5iaUhlaWdodCA9IC1IOwogICAgICBibWkuYm1pSGVhZGVyLmJpUGxhbmVzID0gMTsKICAgICAgYm1pLmJtaUhlYWRlci5iaUJpdENvdW50ID0gMzI7CiAgICAgIGJtaS5ibWlIZWFkZXIuYmlDb21wcmVzc2lvbiA9IDA7CgogICAgICBJbnRQdHIgZGMgPSBHZXREQyhJbnRQdHIuWmVybyk7CiAgICAgIGhkY01lbSA9IENyZWF0ZUNvbXBhdGlibGVEQyhkYyk7CiAgICAgIFJlbGVhc2VEQyhJbnRQdHIuWmVybywgZGMpOwoKICAgICAgSW50UHRyIGJpdHM7CiAgICAgIGhibSA9IENyZWF0ZURJQlNlY3Rpb24oaGRjTWVtLCByZWYgYm1pLCAwLCBvdXQgYml0cywgSW50UHRyLlplcm8sIDApOwogICAgICBoYm1PbGQgPSBTZWxlY3RPYmplY3QoaGRjTWVtLCBoYm0pOwoKICAgICAgQml0bWFwRGF0YSBkYXRhID0gYm1wLkxvY2tCaXRzKG5ldyBSZWN0YW5nbGUoMCwgMCwgVywgSCksIEltYWdlTG9ja01vZGUuUmVhZE9ubHksIFBpeGVsRm9ybWF0LkZvcm1hdDMyYnBwUEFyZ2IpOwogICAgICB0cnkKICAgICAgewogICAgICAgIGludCBieXRlQ291bnQgPSBNYXRoLkFicyhkYXRhLlN0cmlkZSkgKiBIOwogICAgICAgIGJ5dGVbXSBidWYgPSBuZXcgYnl0ZVtieXRlQ291bnRdOwogICAgICAgIE1hcnNoYWwuQ29weShkYXRhLlNjYW4wLCBidWYsIDAsIGJ5dGVDb3VudCk7CiAgICAgICAgTWFyc2hhbC5Db3B5KGJ1ZiwgMCwgYml0cywgYnl0ZUNvdW50KTsKICAgICAgfQogICAgICBmaW5hbGx5CiAgICAgIHsKICAgICAgICBibXAuVW5sb2NrQml0cyhkYXRhKTsKICAgICAgfQogICAgfQogIH0KCiAgc3RhdGljIHZvaWQgRW5zdXJlV2luZG93KCkKICB7CiAgICBJbml0RHBpQXdhcmVuZXNzKCk7CiAgICBpZiAoaHduZCAhPSBJbnRQdHIuWmVybykgcmV0dXJuOwogICAgdmFyIHdjID0gbmV3IFdORENMQVNTVygpOwogICAgX3duZFByb2MgPSBEZWZXaW5kb3dQcm9jVzsKICAgIHdjLmxwZm5XbmRQcm9jID0gTWFyc2hhbC5HZXRGdW5jdGlvblBvaW50ZXJGb3JEZWxlZ2F0ZShfd25kUHJvYyk7CiAgICB3Yy5oSW5zdGFuY2UgPSBHZXRNb2R1bGVIYW5kbGVXKG51bGwpOwogICAgd2MubHBzekNsYXNzTmFtZSA9ICJEc2hWY0xheWVyQ2xzIjsKICAgIFJlZ2lzdGVyQ2xhc3NXKHJlZiB3Yyk7CiAgICB1aW50IGV4ID0gMHg4MDAwMCB8IDB4MjAgfCAweDgwMDAwMDAgfCAweDgwIHwgMHg4OwogICAgdWludCBzdCA9IDB4ODAwMDAwMDA7CiAgICBod25kID0gQ3JlYXRlV2luZG93RXhXKGV4LCAiRHNoVmNMYXllckNscyIsICIiLCBzdCwgLTMwMDAsIC0zMDAwLCBXLCBILCBJbnRQdHIuWmVybywgSW50UHRyLlplcm8sIHdjLmhJbnN0YW5jZSwgSW50UHRyLlplcm8pOwogICAgUmVuZGVyU3VyZmFjZSgpOwogIH0KCiAgcHVibGljIHN0YXRpYyB2b2lkIFNob3coaW50IHgsIGludCB5KQogIHsKICAgIEVuc3VyZVdpbmRvdygpOwogICAgaWYgKGh3bmQgPT0gSW50UHRyLlplcm8pIHJldHVybjsKICAgIFBPSU5UIHA7IHAuWCA9IHggLSBUaXBYOyBwLlkgPSB5IC0gVGlwWTsKICAgIFNJWkUgczsgcy5jeCA9IFc7IHMuY3kgPSBIOwogICAgUE9JTlQgcDI7IHAyLlggPSAwOyBwMi5ZID0gMDsKICAgIHZhciBiZiA9IG5ldyBCTEVOREZVTkNUSU9OKCk7CiAgICBiZi5CbGVuZE9wID0gMHgwMDsKICAgIGJmLkJsZW5kRmxhZ3MgPSAwOwogICAgYmYuU291cmNlQ29uc3RhbnRBbHBoYSA9IDI1NTsKICAgIGJmLkFscGhhRm9ybWF0ID0gMTsKICAgIEludFB0ciBkYyA9IEdldERDKEludFB0ci5aZXJvKTsKICAgIFVwZGF0ZUxheWVyZWRXaW5kb3coaHduZCwgZGMsIHJlZiBwLCByZWYgcywgaGRjTWVtLCByZWYgcDIsIDAsIHJlZiBiZiwgMik7CiAgICBSZWxlYXNlREMoSW50UHRyLlplcm8sIGRjKTsKICAgIFNldFdpbmRvd1Bvcyhod25kLCAoSW50UHRyKSgtMSkgLyogSFdORF9UT1BNT1NUICovLCBwLlgsIHAuWSwgVywgSCwgU1dQX05PQUNUSVZBVEUgfCBTV1BfU0hPV1dJTkRPVyk7CiAgICBTaG93V2luZG93KGh3bmQsIDQpOwogIH0KCiAgcHVibGljIHN0YXRpYyB2b2lkIEhpZGUoKQogIHsKICAgIGlmIChod25kICE9IEludFB0ci5aZXJvKSBTaG93V2luZG93KGh3bmQsIDApOwogIH0KCiAgcHVibGljIHN0YXRpYyB2b2lkIENsZWFudXAoKQogIHsKICAgIGlmIChoZGNNZW0gIT0gSW50UHRyLlplcm8gJiYgaGJtT2xkICE9IEludFB0ci5aZXJvKQogICAgewogICAgICBTZWxlY3RPYmplY3QoaGRjTWVtLCBoYm1PbGQpOwogICAgICBoYm1PbGQgPSBJbnRQdHIuWmVybzsKICAgIH0KICAgIGlmIChoYm0gIT0gSW50UHRyLlplcm8pCiAgICB7CiAgICAgIERlbGV0ZU9iamVjdChoYm0pOwogICAgICBoYm0gPSBJbnRQdHIuWmVybzsKICAgIH0KICAgIGlmIChoZGNNZW0gIT0gSW50UHRyLlplcm8pCiAgICB7CiAgICAgIERlbGV0ZURDKGhkY01lbSk7CiAgICAgIGhkY01lbSA9IEludFB0ci5aZXJvOwogICAgfQogICAgaWYgKGh3bmQgIT0gSW50UHRyLlplcm8pCiAgICB7CiAgICAgIERlc3Ryb3lXaW5kb3coaHduZCk7CiAgICAgIGh3bmQgPSBJbnRQdHIuWmVybzsKICAgIH0KICB9Cn0="
$csFile = Join-Path $dir "dsh-vc-layer.cs"
[System.IO.File]::WriteAllText($csFile, [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($b64)))
if ($PSVersionTable.PSEdition -eq 'Core') {
  Add-Type -Path $csFile -ReferencedAssemblies "System.Drawing.Common", "System.Drawing.Primitives", "System.Private.Windows.GdiPlus", "System.Private.Windows.Core"
} else {
  Add-Type -Path $csFile -ReferencedAssemblies "System.Drawing"
}

if ($RenderSample) {
  [DshVcLayer]::SaveSampleImage($RenderSample)
  exit 0
}

$stateFile = Join-Path $dir "cursor.state"
$lastTs = 0.0
$lastSeen = [DateTime]::MinValue
$lastActive = [DateTime]::Now
$visible = $false
$hasPosition = $false
$currentX = 0
$currentY = 0
$transitionPoints = @()
$transitionIndex = 0
$nextFrameAt = [DateTime]::MinValue
while ($true) {
  [System.Windows.Forms.Application]::DoEvents()
  if (Test-Path $stateFile) {
    try {
      $st = Get-Content -Path $stateFile -Raw -ErrorAction Stop | ConvertFrom-Json
      if ($null -ne $st -and $st.ts -and ([double]$st.ts -ne $lastTs)) {
        $lastTs = [double]$st.ts
        $lastSeen = [DateTime]::Now
        $lastActive = [DateTime]::Now
        $targetX = [int][double]$st.x
        $targetY = [int][double]$st.y
        if ($st.show -and $targetX -gt 0 -and $targetY -gt 0) {
          if ($hasPosition -and ($currentX -ne $targetX -or $currentY -ne $targetY)) {
            $distance = [Math]::Sqrt((($targetX - $currentX) * ($targetX - $currentX)) + (($targetY - $currentY) * ($targetY - $currentY)))
            $durationMs = [int][Math]::Min(420, [Math]::Max(220, $distance * 0.45))
            $transitionPoints = @(Get-CursorTransitionPoints $currentX $currentY $targetX $targetY $durationMs)
            $transitionIndex = 1
            $nextFrameAt = [DateTime]::Now
          } else {
            [DshVcLayer]::Show($targetX, $targetY)
            $currentX = $targetX
            $currentY = $targetY
            $hasPosition = $true
            $transitionPoints = @()
          }
          $visible = $true
        } else {
          [DshVcLayer]::Hide()
          $visible = $false
          $hasPosition = $false
          $transitionPoints = @()
        }
      }
    } catch { }
  }
  if ($transitionPoints.Count -gt 0 -and [DateTime]::Now -ge $nextFrameAt) {
    $point = $transitionPoints[$transitionIndex]
    [DshVcLayer]::Show($point.x, $point.y)
    $currentX = $point.x
    $currentY = $point.y
    $hasPosition = $true
    $transitionIndex++
    $nextFrameAt = [DateTime]::Now.AddMilliseconds(16)
    if ($transitionIndex -ge $transitionPoints.Count) { $transitionPoints = @() }
  }
  if ($visible -and (([DateTime]::Now - $lastSeen).TotalMilliseconds -gt 3000)) {
    [DshVcLayer]::Hide()
    $visible = $false
    $hasPosition = $false
    $transitionPoints = @()
  }
  # Exit if idle for 120 consecutive seconds (2 minutes)
  if (([DateTime]::Now - $lastActive).TotalSeconds -ge 120) {
    [DshVcLayer]::Hide()
    [DshVcLayer]::Cleanup()
    $pidFile = Join-Path $dir "overlay.pid"
    if (Test-Path $pidFile) {
      try {
        $savedMarker = Get-Content $pidFile -Raw -ErrorAction SilentlyContinue
        if (($savedMarker.Trim().Split('|')[0]) -eq [string]$PID) { Remove-Item $pidFile -Force -ErrorAction SilentlyContinue }
      } catch { }
    }
    exit 0
  }
  Start-Sleep -Milliseconds 8
}
