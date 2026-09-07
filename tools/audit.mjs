import {createHash} from 'node:crypto';
import {readFile,readdir,lstat} from 'node:fs/promises';
import {resolve,relative,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

export const normalize=(text,sensitive=false)=>{
 const value=String(text).normalize('NFKC');
 return (sensitive?value:value.toLowerCase()).replace(sensitive?/[^A-Za-z0-9@]/g:/[^a-z0-9@]/g,'');
};
export function fingerprint(text,caseSensitive=false,id='test'){
 const value=normalize(text,caseSensitive);let rolling=0;
 for(let i=0;i<value.length;i++)rolling=(Math.imul(rolling,257)+value.charCodeAt(i))>>>0;
 return {id,caseSensitive,length:value.length,rolling,sha256:createHash('sha256').update(value).digest('hex')};
}
/** Rolling hashes make the full normalized-substring scan linear per distinct policy length. */
export function findMatches(text,rules){
 const matches=new Set();
 for(const sensitive of [false,true]){
  const value=normalize(text,sensitive),groups=new Map();
  for(const rule of rules.filter(r=>r.caseSensitive===sensitive)){if(!groups.has(rule.length))groups.set(rule.length,new Map());const table=groups.get(rule.length);if(!table.has(rule.rolling))table.set(rule.rolling,[]);table.get(rule.rolling).push(rule);}
  for(const [length,table] of groups){if(!length||value.length<length)continue;let hash=0,power=1;
   for(let i=0;i<length;i++){hash=(Math.imul(hash,257)+value.charCodeAt(i))>>>0;if(i<length-1)power=Math.imul(power,257)>>>0;}
   for(let offset=0;offset<=value.length-length;offset++){
    const candidates=table.get(hash);if(candidates){const digest=createHash('sha256').update(value.slice(offset,offset+length)).digest('hex');for(const rule of candidates)if(digest===rule.sha256)matches.add(rule.id);}
    if(offset<value.length-length)hash=(Math.imul((hash-Math.imul(value.charCodeAt(offset),power))>>>0,257)+value.charCodeAt(offset+length))>>>0;
   }
  }
 }
 return [...matches];
}
const excluded=new Set(['.git','node_modules','dist','site','test-results','playwright-report','coverage','__pycache__']);
const textExtensions=new Set(['.js','.mjs','.json','.md','.html','.css','.yml','.yaml','.py','.ps1','.sh','.txt','.svg']);
const rootFiles=new Set(['LICENSE','.gitignore','.gitattributes','.nojekyll','.node-version']);
export async function audit({root=resolve(fileURLToPath(new URL('../',import.meta.url))),history=true,policy=null}={}){
 const config=policy||JSON.parse(await readFile(new URL('audit-policy.json',import.meta.url),'utf8'));
 const rules=config.rules;const issues=[],seen=new Set(),report={status:'PASS',policyRules:rules.length,workingFiles:0,historicalBlobs:0,commits:0,history:'NOT_REQUESTED',matches:0,issues};
 const reported=new Set();const check=(text,label)=>{for(const id of findMatches(text,rules)){const key=label+'|'+id;if(!reported.has(key)){reported.add(key);issues.push({object:label,rule:id});}}};
 const bytes=(buffer,label)=>{const digest=createHash('sha256').update(buffer).digest('hex');if(seen.has(digest))return;seen.add(digest);check(buffer.toString('utf8'),label);check(buffer.toString('utf16le'),label);if(buffer.length>1){const reversed=Buffer.from(buffer.subarray(0,buffer.length-buffer.length%2));reversed.swap16();check(reversed.toString('utf16le'),label);}};
 async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){if(excluded.has(entry.name))continue;const file=resolve(dir,entry.name),name=relative(root,file).replaceAll('\\','/');if(entry.name.startsWith('.env')){issues.push({object:name,rule:'private-configuration'});continue;}check(name,'path:'+name);if(entry.isSymbolicLink()){issues.push({object:name,rule:'symlink'});continue;}if(entry.isDirectory())await walk(file);else if(entry.isFile()){
   if(!textExtensions.has(extname(entry.name))&&!rootFiles.has(entry.name))issues.push({object:name,rule:'unreviewed-file-type'});
   const stat=await lstat(file);if(stat.size>8*1024*1024){issues.push({object:name,rule:'oversized-source'});continue;}report.workingFiles++;bytes(await readFile(file),name);
  }} }
 await walk(root);
 function git(args,allowFailure=false){const result=spawnSync('git',['-C',root,...args],{encoding:null,maxBuffer:64*1024*1024});if(result.status!==0&&!allowFailure)throw Error('Git history audit failed: '+(result.stderr?.toString()||result.error?.message||'unknown error'));return result;}
 if(history){const probe=git(['rev-parse','--show-toplevel'],true);if(probe.status!==0||resolve(probe.stdout.toString().trim())!==resolve(root))report.history='NO_REPOSITORY';else{
   if(git(['rev-parse','--is-shallow-repository']).stdout.toString().trim()==='true')throw Error('Full history is required for the naming audit. Fetch with --unshallow first.');
   const commits=git(['rev-list','--all']).stdout.toString().trim().split('\n').filter(Boolean),blobs=new Set();report.history='ALL_REACHABLE_REFS';report.commits=commits.length;
   for(const commit of commits){bytes(git(['cat-file','commit',commit]).stdout,'commit:'+commit);const tree=git(['ls-tree','-r','-z',commit]).stdout.toString('utf8').split('\0').filter(Boolean);
    for(const row of tree){const tab=row.indexOf('\t'),[mode,type,sha]=row.slice(0,tab).split(' '),name=row.slice(tab+1);check(name,'historical-path:'+name);if(mode==='120000'||mode==='160000')issues.push({object:'tree:'+commit+':'+name,rule:'external-tree-link'});if(type==='blob')blobs.add(sha);}
   }
   for(const blob of blobs){report.historicalBlobs++;bytes(git(['cat-file','blob',blob]).stdout,'blob:'+blob);}
  }}
 report.matches=issues.length;report.status=issues.length?'FAIL':'PASS';return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const args=process.argv.slice(2),index=args.indexOf('--root'),known=new Set(['--root','--no-history']);for(let i=0;i<args.length;i++){if(args[i]==='--root'){if(!args[++i])throw Error('--root requires a directory.');continue;}if(!known.has(args[i]))throw Error('Unknown audit argument.');}
  const result=await audit({root:index>=0?resolve(args[index+1]):undefined,history:!args.includes('--no-history')});console.log(JSON.stringify(result,null,2));process.exitCode=result.status==='PASS'?0:1;
 }catch(error){console.error(error.message);process.exitCode=1;}
}
