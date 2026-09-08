import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {canonicalUI,bundleDesktop,verifyDesktopUI} from '../tools/desktop-bundle.mjs';
import {NativeRenderer} from '../desktop/shared/native-renderer.js';
import {NativeTask,createNativePlatform,fileFromPacket} from '../desktop/shared/native-platform.js';
import {Document,newProject,makeNode,serializeProject,projectBounds} from '../src/core/document.js';
import {box} from '../src/geometry/mesh.js';
import {App} from '../src/app.js';
import {toBase64} from '../desktop/shared/encoding.js';
import {formValues} from '../src/ui/forms.js';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const hash=text=>createHash('sha256').update(text).digest('hex');
function project(){const p=newProject('Shared UI test'),m=box(2,3,4);p.meshes[m.id]=m;p.nodes.push(makeNode('Box',m.id,{kind:'raw'}));return p;}

test('Canonical native UI has the unchanged body and CSS, excluding only browser boot',async()=>{
 const ui=await canonicalUI(),html=await read('index.html');assert.equal(ui.html,html);assert.equal(ui.css,await read('style.css'));
 assert.equal(ui.body,html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)[1].replace('<script type="module" src="./src/main.js"></script>',''));
 for(const path of Object.keys(ui.sources))assert.equal(ui.sources[path],hash(await read(path)));
});
test('Build includes original controls, icons and dialogs, never the retired desktop controller',async()=>{
 const {report,text}=await bundleDesktop();for(const name of ['src/app.js','src/ui/tools.js','src/ui/model-interactions.js','src/ui/icons.js','src/ui/shortcuts.js','src/ui/forms.js'])assert(report.modules.includes(name));
 assert(!report.modules.some(x=>/native-app|platform\/browser|render\/renderer/.test(x)));assert(!/class NativeApp|installPanel\(/.test(text));
});
test('Canonical package assets are copied exactly, with source hashes for stale-build detection',async t=>{
 const folder=await mkdtemp(join(tmpdir(),'singletake-ui-'));t.after(()=>rm(folder,{recursive:true,force:true}));
 const {report}=await bundleDesktop({output:join(folder,'main.js')});for(const path of ['index.html','style.css'])assert.equal(await readFile(join(folder,'ui',path),'utf8'),await read(path));
 const manifest=JSON.parse(await readFile(join(folder,'ui-source.json'),'utf8'));assert.equal(manifest.controller,'src/app.js');assert.deepEqual(manifest.sources,report.canonicalSources);
});
test('Native host is a single full-window WebScene input surface above a noninteractive GPU layer',async()=>{
 const source=await read('desktop/SingleTake.Desktop/MainWindow.cs');assert(source.includes('root.Children.Add(nativeLayer)'));assert(source.includes('root.Children.Add(component)'));
 assert(source.includes('IsHitTestVisible = false'));assert(source.includes('Canvas.SetLeft(viewport, r.Left)'));assert(!source.includes('370,*'));assert(!source.includes('KeyDown +='));assert(!source.includes('PointerPressed +='));
});
test('Native shader style convention matches the shared controller',async()=>{
 const text=await read('desktop/SingleTake.Desktop/Rendering/NativeViewport.cs');assert(text.includes('if(frame.Style!=2)'));assert(text.includes('frame.Style==2?resource.Wire:resource.Lines'));assert(text.includes('if(style==1)base.rgb='));assert(text.includes('linear*=exposure'));
});
function rafEnvironment(t){
 const names=['window','requestAnimationFrame','cancelAnimationFrame','devicePixelRatio'];const before=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));const callbacks=new Map();let id=0;
 globalThis.window=new EventTarget();globalThis.devicePixelRatio=2;globalThis.requestAnimationFrame=fn=>{callbacks.set(++id,fn);return id;};globalThis.cancelAnimationFrame=n=>callbacks.delete(n);
 t.after(()=>{for(const name of names){const descriptor=before.get(name);if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
 return callbacks;
}
test('DOM viewport offsets and HiDPI pixels are separate from logical camera coordinates',async t=>{
 rafEnvironment(t);let rect={left:61,top:109,width:800,height:600};const canvas={width:0,height:0,getBoundingClientRect:()=>rect};const r=new NativeRenderer(canvas,async()=>{});r.resize();
 assert.equal(canvas.width,1600);assert.equal(canvas.height,1200);assert.equal(r.camera.width,800);assert.equal(r.camera.height,600);assert.deepEqual(r.rectangle,rect);
 rect={left:61,top:109,width:500,height:300};r.resize();assert.equal(canvas.width,1000);assert.equal(r.camera.aspect,500/300);await r.dispose();
});
test('One native frame in flight; later changes use acknowledged resources, not a growing queue',async t=>{
 const callbacks=rafEnvironment(t),sent=[];let reply;const r=new NativeRenderer({width:0,height:0,getBoundingClientRect:()=>({left:61,top:109,width:800,height:600})},frame=>frame);
 r.invoke=async(method,frame)=>{assert.equal(method,'frame');sent.push(frame);return new Promise(resolve=>reply=()=>resolve({accepted:frame.serial}));};
 r.resize();await r.setProject(project());r.camera.fit(projectBounds(r.project));r.active=true;
 const first=r.flush();r.camera.orbit(4,4);r.requestRender();await r.flush();assert.equal(sent.length,1);assert(r.dirty);reply();await first;
 assert.equal(callbacks.size,1);const callback=[...callbacks.values()][0];callbacks.clear();callback();assert.equal(sent.length,2);assert.equal(sent[1].resources.length,0);assert.equal(sent[1].viewport.left,61);reply();await r.inFlight;await r.dispose();
});
test('A rejected native frame reports a lost presenter, not a fake success',async t=>{
 rafEnvironment(t);const r=new NativeRenderer({getBoundingClientRect:()=>({left:0,top:0,width:800,height:600})},async()=>({accepted:-1}));r.resize();await r.setProject(project());r.active=true;let message;r.addEventListener('lost',e=>message=e.detail);await r.flush();assert.match(message,/acknowledge/);assert.equal(r.active,false);await r.dispose();
});
test('Save cancellation keeps the same dirty document',async()=>{
 const app=Object.create(App.prototype);app.doc=new Document();app.doc.replace(project());app.doc.dirty=true;app.platform={download:async()=>false};await app.action('save');assert(app.doc.dirty);
});
test('An edit while a native save picker is open cannot mark newer changes saved',async()=>{
 const app=Object.create(App.prototype);app.doc=new Document();app.doc.replace(project());app.doc.dirty=true;let reply;app.platform={download:()=>new Promise(resolve=>reply=resolve)};
 const save=app.action('save');app.doc.transaction('New edit',p=>p.name='Changed during save');reply(true);await save;assert(app.doc.dirty);assert.equal(app.doc.project.name,'Changed during save');
});
test('Native recovery round-trips binary textures and the original project identity',async()=>{
 let envelope=null;const platform=createNativePlatform(async(method,args)=>{if(method==='recovery.save'){envelope=args.data;return {saved:true};}if(method==='recovery.load')return {data:envelope};throw Error(method);});
 try{const p=project();p.materials[0].texture={bytes:new Uint8Array([1,2,3,254]),mime:'image/png',name:'test.png'};await platform.saveWorkspace(p,{distance:5});const loaded=await platform.loadWorkspace();assert.equal(loaded.project.id,p.id);assert.deepEqual(loaded.project.materials[0].texture.bytes,p.materials[0].texture.bytes);assert.deepEqual(loaded.camera,{distance:5});}finally{platform.dispose();}
});
test('Native selected-file adapter preserves bytes and rejects malformed selection payloads',async()=>{
 const original=new Uint8Array([0,1,254,255]);const file=fileFromPacket({name:'finish.png',data:toBase64(original)});assert.equal(file.type,'image/png');assert.equal(file.size,4);assert.deepEqual(new Uint8Array(await file.arrayBuffer()),original);assert.throws(()=>fileFromPacket({name:1,data:'AA=='}));assert.throws(()=>fileFromPacket({name:'test',data:'invalid'}));
});
test('Native import task routes the same editable project parser',async()=>{
 const p=project(),task=new NativeTask('import');const result=await new Promise(resolve=>{task.onmessage=({data})=>{if(data.type!=='progress')resolve(data);};task.postMessage({files:[{name:'test.take',buffer:new TextEncoder().encode(serializeProject(p)).buffer}],name:'test.take',scale:1});});assert.equal(result.type,'complete');assert.equal(result.project.id,p.id);task.terminate();
});
test('Native task cancellation suppresses delayed results and validates task kinds',async()=>{
 assert.throws(()=>new NativeTask('unknown'));const task=new NativeTask('import');let received=false;task.onmessage=()=>received=true;task.postMessage({files:[],name:'empty.take',scale:1});task.terminate();await new Promise(resolve=>setTimeout(resolve,20));assert.equal(received,false);
});
test('Form values read real named controls, disabled fields and checkbox state without FormData',()=>{
 const field=(name,value,extra={})=>({tagName:'INPUT',name,value,type:'text',...extra});const form={querySelectorAll:()=>[field('length','4m'),field('hidden','skip',{disabled:true}),field('selection','on',{type:'checkbox',checked:false}),field('enabled','on',{type:'checkbox',checked:true}),field('format','glb',{type:'radio',checked:true}),field('format','obj',{type:'radio',checked:false})]};const data=formValues(form);assert.equal(data.get('length'),'4m');assert.equal(data.get('format'),'glb');assert(!data.has('selection'));assert(!data.has('hidden'));assert(data.has('enabled'));
});
test('Shared photo-reference handler belongs to the real App, not a detached controller',()=>assert.equal(typeof App.prototype.addPhotoFile,'function'));

test('Publication rejects a stale generated UI payload rather than shipping an old panel',async t=>{
 const folder=await mkdtemp(join(tmpdir(),'singletake-publish-ui-'));t.after(()=>rm(folder,{recursive:true,force:true}));
 await bundleDesktop({output:join(folder,'main.js')});await verifyDesktopUI(folder);
 await writeFile(join(folder,'main.js'),'/* stale payload */');await assert.rejects(verifyDesktopUI(folder),/Stale or modified/);
});
