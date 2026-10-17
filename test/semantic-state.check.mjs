import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const helper = fileURLToPath(new URL('../lib/win-pilot-helper.ps1', import.meta.url)).replaceAll("'", "''")
const script = `
$ErrorActionPreference='Stop'
$tokens=$null; $errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile('${helper}',[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw $errors[0] }
$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst]},$false) | ForEach-Object { . ([scriptblock]::Create($_.Extent.Text)) }
$script:accessibilityHistory=@{}; $script:accessibilityRevision=0; $script:elementIndexHistory=@{}
function Item([string]$id,[string]$name,[string]$value='') {
 return [ordered]@{element_id=$id;index=(Get-StableElementIndex 'window:42:pid77:start1' $id);role='Button';name=$name;value=$value;automation_id=$id;enabled=$true;offscreen=$false;invokable=$true;selected=$false;native_window_handle=42;rect=@{x=1;y=2;width=10;height=10}}
}
$a=Item a First; $b=Item b Second; $c=Item c Third
$first=Get-AccessibilityDelta window @($a,$b,$c)
if ($first.format -ne 'full' -or $first.base_revision -ne $null -or (Format-AccessibilityTree @($a,$b,$c) $first) -notmatch '\\[3\\]') { throw 'first observation must be complete' }
$b2=Item b Second; $c2=Item c Third; $d=Item d New
if ($b2.index -ne 2 -or $c2.index -ne 3 -or $d.index -ne 4) { throw 'removed indexes must not shift or be reused' }
$delta=Get-AccessibilityDelta window @($b2,$c2,$d)
if ($delta.format -ne 'delta' -or $delta.base_revision -ne $first.revision -or $delta.removed[0].index -ne 1 -or $delta.added[0].value -ne '') { throw 'delta must identify removal and complete additions' }
$tree=Format-AccessibilityTree @($b2,$c2,$d) $delta
if ($tree -notmatch '- \\[1\\]' -or $tree -notmatch '\\+ \\[4\\]' -or $tree -match '\\[2\\]') { throw 'delta tree must omit unchanged elements' }
$same=Get-AccessibilityDelta window @($b2,$c2,$d)
if ($same.format -ne 'no_change' -or $same.unchanged_count -ne 3) { throw 'unchanged tree must have no_change format' }
$hiddenB=Item b Changed 'new value'
$hidden=Get-AccessibilityDelta window @($hiddenB,$c2,$d) -ShownToModel $false
if ($hidden.format -ne 'hidden' -or (Format-AccessibilityTree @($hiddenB,$c2,$d) $hidden) -ne '') { throw 'hidden tree must not be formatted for the model' }
$visible=Get-AccessibilityDelta window @($hiddenB,$c2,$d)
if ($visible.base_revision -ne $same.revision -or $visible.changed.Count -ne 1 -or $visible.changed[0].element.value -ne 'new value') { throw 'hidden observation must not swallow visible delta' }
$forced=Get-AccessibilityDelta window @($hiddenB,$c2,$d) -DisableDiffing $true
if ($forced.format -ne 'full' -or (Format-AccessibilityTree @($hiddenB,$c2,$d) $forced) -notmatch '\\[2\\]') { throw 'disable_diffing must force complete formatting' }
$script:payload=[pscustomobject]@{control_session_id='session-A'}
$aFull=Get-AccessibilityDelta sharedWindow @($a,$b)
$script:payload=[pscustomobject]@{control_session_id='session-B'}
$bFull=Get-AccessibilityDelta sharedWindow @($a,$b)
if ($aFull.format -ne 'full' -or $bFull.format -ne 'full') { throw 'each model session must receive its own full baseline' }
$script:payload=[pscustomobject]@{control_session_id='session-A'}
if ((Get-AccessibilityDelta sharedWindow @($a,$b)).format -ne 'no_change') { throw 'session baseline must survive another session read' }
Add-Type @'
using System;
public class FixtureRect { public int Left=0, Top=0, Right=100, Bottom=100; }
public static class DshWin32 { public static FixtureRect Rect = new FixtureRect(); public static FixtureRect GetDwmRect(IntPtr h) { return Rect; } }
'@
function Get-WindowObservationFingerprint { return $script:fixtureFingerprint }
$script:fixtureFingerprint='pid77:start1:thread4:dpi96'
$el=[pscustomobject]@{Current=[pscustomobject]@{ProcessId=77;Name='Second';AutomationId='b';ControlType=[pscustomobject]@{Id=50000};IsEnabled=$true;IsOffscreen=$false;BoundingRectangle=[pscustomobject]@{X=5;Y=5;Width=20;Height=20}}}
$el | Add-Member ScriptMethod GetRuntimeId { return @(7,9) }
$script:payload=[pscustomobject]@{snapshot_id='fresh'}
$script:observation=@{id='fresh';hwnd=[IntPtr]42;created=[DateTime]::UtcNow;rect=(New-Object FixtureRect);fingerprint=$script:fixtureFingerprint}
$script:cachedTreeHwnd=[IntPtr]42; $script:cachedElements=@{2=$el}; $script:cachedIdentities=@{2=(Get-ElementIdentity $el)}
if ((Find-ElementByIndex 42 2) -ne $el) { throw 'sparse surviving index must resolve even above cache count' }
$caught=$false; try { Find-ElementByIndex 42 1 } catch { $caught=$_.Exception.Message -like 'element_not_found:*' }; if (-not $caught) { throw 'removed index must not relocate' }
$script:lastScreenshot=@{id='shot';hwnd=[IntPtr]42;created=[DateTime]::UtcNow;rect=(New-Object FixtureRect);fingerprint=$script:fixtureFingerprint;trusted=$true}
Assert-ScreenshotBinding 42
$script:fixtureFingerprint='pid77:start1:thread4:dpi144'
$caught=$false; try { Assert-ScreenshotBinding 42 } catch { $caught=$_.Exception.Message -like 'stale_screenshot:*' }; if (-not $caught) { throw 'implicit screenshot binding must reject changed DPI' }
$script:fixtureFingerprint='pid77:start1:thread4:dpi96'; $script:payload=[pscustomobject]@{screenshot_id='old'}
$caught=$false; try { Assert-ScreenshotBinding 42 } catch { $caught=$_.Exception.Message -like 'stale_screenshot:*' }; if (-not $caught) { throw 'explicit old screenshot must not fall back' }
$script:observation=@{id='owned';control_session_id='session-A';hwnd=[IntPtr]42;created=[DateTime]::UtcNow;rect=(New-Object FixtureRect);fingerprint=$script:fixtureFingerprint}
$script:lastScreenshot=@{id='ownedShot';control_session_id='session-A';hwnd=[IntPtr]42;created=[DateTime]::UtcNow;rect=(New-Object FixtureRect);fingerprint=$script:fixtureFingerprint;trusted=$true}
$script:payload=[pscustomobject]@{control_session_id='session-B';snapshot_id='owned';screenshot_id='ownedShot'}
$caught=$false;try {Assert-Observation 42 -Required}catch{$caught=$_.Exception.Message -like 'stale_snapshot:*'};if(-not $caught){throw 'cross-session snapshot must be refused'}
$caught=$false;try {Assert-ScreenshotBinding 42}catch{$caught=$_.Exception.Message -like 'stale_screenshot:*'};if(-not $caught){throw 'cross-session screenshot must be refused'}
Set-ObservationSession
if($script:observation -or $script:lastScreenshot -or $script:cachedElements){throw 'session handoff must clear cached native observation objects'}
Write-Output 'PASS: stable sparse indexes, real full/delta/no_change, model-visible baseline and implicit DPI binding'
`
const output = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
assert.match(output, /PASS:/)
console.log(output.trim())
