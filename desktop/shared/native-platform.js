import './primitives.js';
import {NativeRenderer} from './native-renderer.js';
import {importFiles} from '../../src/importers/formats.js';
import {booleanSolid} from '../../src/geometry/csg.js';
import {serializeProject,parseProject} from '../../src/core/document.js';
import {setNativeInflater} from '../../src/io/zip.js';
import {fromBase64,toBase64} from './encoding.js';

/** A task adapter, not a Worker emulation claim. CPU work runs on WebScene's engine thread. */
export class NativeTask {
 constructor(kind){if(!['import','operation'].includes(kind))throw Error('Unknown native task.');this.kind=kind;this.cancelled=false;this.timer=null;}
 postMessage(data){this.timer=setTimeout(async()=>{if(this.cancelled)return;const send=data=>{if(!this.cancelled)this.onmessage?.({data});};try{if(this.kind==='import'){const project=await importFiles(data.files,data.name,data.scale,p=>send({type:'progress',progress:p}));send({type:'complete',project});}else{const mesh=booleanSolid(data.a,data.b,data.operation,data.options);send({type:'complete',mesh});}}catch(e){send({type:'error',message:e.message});}},0);}
 terminate(){this.cancelled=true;clearTimeout(this.timer);}
}
export function fileFromPacket(packet){
 if(!packet||typeof packet.name!=='string'||packet.name.length>1024)throw Error('Invalid selected file.');
 const bytes=fromBase64(packet.data,128*1024*1024),ext=packet.name.split('.').pop().toLowerCase(),type={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'}[ext]||'application/octet-stream';
 return {name:packet.name,size:bytes.length,type,arrayBuffer:async()=>bytes.slice().buffer};
}
export function createNativePlatform(invoke){
 setNativeInflater(async(bytes,expected)=>fromBase64((await invoke('inflate',{data:toBase64(bytes),expected})).data,256*1024*1024));
 return {
  engineLabel:'Native GPU',saveLabel:'Project file saved',
  createRenderer(canvas){const renderer=new NativeRenderer(canvas,invoke);renderer.platformBlob=data=>new Blob([fromBase64(data)],{type:'image/png'});return renderer;},
  createWorker:kind=>new NativeTask(kind),
  async pickFiles(kind){const response=await invoke('open',{kind});return (response?.files||[]).map(fileFromPacket);},
  async download(blob,name){const result=await invoke('save',{name,data:toBase64(new Uint8Array(await blob.arrayBuffer()))});return result?.saved===true;},
  imageURL(bytes,mime){const safe=['image/png','image/jpeg','image/webp'].includes(mime)?mime:'image/png';return 'data:'+safe+';base64,'+toBase64(bytes);},
  revokeImageURL(){},
  async saveWorkspace(project,camera){const data=JSON.stringify({schema:1,project:serializeProject(project),camera,savedAt:Date.now()});await invoke('recovery.save',{data});},
  async loadWorkspace(){const result=await invoke('recovery.load',{});if(!result?.data)return null;const data=JSON.parse(result.data);if(data.schema!==1)throw Error('Unsupported recovery file.');return {project:parseProject(data.project),camera:data.camera};},
  clearWorkspace:()=>invoke('recovery.clear',{}),
  reload:()=>invoke('reload',{}),
  dispose:()=>setNativeInflater(null)
 };
}
