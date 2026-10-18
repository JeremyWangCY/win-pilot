import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const output=path.join(root,'artifacts','task-desktop-sandbox')
const source=path.join(output,'input'),results=path.join(output,'results')
const args=new Set(process.argv.slice(2))
if([...args].some(arg=>arg!=='--validate-only'))throw new Error('Only --validate-only is supported. This command never launches Sandbox.')
const xml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;')
const files=[]
function assertPreparationPaths(){
  const inspected=new Set()
  const canonical=value=>path.resolve(value).toLowerCase()
  function check(file,descend=false){
    const absolute=path.resolve(file)
    if(!inspected.has(absolute)){
      let stat
      try{stat=fs.lstatSync(absolute)}catch(error){if(error.code==='ENOENT')return;throw error}
      if(stat.isSymbolicLink()||canonical(fs.realpathSync.native(absolute))!==canonical(absolute))throw new Error(`Reparse points or redirected paths are forbidden: ${absolute}`)
      inspected.add(absolute)
      if(descend&&stat.isDirectory())for(const entry of fs.readdirSync(absolute))check(path.join(absolute,entry),true)
    }
  }
  for(const target of [output,source,results]){
    const ancestors=[]
    for(let next=path.resolve(target);;next=path.dirname(next)){ancestors.unshift(next);if(next===path.dirname(next))break}
    for(const ancestor of ancestors)check(ancestor)
  }
  // Inspect descendants as well, including existing output files, so a leaf
  // link cannot redirect copyFile or a validation-report write.
  function descend(directory){
    if(!fs.existsSync(directory))return
    for(const entry of fs.readdirSync(directory)){
      const file=path.join(directory,entry);check(file)
      if(fs.lstatSync(file).isDirectory())descend(file)
    }
  }
  descend(output)
  const attributes=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; $paths=ConvertFrom-Json ([Console]::In.ReadToEnd()); foreach($path in $paths){$item=Get-Item -LiteralPath $path -Force; if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw ('Reparse point forbidden: '+$path)}}"],{windowsHide:true,encoding:'utf8',input:JSON.stringify([...inspected])})
  if(attributes.status!==0)throw new Error(`Windows reparse-point validation failed\n${attributes.stdout}\n${attributes.stderr}`)
}
// Both prepare and validate-only reject redirected destination ancestors before
// any compilation, copy, report write, or mapped-folder configuration is made.
assertPreparationPaths()
function copy(from,to){
  const stat=fs.lstatSync(from)
  if(stat.isSymbolicLink())throw new Error(`Symbolic links are not accepted in fixture inputs: ${from}`)
  if(stat.isDirectory()){fs.mkdirSync(to,{recursive:true});for(const entry of fs.readdirSync(from))copy(path.join(from,entry),path.join(to,entry));return}
  fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to)
}
function build(project,destination){
  const done=spawnSync('dotnet',['build',path.join(root,'native',project,`${project}.csproj`),'-c','Release','--ignore-failed-sources','-p:NuGetAudit=false','-o',destination],{cwd:root,encoding:'utf8',windowsHide:true,env:{...process.env,DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_SKIP_FIRST_TIME_EXPERIENCE:'1'}})
  fs.writeFileSync(path.join(output,`${project}.build.log`),(done.stdout||'')+(done.stderr||''))
  process.stdout.write(done.stdout||'');process.stderr.write(done.stderr||'')
  if(done.status!==0)throw new Error(`Compile failed: ${project}`)
}
function selectEight(directory){
  const versions=fs.readdirSync(directory).filter(value=>/^8\.0\.\d+$/.test(value)).sort((a,b)=>Number(b.split('.').at(-1))-Number(a.split('.').at(-1)))
  if(!versions.length)throw new Error(`No stable .NET 8 runtime in ${directory}`)
  return versions[0]
}
function hash(file){return createHash('sha256').update(fs.readFileSync(file)).digest('hex')}
function inventory(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isSymbolicLink())throw new Error('Unexpected symbolic link');if(entry.isDirectory())inventory(file);else if(entry.name!=='bundle-manifest.json')files.push({path:path.relative(source,file).replaceAll('\\','/'),bytes:fs.statSync(file).size,sha256:hash(file)})}}
function validate(){
  assertPreparationPaths()
  const manifest=JSON.parse(fs.readFileSync(path.join(source,'bundle-manifest.json'),'utf8'))
  if(manifest.kind!=='win-pilot-task-desktop-sandbox-v1'||!manifest.host_computer_name)throw new Error('Invalid sandbox manifest')
  if(manifest.started!==false||manifest.executed_tests!==false)throw new Error('Preparation must never claim execution')
  for(const item of manifest.files){const target=path.resolve(source,item.path);if(!target.startsWith(source+path.sep)||hash(target)!==item.sha256)throw new Error(`Invalid payload hash: ${item.path}`)}
  const config=fs.readFileSync(path.join(output,'task-desktop.wsb'),'utf8')
  for(const name of ['Networking','ClipboardRedirection','PrinterRedirection','AudioInput','VideoInput','VGpu'])if(!config.includes(`<${name}>Disable</${name}>`))throw new Error(`Missing disabled redirection: ${name}`)
  if(!config.includes('<MemoryInMB>4096</MemoryInMB>')||!config.includes('<ReadOnly>true</ReadOnly>')||!config.includes('<ReadOnly>false</ReadOnly>'))throw new Error('Invalid mappings or memory')
  const parsedXml=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; [xml]$xml=Get-Content -LiteralPath '${path.join(output,'task-desktop.wsb').replaceAll("'","''")}' -Raw; $maps=@($xml.Configuration.MappedFolders.MappedFolder); if($maps.Count -ne 2 -or $maps[0].HostFolder -cne '${source.replaceAll("'","''")}' -or $maps[0].SandboxFolder -cne 'C:\\WinPilotSource' -or $maps[0].ReadOnly -cne 'true' -or $maps[1].HostFolder -cne '${results.replaceAll("'","''")}' -or $maps[1].SandboxFolder -cne 'C:\\WinPilotResults' -or $maps[1].ReadOnly -cne 'false'){throw 'Unexpected folder mapping'}; if($xml.Configuration.LogonCommand.Command -cne 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\WinPilotSource\\guest-run.ps1'){throw 'Unexpected guest command'}`],{windowsHide:true,encoding:'utf8'})
  if(parsedXml.status!==0)throw new Error(`Sandbox XML parse or mapping validation failed\n${parsedXml.stdout}\n${parsedXml.stderr}`)
  for(const file of fs.readdirSync(source).filter(name=>name.endsWith('.ps1'))){
    const parsed=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$errors=$null; [System.Management.Automation.Language.Parser]::ParseFile('${path.join(source,file).replaceAll("'","''")}',[ref]$null,[ref]$errors) | Out-Null; if($errors.Count){$errors | Format-List; exit 1}`],{windowsHide:true,encoding:'utf8'})
    if(parsed.status!==0)throw new Error(`PowerShell syntax validation failed: ${file}\n${parsed.stdout}\n${parsed.stderr}`)
  }
  const mock=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(source,'owned-host-cleanup.check.ps1')],{windowsHide:true,encoding:'utf8'})
  fs.writeFileSync(path.join(output,'owned-host-cleanup.mock.log'),(mock.stdout||'')+(mock.stderr||''))
  if(mock.status!==0)throw new Error(`Owned-process cleanup mock check failed\n${mock.stdout}\n${mock.stderr}`)
  const runner=fs.readFileSync(path.join(source,'guest-run.ps1'),'utf8')
  const guard=runner.indexOf('$script:FixtureGuestValidated = $true')
  const firstMutation=runner.indexOf('New-Item -ItemType Directory')
  if(guard<0||firstMutation<guard||!runner.includes("$env:USERNAME -cne 'WDAGUtilityAccount'")||!runner.includes('$env:COMPUTERNAME -ieq $manifest.host_computer_name'))throw new Error('Guest identity guard is missing or follows mutation')
  const nativeComponents=Object.fromEntries(['win-pilot-task-desktop.exe','win-pilot-task-desktop.dll','win-pilot-task-desktop.deps.json','win-pilot-task-desktop.runtimeconfig.json'].map(name=>{
    const copied=hash(path.join(source,'payload','lib','task-desktop',name))
    if(copied!==hash(path.join(root,'lib','task-desktop',name)))throw new Error(`Native build changed since preparation: ${name}`)
    return [name,copied]
  }))
  const validation={ok:true,prepared_only:true,started:false,validated_at:new Date().toISOString(),configuration:path.join(output,'task-desktop.wsb'),input:source,results,files:manifest.files.length,bytes:manifest.files.reduce((sum,item)=>sum+item.bytes,0),manifest_sha256:hash(path.join(source,'bundle-manifest.json')),configuration_sha256:hash(path.join(output,'task-desktop.wsb')),native_components:nativeComponents,runtime:manifest.runtime,msix_startup_task:'incomplete: no guest-only signed package fixture'}
  fs.writeFileSync(path.join(output,'preparation-validation.json'),JSON.stringify(validation,null,2)+'\n')
  console.log(JSON.stringify(validation,null,2))
}
if(!args.has('--validate-only')){
  if(process.platform!=='win32')throw new Error('Preparation needs installed Windows .NET runtime files')
  fs.mkdirSync(source,{recursive:true});fs.mkdirSync(results,{recursive:true})
  // Copy the currently built host, never run it and never replace installed plugins.
  for(const name of ['win-pilot-task-desktop.exe','win-pilot-task-desktop.dll','win-pilot-task-desktop.deps.json','win-pilot-task-desktop.runtimeconfig.json','safety-hold.json'])copy(path.join(root,'lib','task-desktop',name),path.join(source,'payload','lib','task-desktop',name))
  copy(path.join(root,'lib','win-pilot-helper.ps1'),path.join(source,'payload','lib','win-pilot-helper.ps1'))
  copy(path.join(root,'lib','wgc','win-pilot-wgc.exe'),path.join(source,'payload','lib','wgc','win-pilot-wgc.exe'))
  build('task-desktop-fixture',path.join(source,'payload','fixture'))
  build('task-desktop-startup-sentinel',path.join(source,'payload','sentinel'))
  const dotnet=process.env.WIN_PILOT_SANDBOX_DOTNET_ROOT||path.join(process.env.ProgramFiles||'C:\\Program Files','dotnet')
  const core=selectEight(path.join(dotnet,'shared','Microsoft.NETCore.App'))
  const desktop=selectEight(path.join(dotnet,'shared','Microsoft.WindowsDesktop.App'))
  const fxr=selectEight(path.join(dotnet,'host','fxr'))
  for(const [base,version] of [['shared/Microsoft.NETCore.App',core],['shared/Microsoft.WindowsDesktop.App',desktop],['host/fxr',fxr]])copy(path.join(dotnet,base,version),path.join(source,'payload','dotnet',base,version))
  for(const name of ['dotnet.exe','LICENSE.txt','ThirdPartyNotices.txt'])if(fs.existsSync(path.join(dotnet,name)))copy(path.join(dotnet,name),path.join(source,'payload','dotnet',name))
  if(!fs.existsSync(path.join(source,'payload','dotnet','dotnet.exe')))throw new Error('dotnet.exe is missing')
  for(const name of fs.readdirSync(path.join(root,'scripts','sandbox-task-desktop')))copy(path.join(root,'scripts','sandbox-task-desktop',name),path.join(source,name))
  inventory(source)
  fs.writeFileSync(path.join(source,'bundle-manifest.json'),JSON.stringify({kind:'win-pilot-task-desktop-sandbox-v1',prepared_at:new Date().toISOString(),host_computer_name:os.hostname(),started:false,executed_tests:false,runtime:{core,desktop,fxr},limitations:['Sandbox is not enabled or launched by prepare','Unsigned loose MSIX StartupTask sentinel is not implemented; Store application safety remains unverified','Runtime readiness, RDP, WGC and user input remain untested until guarded guest execution'],files},null,2)+'\n')
  const command='powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\WinPilotSource\\guest-run.ps1'
  fs.writeFileSync(path.join(output,'task-desktop.wsb'),`<Configuration>\n  <VGpu>Disable</VGpu>\n  <Networking>Disable</Networking>\n  <AudioInput>Disable</AudioInput>\n  <VideoInput>Disable</VideoInput>\n  <PrinterRedirection>Disable</PrinterRedirection>\n  <ClipboardRedirection>Disable</ClipboardRedirection>\n  <MemoryInMB>4096</MemoryInMB>\n  <MappedFolders>\n    <MappedFolder><HostFolder>${xml(source)}</HostFolder><SandboxFolder>C:\\WinPilotSource</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>\n    <MappedFolder><HostFolder>${xml(results)}</HostFolder><SandboxFolder>C:\\WinPilotResults</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>\n  </MappedFolders>\n  <LogonCommand><Command>${xml(command)}</Command></LogonCommand>\n</Configuration>\n`)
}
validate()
