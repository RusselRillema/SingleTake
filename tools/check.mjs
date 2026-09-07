import {readdir,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
async function walk(path){const files=[];for(const e of await readdir(path,{withFileTypes:true})){if(e.name==='node_modules')continue;const f=path+'/'+e.name;if(e.isDirectory())files.push(...await walk(f));else if(/\.(m?js)$/.test(e.name))files.push(f);}return files;}
let failed=false,count=0;for(const file of await walk(root)){if(file.includes('ui-smoke-bundle'))continue;const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(r.status){console.error(r.stderr);failed=true;}count++;const text=await readFile(file,'utf8');for(const match of text.matchAll(/from\s+['"](\.[^'"]+)['"]/g)){try{await readFile(new URL(match[1],new URL('file://'+file)));}catch{console.error('Unresolved module',file,match[1]);failed=true;}}}console.log(`${count} JavaScript files syntax-checked; ${failed?'FAIL':'PASS'}`);process.exitCode=failed?1:0;
