import {SceneProxy} from './scene-proxy.js';

/** Native presentation of the shared controller's real DOM canvas. Input remains in WebScene's DOM. */
export class NativeRenderer extends SceneProxy {
 constructor(canvas,invoke){
  super(()=>this.schedule());this.canvas=canvas;this.invoke=invoke;this.active=false;this.disposed=false;this.scheduled=null;this.inFlight=null;
  this.resolution=1;this.exposure=1;this.shadows=false;this.rectangle=null;
  this.stats={backend:'native-opengl',triangles:0,draws:0,visible:0,cpuMs:0,gpuMs:null};
  this.capabilities={msaa:1,shadowMap:'Not implemented',shadows:false,renderResolution:false};
  this.onResize=()=>this.resize();
 }
 async init(){
  window.addEventListener('resize',this.onResize);
  if(typeof ResizeObserver==='function'){this.observer=new ResizeObserver(this.onResize);this.observer.observe(this.canvas);}
  // Layout is owned by WebScene. Do not invent a separate viewport size or sidebar offset.
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  this.resize();if(!this.rectangle)throw Error('The shared canvas did not receive a usable layout from the UI runtime.');
  this.active=true;this.requestRender();
 }
 resize(){
  const rect=this.canvas.getBoundingClientRect();
  if(![rect.left,rect.top,rect.width,rect.height].every(Number.isFinite)||rect.width<=0||rect.height<=0)return;
  this.rectangle={left:rect.left,top:rect.top,width:rect.width,height:rect.height};
  const ratio=globalThis.devicePixelRatio||1,width=Math.round(rect.width*ratio),height=Math.round(rect.height*ratio);
  if(this.canvas.width!==width)this.canvas.width=width;if(this.canvas.height!==height)this.canvas.height=height;
  super.resize(rect.width,rect.height);
 }
 async setProject(project){super.setProject(project);}
 schedule(){if(!this.active||this.disposed||this.scheduled!==null||this.inFlight)return;this.scheduled=requestAnimationFrame(()=>{this.scheduled=null;this.flush();});}
 async flush(){
  if(this.disposed||!this.active||!this.dirty||!this.project||this.inFlight)return;
  this.dirty=false;const frame=this.packet();if(!frame)return;
  frame.viewport={...this.rectangle};frame.exposure=this.exposure;
  const start=performance.now();
  this.inFlight=this.invoke('frame',frame);
  try{
   const result=await this.inFlight;if(result?.accepted!==frame.serial)throw Error('The native presenter did not acknowledge this scene.');
   this.acknowledge(frame);this.stats.cpuMs=performance.now()-start;this.stats.visible=frame.nodes.length;
  }catch(error){this.active=false;this.dispatchEvent(new CustomEvent('lost',{detail:error.message}));}
  finally{this.inFlight=null;if(this.dirty)this.schedule();}
 }
 /** Called only with evidence from the native present event, not an invented FPS counter. */
 presented(e){if(this.disposed)return;this.stats={...this.stats,triangles:e.triangles||0,draws:e.draws||0,cpuMs:e.cpuMs||0,visible:e.placements||0};this.dispatchEvent(new CustomEvent('frame',{detail:this.stats}));}
 async screenshot(){const result=await this.invoke('screenshot',{});if(!result?.data)throw Error('The native presenter returned no screenshot.');return this.platformBlob(result.data);}
 async dispose(){if(this.disposed)return;this.disposed=true;this.active=false;if(this.scheduled!==null)cancelAnimationFrame(this.scheduled);window.removeEventListener('resize',this.onResize);this.observer?.disconnect();if(this.inFlight)try{await this.inFlight;}catch{}this.cache.clear();}
}
