# Fixture: read a NON-EMPTY selection from a real Chromium window without crashing.
#
# Regression cover for a fatal defect: on Chromium/Electron windows the
# TextPatternRange returned by TextPattern.GetSelection() has a broken native
# handle, and calling GetText on it access-violates inside
# MS.Internal.Automation.UiaCoreApi.RawTextRange_GetText (0xC0000005), killing the
# helper process. A native access violation is not a managed exception, so the
# surrounding try/catch could never catch it.
#
# Why the page prepares a selection: an EMPTY selection does not crash. Measured —
# reverting the fix still passed an earlier version of this fixture while the
# window had nothing selected, so the check was vacuous. The defect only fires
# once the range spans text. The page therefore selects its own paragraph on load,
# which needs no input dispatch and is deterministic.
#
# Prints TEXT_READ_FIXTURE_OK on success, or FAIL:/SKIP: lines.
$ErrorActionPreference = 'Stop'
# Match the helper's UTF-8 stdout before PowerShell decodes native output.
# A different native-output encoding can corrupt JSON quotes after CJK text.
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
if ($env:WIN_PILOT_INTERACTIVE_TESTS -ne '1') {
  Write-Output 'SKIP: interactive Chromium test requires WIN_PILOT_INTERACTIVE_TESTS=1'
  exit 0
}

$repo = Split-Path $PSScriptRoot -Parent | Split-Path -Parent
$helper = Join-Path $repo 'lib\win-pilot-helper.ps1'

$failures = New-Object System.Collections.Generic.List[string]

$edge = @(
  'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
  'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { Write-Output 'SKIP: no Edge/Chromium binary found on this host'; exit 0 }

$fixtureId = [guid]::NewGuid().ToString('N')
$profilePath = Join-Path ([System.IO.Path]::GetTempPath()) "winpilot-text-fixture-$fixtureId"
$marker = "winpilot-text-fixture-$fixtureId"

# Use a private browser profile so Edge cannot reuse the user's existing process.
# All cleanup ownership checks use this unique profile path, never process name.
try {
$phrase = 'selectable fixture text for win-pilot'
$html = @"
<title>$marker</title>
<p style='font-size:28px' id='p'>$phrase</p>
<script>
  window.addEventListener('load', function () {
    var range = document.createRange();
    range.selectNodeContents(document.getElementById('p'));
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
</script>
"@
$url = 'data:text/html;charset=utf-8,' + [System.Uri]::EscapeDataString($html)

# Start-Process joins ArgumentList into one string; quote both values explicitly.
# Without this, spaces in a URL became extra tabs (fixture/text/for).
$arguments = '--user-data-dir="' + $profilePath + '" --no-first-run --no-default-browser-check --new-window "' + $url + '"'
Start-Process -FilePath $edge -ArgumentList $arguments | Out-Null

$hwnd = 0
$win = $null
$deadline = (Get-Date).AddSeconds(25)
while ((Get-Date) -lt $deadline -and $hwnd -eq 0) {
  Start-Sleep -Milliseconds 500
  $win = Get-Process msedge -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle -like "*$marker*" -and $_.MainWindowHandle -ne 0 } |
    Select-Object -First 1
  if ($win) { $hwnd = [int]$win.MainWindowHandle }
}
if ($hwnd -eq 0) { Write-Output 'SKIP: the Chromium fixture window did not appear in time'; exit 0 }
Write-Output "fixture hwnd=$hwnd pid=$($win.Id)"
Start-Sleep -Milliseconds 1200   # let the page's load handler select the text

# --- read text; this is the crash path ------------------------------------
$payload = @{ hwnd = $hwnd; include_text = $true; screenshot = $false } | ConvertTo-Json -Compress
$raw = $payload | & pwsh -NoLogo -NoProfile -File $helper -Action get_window_state -PayloadStdin -TimeoutMs 45000 2>&1
$exitCode = $LASTEXITCODE
$joined = ($raw -join "`n")
$selLen = -1

if ($exitCode -ne 0) {
  $failures.Add("reading text from a Chromium window must not crash the helper (exit=$exitCode); a native access violation reports -1073741819 (0xC0000005).")
} else {
  $first = $joined.IndexOf('{'); $last = $joined.LastIndexOf('}')
  if ($first -lt 0 -or $last -le $first) {
    $failures.Add('the helper must return a JSON result for a Chromium text read')
  } else {
    # PowerShell's ConvertFrom-Json chokes on element names containing quotes, so
    # parse with the same reader the host uses and extract only the fields needed.
    $json = $joined.Substring($first, $last - $first + 1)
    $ok = $null; $elements = 0; $selText = ''; $accStatus = ''
    try {
      $node = $json | node -e @'
let data = "";
process.stdin.on("data", (c) => { data += c });
process.stdin.on("end", () => {
  const obj = JSON.parse(data);
  const out = {
    ok: obj.ok === true,
    elements: Array.isArray(obj.elements) ? obj.elements.length : 0,
    accessibility_status: obj.accessibility_status ?? "",
    selected_text: obj?.accessibility?.selected_text ?? obj?.selected_text ?? "",
  };
  process.stdout.write(JSON.stringify(out));
});
'@
      $parsed = $node | ConvertFrom-Json
      $ok = $parsed.ok
      $elements = [int]$parsed.elements
      $accStatus = [string]$parsed.accessibility_status
      $selText = [string]$parsed.selected_text
    } catch {
      $failures.Add("the helper result must be valid JSON: $($_.Exception.Message)")
    }
    $selLen = $selText.Length
    Write-Output "elements=$elements accessibility_status=$accStatus selectedLen=$selLen"
    if ($ok -ne $true) { $failures.Add("the read must report ok:true (got ok=$ok)") }
    if ($elements -le 0) { $failures.Add('a Chromium page with text must expose at least one element') }
  }
}

# The prepared selection must be observable, otherwise the crash path was not
# exercised and a pass would be meaningless.
if ($exitCode -eq 0 -and $selLen -le 0) {
  $failures.Add('the fixture must produce a non-empty selection (an empty range does not exercise the defect)')
}

# --- the fix must not disable the feature --------------------------------
# Comments mention the old call to document the defect, so strip comment lines
# before inspecting the code — otherwise the check matches its own explanation.
$source = Get-Content $helper -Raw
$codeOnly = ($source -split "`n" | Where-Object { -not $_.TrimStart().StartsWith('#') }) -join "`n"
if ($codeOnly -match 'selection\[0\]\.GetText\(') {
  $failures.Add('GetText must not be called on the selection range object (that is the crash)')
}
if ($codeOnly -notmatch 'MoveEndpointByRange') {
  $failures.Add('the selection must be read through a DocumentRange clone whose endpoints were moved')
}

if ($failures.Count -gt 0) {
  foreach ($f in $failures) { Write-Output "FAIL: $f" }
  exit 1
}
Write-Output 'TEXT_READ_FIXTURE_OK'
} finally {
  # Every outcome, including an assertion failure or a crashed helper, cleans
  # only processes explicitly tied to THIS fixture's private profile.
  $owned = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profilePath) })
  foreach ($process in $owned) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
  # Keep profile data in TEMP rather than risk broad filesystem deletion here.
  # Verify no owned browser process remains and make cleanup failures explicit.
  Start-Sleep -Milliseconds 300
  $remaining = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profilePath) })
  if ($remaining.Count -gt 0) {
    throw "Fixture cleanup failed: $($remaining.Count) process(es) still own $profilePath"
  }
  Write-Output 'TEXT_READ_FIXTURE_CLEANED'
}
