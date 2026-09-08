import {readFile,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const config=await readFile(resolve(root,'desktop/Directory.Build.props'),'utf8');
const version=config.match(/<WebSceneVersion>([^<]+)</)[1];
const rid=process.argv.find(x=>x.startsWith('--rid='))?.slice(6)||({win32:'win',linux:'linux',darwin:'osx'}[process.platform]+'-'+({x64:'x64',arm64:'arm64'}[process.arch]||process.arch));
const issues=[],result={runtimeIdentifier:rid,webSceneVersion:version,packagePublication:'UNVERIFIED',nativeBuild:'NOT_RUN',issues};
if(!['win-x64','linux-x64','osx-arm64'].includes(rid))issues.push('No supported runtime package is configured for '+rid);
if(Number(process.versions.node.split('.')[0])<22)issues.push('Use Node.js 22+ for the build-time shared-source packer.');
const dotnet=spawnSync('dotnet',['--version'],{encoding:'utf8'});if(dotnet.error||dotnet.status!==0)issues.push('Install .NET SDK 10.0 or newer with a compatible net10 toolchain.');else{result.dotnet=dotnet.stdout.trim();if(Number(result.dotnet.split('.')[0])<10)issues.push('.NET SDK 10 is required.');}
if(process.argv.includes('--online')){
 const packages=['WebScene.Sdk.Avalonia','WebScene.NativeEngine.Runtime.'+rid];const checked=[];
 for(const id of packages){try{const response=await fetch('https://api.nuget.org/v3-flatcontainer/'+id.toLowerCase()+'/index.json',{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('HTTP '+response.status);const json=await response.json();if(!json.versions?.includes(version))throw Error('Configured version is not listed.');checked.push(id);}catch(error){issues.push(id+' '+version+': package availability not established ('+error.message+'). Do not clone upstream or silently substitute an older API.');}}
 result.packagePublication=checked.length===packages.length?'LISTED_ON_NUGET':'NOT_ESTABLISHED';
}else result.note='Run with --online to verify exact NuGet availability before restoring. Source version numbers are not proof of publication.';
result.status=issues.length?'BLOCKED':'PRECHECK_ONLY';console.log(JSON.stringify(result,null,2));process.exitCode=issues.length?1:0;
