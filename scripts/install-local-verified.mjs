// Local-only delivery. Preserve the previous package and profile before pnpm changes.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('..',import.meta.url))

// Paths are derived, never hardcoded: this script is committed, so a developer's
// home directory must not leak into it. DSH_HOME and WIN_PILOT_PROFILE override
// the defaults for non-standard layouts.
const dshHome=process.env.DSH_HOME??path.join(os.homedir(),'.dsh')
const profile=process.env.WIN_PILOT_PROFILE??path.join(dshHome,'profiles','desktop')
const installed=path.join(profile,'node_modules','win-pilot')
const localPlugins=process.env.WIN_PILOT_LOCAL_PLUGINS??path.join(dshHome,'local-plugins')
const pnpm=process.env.WIN_PILOT_PNPM
  ??path.join(dshHome,'dsh-runtimes','dsh-primary-runtime','dependencies','pnpm','bin','pnpm.cjs')
const stamp=new Date().toISOString().replace(/[:.]/g,'-')
const backup=path.join(localPlugins,'win-pilot','backup-'+stamp)
const packDir=path.join(root,'artifacts','local-delivery',stamp)
if(!fs.existsSync(profile))throw new Error(`profile not found: ${profile} (set WIN_PILOT_PROFILE)`)
if(!fs.existsSync(pnpm))throw new Error(`pnpm not found: ${pnpm} (set WIN_PILOT_PNPM)`)
fs.mkdirSync(backup,{recursive:true});fs.mkdirSync(packDir,{recursive:true})
for(const name of ['package.json','pnpm-lock.yaml','cordis.patch.yml'])if(fs.existsSync(path.join(profile,name)))fs.copyFileSync(path.join(profile,name),path.join(backup,name))
fs.cpSync(installed,path.join(backup,'win-pilot'),{recursive:true,dereference:true})
const before=JSON.parse(fs.readFileSync(path.join(profile,'package.json'),'utf8'))
// `npm pack` is run through the current Node binary, so resolve npm relative to
// that installation instead of assuming a system-wide Node directory.
const npmCli=path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js')
const npmRunner=fs.existsSync(npmCli)?[process.execPath,[npmCli]]:[process.env.ComSpec??'cmd.exe',['/c','npm']]
const packed=JSON.parse(execFileSync(npmRunner[0],[...npmRunner[1],'pack','--json','--pack-destination',packDir],{cwd:root,encoding:'utf8',windowsHide:true}))[0]
const tarball=path.join(packDir,packed.filename)
const hash=createHash('sha256').update(fs.readFileSync(tarball)).digest('hex')
const name=`win-pilot-${packed.version}-local-${hash.slice(0,12)}.tgz`
fs.copyFileSync(tarball,path.join(profile,'vendor',name))
const report={started_at:new Date().toISOString(),backup,profile,tarball:path.join(profile,'vendor',name),sha256:hash,status:'prepared'}
const reportPath=path.join(root,'reports','task-desktop-local-install.json')
const save=()=>fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n')
save()
try{
 const output=execFileSync(process.execPath,[pnpm,'add',`file:vendor/${name}`,'--offline','--ignore-scripts'],{cwd:profile,encoding:'utf8',windowsHide:true,env:{...process.env,CI:'true'},timeout:180000})
 fs.writeFileSync(path.join(packDir,'pnpm-install.txt'),output)
 const after=JSON.parse(fs.readFileSync(path.join(profile,'package.json'),'utf8'))
 const dependencyChanges=[...new Set([...Object.keys(before.dependencies),...Object.keys(after.dependencies)])].filter(key=>before.dependencies[key]!==after.dependencies[key])
 if(JSON.stringify(dependencyChanges)!==JSON.stringify(['win-pilot']))throw new Error('Unexpected dependency changes: '+dependencyChanges.join(', '))
 const files=[]
 for(const item of packed.files){
  const source=path.join(root,item.path),target=path.join(installed,item.path)
  const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex')
  const sourceHash=sha(source),installedHash=sha(target)
  if(sourceHash!==installedHash)throw new Error('Installed file mismatch: '+item.path)
  files.push({path:item.path,sha256:installedHash})
 }
 if(fs.existsSync(path.join(installed,'lib','task-desktop','safety-hold.json')))throw new Error('Installed package retains temporary hold')
 report.status='installed_verified';report.dependency_changes=dependencyChanges;report.files=files;report.finished_at=new Date().toISOString();save()
 console.log(JSON.stringify({status:report.status,backup,tarball:report.tarball,files:files.length,report:reportPath}))
}catch(error){report.status='failed';report.error=error.message;save();throw error}
