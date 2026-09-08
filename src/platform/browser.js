import {Renderer} from '../render/renderer.js';
import {saveWorkspace,loadWorkspace,clearWorkspace} from '../io/persistence.js';

/** Browser services only. Neither controls nor modeling commands belong in a platform. */
export function createBrowserPlatform(){
 return {
  engineLabel:'WebGPU',saveLabel:'Project file downloaded',
  createRenderer:canvas=>new Renderer(canvas),
  saveWorkspace,loadWorkspace,clearWorkspace,
  createWorker(kind){
   if(kind==='import')return new Worker(new URL('../io/import-worker.js',import.meta.url),{type:'module'});
   if(kind==='operation')return new Worker(new URL('../io/operation-worker.js',import.meta.url),{type:'module'});
   throw Error('Unknown background task: '+kind);
  },
  download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);return true;},
  imageURL:(bytes,mime)=>URL.createObjectURL(new Blob([bytes],{type:mime})),
  revokeImageURL:url=>URL.revokeObjectURL(url),
  reload:()=>location.reload()
 };
}
