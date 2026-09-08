import {readFile,writeFile,mkdir,realpath,copyFile} from 'node:fs/promises';
import {resolve,relative,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const hash=text=>createHash('sha256').update(text).digest('hex');

/** The UI is never forked: package the repository's exact HTML/CSS and bundle the shared App. */
export async function canonicalUI(){
 const html=await readFile(resolve(root,'index.html'),'utf8'),css=await readFile(resolve(root,'style.css'),'utf8');
 const match=html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);if(!match)throw Error('Canonical HTML has no body.');
 const scripts=[...match[1].matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi)];
 if(scripts.length!==1||!/^<script type="module" src="\.\/src\/main\.js"><\/script>$/.test(scripts[0][0]))throw Error('Review canonical HTML boot scripts before desktop packaging.');
 const body=match[1].replace(scripts[0][0],'');
 const sources={};for(const name of ['index.html','style.css','src/app.js','src/ui/tools.js','src/ui/model-interactions.js','src/ui/icons.js','src/ui/shortcuts.js'])sources[name]=hash(await readFile(resolve(root,name)));
 return {html,css,body,sources};
}
/** Restricted, deterministic static-module packer for the reviewed application graph. */
export async function bundleDesktop({entry=resolve(root,'desktop/shared/native-entry.js'),output=null}={}){
 const ui=await canonicalUI(),modules=new Map(),visiting=new Set();
 modules.set('singletake:ui',{source:'const uiBody='+JSON.stringify(ui.body)+';\nconst uiCss='+JSON.stringify(ui.css)+';\nconst sourceHashes='+JSON.stringify(ui.sources)+';',names:['uiBody','uiCss','sourceHashes']});
 async function visit(file){
  file=await realpath(file);if(!file.startsWith(root+sep))throw Error('A desktop module escaped the repository.');
  const id=relative(root,file).replaceAll('\\','/');if(modules.has(id))return id;if(visiting.has(id))throw Error('Cyclic desktop imports need review: '+id);visiting.add(id);
  let source=await readFile(file,'utf8');const imports=[...source.matchAll(/\bimport\s+(?:(\*\s+as\s+\w+|\{[^}]+\})\s+from\s+)?['"]([^'"]+)['"]\s*;/g)],replacements=[];
  for(const m of imports){
   const spec=m[2];if(spec!=='singletake:ui'&&(!spec.startsWith('.')||!spec.endsWith('.js')))throw Error('Only reviewed local JavaScript modules are allowed: '+spec);
   const dependency=spec==='singletake:ui'?spec:await visit(resolve(dirname(file),spec));let binding='';
   if(m[1]?.startsWith('*'))binding='const '+m[1].match(/as\s+(\w+)/)[1]+'=';
   else if(m[1])binding='const {'+m[1].slice(1,-1).split(',').map(x=>x.trim()).filter(Boolean).map(x=>x.replace(/\s+as\s+/,':')).join(',')+'}=';
   replacements.push({start:m.index,end:m.index+m[0].length,text:binding+'load('+JSON.stringify(dependency)+');'});
  }
  for(const r of replacements.reverse())source=source.slice(0,r.start)+r.text+source.slice(r.end);
  if(/\bimport\s*(?:\(|\.)|\bexport\s*(?:default|\{|\*)/.test(source))throw Error('Unsupported ESM syntax in '+id);
  const names=[];source=source.replace(/\bexport\s+(?=(?:async\s+)?(?:function|class|const|let)\b)(?:(async)\s+)?(function|class|const|let)\s+(\w+)/g,(_,async,kind,name)=>{names.push(name);return (async?'async ':'')+kind+' '+name;});
  modules.set(id,{source,names});visiting.delete(id);return id;
 }
 const start=await visit(entry);
 const text='/* SingleTake: shared web UI in the native component. Generated; do not edit. */\n(function(){\n"use strict";\nconst factories=Object.create(null),cache=Object.create(null);\n'+[...modules].map(([id,m])=>'factories['+JSON.stringify(id)+']=function(load,exports){\n'+m.source+'\nObject.assign(exports,{'+m.names.join(',')+'});\n};\n').join('')+'function load(id){if(cache[id])return cache[id];if(!factories[id])throw Error("Missing bundled module: "+id);const exports=cache[id]={};factories[id](load,exports);return exports;}\nload('+JSON.stringify(start)+');\n})();\n';
 const report={entry:relative(root,entry).replaceAll('\\','/'),modules:[...modules.keys()],bytes:Buffer.byteLength(text),sha256:hash(text),canonicalSources:ui.sources};
 if(output){
  await mkdir(dirname(output),{recursive:true});await writeFile(output,text);
  const assets=resolve(dirname(output),'ui');await mkdir(assets,{recursive:true});
  await copyFile(resolve(root,'index.html'),resolve(assets,'index.html'));await copyFile(resolve(root,'style.css'),resolve(assets,'style.css'));
  await writeFile(resolve(dirname(output),'ui-source.json'),JSON.stringify({schema:1,controller:'src/app.js',entryPoint:{path:'main.js',sha256:report.sha256},sources:ui.sources},null,2)+'\n');
 }
 return {text,report};
}
/** Check actual publish output against the canonical sources and current deterministic bundle. */
export async function verifyDesktopUI(folder){
 const generated=await bundleDesktop(),meta=JSON.parse(await readFile(resolve(folder,'ui-source.json'),'utf8'));
 if(meta.schema!==1||meta.controller!=='src/app.js'||meta.entryPoint?.path!=='main.js')throw Error('The package does not declare the shared UI.');
 if(JSON.stringify(meta.sources)!==JSON.stringify(generated.report.canonicalSources))throw Error('Stale shared UI source manifest.');
 for(const name of ['index.html','style.css']){
  const source=await readFile(resolve(root,name)),published=await readFile(resolve(folder,'ui',name));
  if(!source.equals(published))throw Error('Stale shared UI asset: '+name);
 }
 const entry=await readFile(resolve(folder,'main.js'));
 if(hash(entry)!==meta.entryPoint.sha256||hash(entry)!==generated.report.sha256)throw Error('Stale or modified shared UI entry point.');
 return {controller:meta.controller,sources:meta.sources,entryPoint:meta.entryPoint};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const {report}=await bundleDesktop({output:resolve(root,'desktop/SingleTake.Desktop/Components/Modeler/main.js')});console.log(JSON.stringify(report,null,2));}catch(error){console.error(error.message);process.exitCode=1;}
}
