// Local-only delivery. Preserve the previous package and profile before pnpm changes.
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('..',import.meta.url))
const profile='/dsh/profiles/desktop'
const installed=path.join(profile,'node_modules','win-pilot')
const pnpm='/dsh/dsh-runtimes/dsh-primary-runtime/dependencies/pnpm/bin/pnpm.cjs'
const stamp=new Date().toISOString().replace(/[:.]/g,'-')
const backup=path.join('/dsh/local-plugins/win-pilot','backup-'+stamp)
const packDir=path.join(root,'artifacts','local-delivery',stamp)
fs.mkdirSync(backup,{recursive:true});fs.mkdirSync(packDir,{recursive:true})
for(const name of ['package.json','pnpm-lock.yaml','cordis.patch.yml'])if(fs.existsSync(path.join(profile,name)))fs.copyFileSync(path.join(profile,name),path.join(backup,name))
fs.cpSync(installed,path.join(backup,'win-pilot'),{recursive:true,dereference:true})
const before=JSON.parse(fs.readFileSync(path.join(profile,'package.json'),'utf8'))
const npmCli='/node_modules/npm/bin/npm-cli.js'
const packed=JSON.parse(execFileSync(process.execPath,[npmCli,'pack','--json','--pack-destination',packDir],{cwd:root,encoding:'utf8',windowsHide:true}))[0]
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
