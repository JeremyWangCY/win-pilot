import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const result=spawnSync('dotnet',['build',path.join(root,'native/task-desktop/task-desktop.csproj'),'-c','Release','-p:NuGetAudit=false','--ignore-failed-sources','-o',path.join(root,'lib/task-desktop')],{cwd:root,stdio:'inherit',windowsHide:true,env:{...process.env,DOTNET_CLI_TELEMETRY_OPTOUT:'1',DOTNET_SKIP_FIRST_TIME_EXPERIENCE:'1'}})
process.exitCode=result.status??1
