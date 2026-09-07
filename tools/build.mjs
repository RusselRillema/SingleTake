import {mkdir,readdir,readFile,writeFile,rm,lstat,rename} from 'node:fs/promises';
import {resolve,relative,dirname,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {audit} from './audit.mjs';
const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const digest=data=>createHash('sha256').update(data).digest('hex');
export async function build({root=projectRoot,out=resolve(root,'dist')}={}){
 root=resolve(root);out=resolve(out);if(out===root||root.startsWith(out+sep))throw Error('The build output cannot replace the source or a parent directory.');
 const staging=out+'.staging';await rm(staging,{recursive:true,force:true});await mkdir(staging,{recursive:true});const files=new Map();
 const copy=async name=>{const from=resolve(root,name),stat=await lstat(from);if(stat.isSymbolicLink()||!stat.isFile())throw Error('Only regular source files may be deployed: '+name);const bytes=await readFile(from);files.set(name,bytes);await mkdir(dirname(resolve(staging,name)),{recursive:true});await writeFile(resolve(staging,name),bytes);};
 async function sourceFiles(folder){const stat=await lstat(resolve(root,folder));if(stat.isSymbolicLink())throw Error('Source directory links are not allowed.');for(const e of await readdir(resolve(root,folder),{withFileTypes:true})){const name=folder+'/'+e.name;if(e.isSymbolicLink())throw Error('Source links are not allowed: '+name);if(e.isDirectory())await sourceFiles(name);else if(e.isFile()&&extname(name)==='.js')await copy(name);else throw Error('Unreviewed runtime asset: '+name);}}
 try{
  for(const name of ['index.html','style.css','LICENSE','THIRD_PARTY_NOTICES.md'])await copy(name);await sourceFiles('src');
  const csp="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'self' blob: data:; font-src 'self'; base-uri 'self'; form-action 'none'; object-src 'none'";
  let html=files.get('index.html').toString('utf8');html=html.replace('<head>','<head>\n<meta http-equiv="Content-Security-Policy" content="'+csp+'">\n<meta name="referrer" content="no-referrer">');files.set('index.html',Buffer.from(html));await writeFile(resolve(staging,'index.html'),html);
  files.set('.nojekyll',Buffer.from(''));await writeFile(resolve(staging,'.nojekyll'),'');
  const references=[];
  const validate=(from,url)=>{if(url.startsWith('data:')||url.startsWith('#'))return;if(!url.startsWith('./')&&!url.startsWith('../'))throw Error('A deployed reference must be relative: '+from+' → '+url);const dest=relative(staging,resolve(dirname(resolve(staging,from)),url)).replaceAll('\\','/');if(dest.startsWith('../')||!files.has(dest))throw Error('Missing or escaping deployed asset: '+from+' → '+url);references.push({from,to:dest});};
  for(const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g))validate('index.html',match[1]);
  for(const [name,bytes] of files)if(name.endsWith('.js')){const text=bytes.toString('utf8');for(const match of text.matchAll(/(?:from\s*|import\s*\(|new URL\(\s*)['"](\.[^'"]+)['"]/g))validate(name,match[1]);}
  const manifest={application:'SingleTake',version:JSON.parse(await readFile(resolve(root,'package.json'),'utf8')).version,assets:[...files].sort(([a],[b])=>a.localeCompare(b)).map(([path,bytes])=>({path,bytes:bytes.length,sha256:digest(bytes)})),relativeReferences:references.length};await writeFile(resolve(staging,'asset-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  const result=await audit({root:staging,history:false});if(result.status!=='PASS')throw Error('Built artifact failed naming/asset audit: '+JSON.stringify(result.issues));
  await rm(out,{recursive:true,force:true});await rename(staging,out);return {out,files:manifest.assets.length+1,bytes:manifest.assets.reduce((n,a)=>n+a.bytes,0),relativeReferences:references.length,namingMatches:result.matches};
 }catch(error){await rm(staging,{recursive:true,force:true});throw error;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.length>2)throw Error('Build takes no CLI arguments; it writes only dist/.');console.log(JSON.stringify(await build(),null,2));}catch(error){console.error(error.message);process.exitCode=1;}
}
