import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const helper = fileURLToPath(new URL('../lib/win-pilot-helper.ps1', import.meta.url)).replaceAll("'", "''")
const script = `
$ErrorActionPreference='Stop'; $tokens=$null; $errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile('${helper}',[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw $errors[0] }
$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst]},$false) | ForEach-Object { . ([scriptblock]::Create($_.Extent.Text)) }
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
# Exercise actual DataObject format cloning without touching the OS clipboard.
$source=New-Object System.Windows.Forms.DataObject
$source.SetData('UnicodeText',$false,'original')
$source.SetData('HTML Format',$false,'<b>original</b>')
$stream=New-Object IO.MemoryStream(,[byte[]]@(1,2,3,4))
$source.SetData('custom binary',$false,$stream)
$source.SetData('FileDrop',$false,[string[]]@('file.txt'))
$bitmap=New-Object Drawing.Bitmap(2,2)
$source.SetData('Bitmap',$false,$bitmap)
$copied=Copy-PasteClipboardDataObject $source
$formats=@($copied.GetFormats($false))
if ($formats.Count -ne 5 -or $copied.GetData('HTML Format',$false) -ne '<b>original</b>' -or $copied.GetData('FileDrop',$false)[0] -ne 'file.txt' -or [object]::ReferenceEquals($stream,$copied.GetData('custom binary',$false)) -or [object]::ReferenceEquals($bitmap,$copied.GetData('Bitmap',$false))) { throw 'real snapshot must preserve all formats and detach binary/image data' }
$bitmap.Dispose(); $stream.Dispose()
$fragment='<b>中文 &amp; '+[char]::ConvertFromUtf32(0x1F680)+'</b>'
$content=New-PasteClipboardContent $fragment html
$bytes=[System.Text.Encoding]::UTF8.GetBytes($content.html)
function Offset([string]$name) { return [int]([regex]::Match($content.html,($name+':([0-9]+)')).Groups[1].Value) }
$start=Offset StartFragment; $end=Offset EndFragment
if ([System.Text.Encoding]::UTF8.GetString($bytes,$start,$end-$start) -cne $fragment) { throw 'CF_HTML fragment offsets must count UTF8 bytes' }
if ((Offset StartHTML) -ge $start -or (Offset EndHTML) -ne $bytes.Length -or $content.text -notmatch '中文 &') { throw 'CF_HTML outer offsets and fallback text must be correct' }
$tick=[char]96
$md=[string]::Join([Environment]::NewLine,@('# Title','- **bold**','- *italics*','<script>bad</script>',($tick+'<b>code</b>'+$tick),'[link](https://example.test?a=1&b=2)',($tick+$tick+$tick+'txt'),'<code>',($tick+$tick+$tick)))
$rich=New-PasteClipboardContent $md md
foreach ($expected in @('<h1>Title</h1>','<ul>','<strong>bold</strong>','<em>italics</em>','&lt;script&gt;','<code>&lt;b&gt;code&lt;/b&gt;</code>','<pre><code>&lt;code&gt;</code></pre>','href="https://example.test?a=1&amp;b=2"')) { if (-not $rich.html.Contains($expected)) { throw ('Missing markdown conversion: '+$expected) } }
$invalid=$false; try { New-PasteClipboardContent test rtf } catch { $invalid=$_.Exception.Message -like 'invalid_paste_format:*' }; if (-not $invalid) { throw 'unsupported format must fail before clipboard or input' }
# The real transaction runs against a provider double. No user clipboard is read/written.
$script:clip=@{sequence=1;formats=@{UnicodeText='original';Html='<b>original</b>';Bitmap='opaque image';FileDrop=@('file.txt')}}
$script:sends=0
$provider={
 param($op,$arg)
 switch ($op) {
  capture { return @{sequence=$script:clip.sequence;data=$script:clip.formats.Clone()} }
  write {
   if ($arg.previous.sequence -ne $script:clip.sequence) { throw 'clipboard_changed: copied before write' }
   $script:clip.sequence++; $script:clip.formats=@{UnicodeText=$arg.content.text;Html=$arg.content.html;Owner='ours'}
   return @{sequence=$script:clip.sequence;token='ours'}
  }
  restore {
   if ($script:clip.sequence -ne $arg.owner.sequence -or $script:clip.formats.Owner -ne $arg.owner.token) { return $false }
   $script:clip.sequence++; $script:clip.formats=$arg.previous.data; return $true
  }
 }
}
$result=@{}
Invoke-PasteClipboardTransaction -Content $content -Provider $provider -Result $result -Send { $script:sends++ }
if (-not $result.clipboard_restored -or $script:clip.formats.Bitmap -ne 'opaque image' -or $script:clip.formats.Html -ne '<b>original</b>' -or $script:clip.formats.FileDrop[0] -ne 'file.txt' -or $script:sends -ne 1) { throw 'all formats must survive successful paste' }
$result=@{}
Invoke-PasteClipboardTransaction -Content $content -Provider $provider -Result $result -Send { $script:clip.sequence++; $script:clip.formats=@{UnicodeText=$content.text;Html='<i>user copied identical plain text</i>'} }
if ($result.clipboard_restored -or $script:clip.formats.Html -ne '<i>user copied identical plain text</i>') { throw 'copy during input, even same text, must not be overwritten' }
$result=@{}; $failed=$false
try { Invoke-PasteClipboardTransaction -Content $content -Provider $provider -Result $result -Send { throw 'operation_cancelled: fixture input interrupted' } } catch { $failed=$true }
if (-not $failed -or -not $result.clipboard_restored) { throw 'uncertain input must restore owned clipboard but propagate failure' }
$neverSent=$false; $captureFailure={ param($op,$arg) throw 'clipboard_unavailable: cannot preserve bitmap' }
try { Invoke-PasteClipboardTransaction -Content $content -Provider $captureFailure -Result @{} -Send { $neverSent=$true } } catch { }
if ($neverSent) { throw 'failed clipboard preservation must reject before input' }
Write-Output 'PASS: UTF8 CF_HTML, escaped Markdown subset, real DataObject cloning, all-format restoration and user-copy preservation'
`
const output = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
assert.match(output, /PASS:/)
console.log(output.trim())
