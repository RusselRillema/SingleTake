import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {resolve,relative,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
/** A deliberately restricted static-module packer for this reviewed module graph, not a general TS transpiler. */
export async function bundleDesktop({entry=resolve(root,'desktop/shared/native-entry.js'),output=null}={}){
 const modules=new Map(),visiting=new Set();
 async function visit(file){file=await realpath(file);if(!file.startsWith(root+sep)&&file!==root)throw Error('A desktop module escaped the repository.');const id=relative(root,file).replaceAll('\\','/');if(modules.has(id))return id;if(visiting.has(id))throw Error('Cyclic desktop imports need a full ESM bundler: '+id);visiting.add(id);let source=await readFile(file,'utf8');const imports=[...source.matchAll(/\bimport\s+(?:(\*\s+as\s+\w+|\{[^}]+\})\s+from\s+)?['"]([^'"]+)['"]\s*;/g)],replacements=[];
  for(const m of imports){const spec=m[2];if(!spec.startsWith('.')||!spec.endsWith('.js'))throw Error('Only local JavaScript modules are allowed: '+spec);const dependency=await visit(resolve(dirname(file),spec));let binding='';if(m[1]?.startsWith('*'))binding='const '+m[1].match(/as\s+(\w+)/)[1]+'=';else if(m[1]){const members=m[1].slice(1,-1).split(',').map(x=>x.trim()).filter(Boolean).map(x=>x.replace(/\s+as\s+/,':'));binding='const {'+members.join(',')+'}=';}replacements.push({start:m.index,end:m.index+m[0].length,text:binding+'load('+JSON.stringify(dependency)+');'});}
  for(const r of replacements.reverse())source=source.slice(0,r.start)+r.text+source.slice(r.end);
  if(/\bimport\s*(?:\(|\.)|\bexport\s*(?:default|\{|\*)/.test(source))throw Error('Unsupported ESM syntax in '+id);
  const names=[];source=source.replace(/\bexport\s+(?=(?:async\s+)?(?:function|class|const|let)\b)(?:(async)\s+)?(function|class|const|let)\s+(\w+)/g,(_,async,kind,name)=>{names.push(name);return (async?'async ':'')+kind+' '+name;});
  modules.set(id,{source,names});visiting.delete(id);return id;
 }
 const start=await visit(entry);const text='/* SingleTake native component. Generated from reviewed shared source; do not edit. */\n(function(){\n"use strict";\nconst factories=Object.create(null),cache=Object.create(null);\n'+[...modules].map(([id,m])=>'factories['+JSON.stringify(id)+']=function(load,exports){\n'+m.source+'\nObject.assign(exports,{'+m.names.join(',')+'});\n};\n').join('')+'function load(id){if(cache[id])return cache[id];if(!factories[id])throw Error("Missing bundled module: "+id);const exports=cache[id]={};factories[id](load,exports);return exports;}\nload('+JSON.stringify(start)+');\n})();\n';
 const report={entry:relative(root,entry).replaceAll('\\','/'),modules:[...modules.keys()],bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex')};
 if(output){await mkdir(dirname(output),{recursive:true});await writeFile(output,text);}return {text,report};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{const {report}=await bundleDesktop({output:resolve(root,'desktop/SingleTake.Desktop/Components/Modeler/main.js')});console.log(JSON.stringify(report,null,2));}catch(error){console.error(error.message);process.exitCode=1;}}
