import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from '../tools/build.mjs';
import {parseOptions,publish,publishPlan,REPOSITORY} from '../tools/publish.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
test('Static build includes only runtime assets and resolves modules below a project subpath',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'singletake-deploy-'));try{const out=join(dir,'site'),result=await build({root,out}),manifest=JSON.parse(await readFile(join(out,'asset-manifest.json'),'utf8'));assert.equal(result.namingMatches,0);assert(result.relativeReferences>50);assert(result.files>20);
  for(const asset of manifest.assets){assert(!/^(?:tests|tools|docs|samples|\.git)\//.test(asset.path));const bytes=await readFile(join(out,asset.path));assert.equal(bytes.length,asset.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);}
  for(const asset of manifest.assets.filter(a=>a.path.endsWith('.js'))){const text=await readFile(join(out,asset.path),'utf8');for(const match of text.matchAll(/(?:from\s*|import\s*\(|new URL\(\s*)['"](\.[^'"]+)['"]/g)){const url=new URL(match[1],new URL(asset.path,'https://example.test/SingleTake/'));assert(url.pathname.startsWith('/SingleTake/'));assert(manifest.assets.some(a=>a.path===url.pathname.slice('/SingleTake/'.length)));}}
  const html=await readFile(join(out,'index.html'),'utf8');assert(html.includes('Content-Security-Policy'));assert(html.includes("script-src 'self'"));assert(html.includes('SingleTake'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('Static packaging is deterministic across two output directories',async()=>{const dir=await mkdtemp(join(tmpdir(),'singletake-rebuild-'));try{await build({root,out:join(dir,'a')});await build({root,out:join(dir,'b')});assert.equal(await readFile(join(dir,'a','asset-manifest.json'),'utf8'),await readFile(join(dir,'b','asset-manifest.json'),'utf8'));}finally{await rm(dir,{recursive:true,force:true});}});
test('Build refuses to replace the source tree',async()=>{await assert.rejects(build({root,out:root}),/cannot replace/);});
test('Publishing supports explicit dry-run and exposes no force-push option',()=>{assert.equal(parseOptions(['--dry-run','--pages']).dryRun,true);assert.throws(()=>parseOptions(['--force']),/Unknown/);assert.throws(()=>parseOptions(['--token','value']),/Unknown/);assert(publishPlan({pages:true,setOrigin:true}).some(s=>s.includes('never overwrite')));assert.equal(REPOSITORY,'RusselRillema/SingleTake');});
test('Publish dry-run performs no remote or filesystem mutation',async()=>{const dir=await mkdtemp(join(tmpdir(),'singletake-publish-'));try{await writeFile(join(dir,'sentinel.txt'),'unchanged');await publish({dryRun:true,pages:true,setOrigin:true},{root:dir});assert.deepEqual(await readdir(dir),['sentinel.txt']);assert.equal(await readFile(join(dir,'sentinel.txt'),'utf8'),'unchanged');}finally{await rm(dir,{recursive:true,force:true});}});
test('Deployment workflow separates unprivileged checks from main-only publication',async()=>{const text=await readFile(new URL('../.github/workflows/pages.yml',import.meta.url),'utf8');assert(text.includes('pull_request:'));assert(!text.includes('pull_request_target:'));assert(text.includes('fetch-depth: 0'));assert(text.includes('persist-credentials: false'));assert(text.includes('needs: build'));assert(text.includes("github.event_name != 'pull_request' && github.ref == 'refs/heads/main'"));assert(text.includes('pages: write'));assert(text.includes('id-token: write'));assert(text.includes('path: dist'));assert(!text.includes('contents: write'));assert(!text.includes('${{ secrets.'));});
