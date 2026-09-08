// Inventory a real dotnet publish directory. This tool never fabricates missing binaries.
import {readdir,readFile,writeFile,mkdir,lstat,copyFile,access} from 'node:fs/promises';
import {resolve,relative,basename,join} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyDesktopUI} from './desktop-bundle.mjs';
const [folder,rid]=process.argv.slice(2);
const modules={'win-x64':'webscene_native_engine.dll','linux-x64':'libwebscene_native_engine.so','osx-arm64':'libwebscene_native_engine.dylib'};
try{
 if(!folder||!modules[rid])throw Error('Usage: node tools/desktop-package.mjs PUBLISH_DIRECTORY win-x64|linux-x64|osx-arm64');
 const out=resolve(folder);
 if(!/[/\\]artifacts[/\\]desktop[/\\]/.test(out))throw Error('Package inventory must target artifacts/desktop/<rid>.');
 for(const file of ['SingleTake.Desktop.dll',modules[rid],'icudtl.dat','webscene_bootstrap_snapshot.bin','webscene_bootstrap_snapshot.meta','webscene-native-runtime.json','Components/Modeler/main.js','Components/Modeler/webscene-component.json','Components/Modeler/ui/index.html','Components/Modeler/ui/style.css','Components/Modeler/ui-source.json'])await access(join(out,file));
 await verifyDesktopUI(join(out,'Components/Modeler'));
 // NuGet metadata remains authoritative. Copy present license files without deleting any original runtime asset.
 const assets=JSON.parse(await readFile('desktop/SingleTake.Desktop/obj/project.assets.json','utf8'));
 const packageRoots=Object.keys(assets.packageFolders||{});const packages=[];
 for(const [id,entry] of Object.entries(assets.libraries||{})){
  if(entry.type!=='package')continue;
  const noticeFiles=[];
  for(const file of entry.files||[]){
   if(!/(^|\/)(?:licen[cs]e(?:[._-].*)?|copying|copyright(?:[._-].*)?|third[-_ ]?party[-_ ]?(?:notices|licenses)(?:[._-].*)?|notice(?:[._-].*)?)$/i.test(file))continue;
   for(const root of packageRoots){const source=resolve(root,entry.path,file);try{if(!(await lstat(source)).isFile())continue;const dest=join(out,'LICENSES','NuGet',...id.split('/'),file);await mkdir(resolve(dest,'..'),{recursive:true});await copyFile(source,dest);noticeFiles.push(relative(out,dest).replaceAll('\\','/'));break;}catch(error){if(error.code!=='ENOENT')throw error;}}
  }
  packages.push({id,contentHash:entry.sha512||null,notices:noticeFiles});
 }
 const entries=[];
 async function scan(dir){for(const e of await readdir(dir,{withFileTypes:true})){const path=join(dir,e.name);if(e.isSymbolicLink())throw Error('Review symbolic links before native packaging: '+path);if(e.isDirectory())await scan(path);else if(e.isFile()){const name=relative(out,path).replaceAll('\\','/');if(name==='desktop-manifest.json')continue;const data=await readFile(path);entries.push({path:name,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});}}}
 await scan(out);
 const manifest={application:'SingleTake',runtimeIdentifier:rid,stage:'unsigned-native-preview',nativeExecution:'not-established-by-packaging',browser:false,renderer:'OpenGL/GLES',packages,files:entries.sort((a,b)=>a.path.localeCompare(b.path))};
 await writeFile(join(out,'desktop-manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({status:'INVENTORIED',rid,files:entries.length,bytes:entries.reduce((n,e)=>n+e.bytes,0),nativeExecution:'NOT_TESTED_BY_THIS_TOOL'},null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
