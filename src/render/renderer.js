import {raycastScene} from './picking.js';
import * as M from '../core/math.js';
import {sceneEntries,projectBounds} from '../core/document.js';
import {bakeMesh,mesh,face} from '../geometry/mesh.js';
import {BVH} from '../geometry/bvh.js';
import {Camera} from './camera.js';
import {sceneShader,axisShader} from './shaders.js';
import {tagVisible} from '../core/tags.js';
const USAGE=()=>globalThis.GPUBufferUsage;
const srgb=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
const align=(n,a=4)=>Math.ceil(n/a)*a;
function buffer(device,array,usage,label){const b=device.createBuffer({label,size:Math.max(4,align(array.byteLength)),usage:usage|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(b,0,array);return b;}
export class Renderer extends EventTarget{
 constructor(canvas){super();this.canvas=canvas;this.camera=new Camera();this.style=0;this.shadows=true;this.edges=true;this.grid=true;this.axes=true;this.backEdges=false;this.colorByTag=false;this.geometryPreviews=new Map();this.exposure=1;this.resolution=1;this.selected=new Set();this.cache=new Map();this.materialCache=new Map();this.framePending=false;this.stats={draws:0,triangles:0,visible:0,cpuMs:0,gpuMs:null,backend:'Initializing WebGPU'};this.destroyed=false;this.lastFrame=0;this.generation=0;}
 async init(){
  if(!navigator.gpu)throw Error('WebGPU is unavailable. Open this app on localhost or HTTPS in a browser with WebGPU enabled. This build does not substitute a 2D or WebGL preview.');
  this.adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!this.adapter)throw Error('No WebGPU adapter is available. Enable hardware acceleration, update the graphics driver, and reopen the browser.');
  const features=this.adapter.features.has('timestamp-query')?['timestamp-query']:[];
  this.device=await this.adapter.requestDevice({requiredFeatures:features});const d=this.device;
  d.addEventListener('uncapturederror',e=>this.dispatchEvent(new CustomEvent('error',{detail:e.error.message})));
  d.lost.then(info=>{if(!this.destroyed)this.dispatchEvent(new CustomEvent('lost',{detail:`GPU device lost (${info.reason}): ${info.message}. Save the model, then use Reload GPU.`}));});
  this.context=this.canvas.getContext('webgpu');this.format=navigator.gpu.getPreferredCanvasFormat();
  this.context.configure({device:d,format:this.format,alphaMode:'opaque',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
  const shader=d.createShaderModule({label:'SingleTake • PBR + shadows + picking',code:sceneShader});
  const compilation=await shader.getCompilationInfo();const errors=compilation.messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(e=>`WGSL ${e.lineNum}:${e.linePos} ${e.message}`).join('\n'));
  const G=GPUShaderStage;
  const baseEntries=[{binding:0,visibility:G.VERTEX|G.FRAGMENT,buffer:{type:'uniform'}},{binding:1,visibility:G.VERTEX,buffer:{type:'read-only-storage'}},{binding:2,visibility:G.VERTEX,buffer:{type:'read-only-storage'}}];
  this.globalLayout=d.createBindGroupLayout({entries:[...baseEntries,{binding:3,visibility:G.FRAGMENT,sampler:{type:'comparison'}},{binding:4,visibility:G.FRAGMENT,texture:{sampleType:'depth'}}]});
  this.shadowLayout=d.createBindGroupLayout({entries:baseEntries});
  this.materialLayout=d.createBindGroupLayout({entries:[{binding:0,visibility:G.FRAGMENT,buffer:{type:'uniform'}},{binding:1,visibility:G.FRAGMENT,sampler:{type:'filtering'}},{binding:2,visibility:G.FRAGMENT,texture:{sampleType:'float'}}]});
  const layout=d.createPipelineLayout({bindGroupLayouts:[this.globalLayout,this.materialLayout]});
  const vertexBuffers=[{arrayStride:32,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'},{shaderLocation:2,offset:24,format:'float32x2'}]}];
  const base={layout,vertex:{module:shader,entryPoint:'vs',buffers:vertexBuffers},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less-equal'},multisample:{count:4}};
  const blend={color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}};
  this.opaque=await d.createRenderPipelineAsync({...base,label:'Opaque PBR',fragment:{module:shader,entryPoint:'fs',targets:[{format:this.format}]}});
  this.transparent=await d.createRenderPipelineAsync({...base,label:'Transparent PBR',depthStencil:{...base.depthStencil,depthWriteEnabled:false},fragment:{module:shader,entryPoint:'fs',targets:[{format:this.format,blend}]}});
  this.pickPipeline=await d.createRenderPipelineAsync({...base,label:'Integer object picking',layout:d.createPipelineLayout({bindGroupLayouts:[this.globalLayout]}),multisample:{count:1},fragment:{module:shader,entryPoint:'pickFS',targets:[{format:'r32uint'}]}});
  this.shadowPipeline=await d.createRenderPipelineAsync({label:'Directional depth map',layout:d.createPipelineLayout({bindGroupLayouts:[this.shadowLayout]}),vertex:{module:shader,entryPoint:'shadowVS',buffers:vertexBuffers},fragment:{module:shader,entryPoint:'shadowFS',targets:[]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less',depthBias:2,depthBiasSlopeScale:1.5}});
  this.linePipeline=await d.createRenderPipelineAsync({label:'Topological edges',layout:d.createPipelineLayout({bindGroupLayouts:[this.globalLayout]}),vertex:{module:shader,entryPoint:'lineVS',buffers:[{arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:'float32x3'}]}]},fragment:{module:shader,entryPoint:'lineFS',targets:[{format:this.format,blend}]},primitive:{topology:'line-list'},depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'less-equal'},multisample:{count:4}});
  this.backLinePipeline=await d.createRenderPipelineAsync({label:'Dashed obscured edges',layout:d.createPipelineLayout({bindGroupLayouts:[this.globalLayout]}),vertex:{module:shader,entryPoint:'lineVS',buffers:[{arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:'float32x3'}]}]},fragment:{module:shader,entryPoint:'backLineFS',targets:[{format:this.format,blend}]},primitive:{topology:'line-list'},depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'greater'},multisample:{count:4}});
  const axisModule=d.createShaderModule({label:'Model XYZ axes',code:axisShader});
  const axisInfo=await axisModule.getCompilationInfo();if(axisInfo.messages.some(m=>m.type==='error'))throw Error(axisInfo.messages.map(m=>m.message).join('\n'));
  this.axisPipeline=await d.createRenderPipelineAsync({label:'World-origin axes',layout:'auto',vertex:{module:axisModule,entryPoint:'vs',buffers:[{arrayStride:28,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'},{shaderLocation:2,offset:24,format:'float32'}]}]},fragment:{module:axisModule,entryPoint:'fs',targets:[{format:this.format,blend}]},primitive:{topology:'line-list'},depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'less-equal'},multisample:{count:4}});
  this.axisBuffer=d.createBuffer({size:12*28,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
  const mipShader=d.createShaderModule({label:'Texture mip generation',code:`
struct Out { @builtin(position) position:vec4<f32>, @location(0) uv:vec2<f32> };
@group(0) @binding(0) var mipSampler:sampler;
@group(0) @binding(1) var mipSource:texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i:u32)->Out { let uv=vec2<f32>(f32((i<<1u)&2u),f32(i&2u));var out:Out;out.position=vec4<f32>(uv*2.0-vec2<f32>(1.0),0.0,1.0);out.uv=vec2<f32>(uv.x,1.0-uv.y);return out; }
@fragment fn fs(input:Out)->@location(0) vec4<f32>{return textureSample(mipSource,mipSampler,input.uv);}`});
  this.mipPipeline=await d.createRenderPipelineAsync({label:'sRGB mipmaps',layout:'auto',vertex:{module:mipShader,entryPoint:'vs'},fragment:{module:mipShader,entryPoint:'fs',targets:[{format:'rgba8unorm-srgb'}]},primitive:{topology:'triangle-list'}});
  this.mipSampler=d.createSampler({magFilter:'linear',minFilter:'linear'});
  this.frameBuffer=d.createBuffer({size:256,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  this.axisGroup=d.createBindGroup({layout:this.axisPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.frameBuffer}}]});
  this.shadowTexture=d.createTexture({label:'2048² directional shadow',size:[2048,2048],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
  this.shadowSampler=d.createSampler({compare:'less-equal',magFilter:'linear',minFilter:'linear'});
  this.colorSampler=d.createSampler({addressModeU:'repeat',addressModeV:'repeat',magFilter:'linear',minFilter:'linear',mipmapFilter:'linear',maxAnisotropy:4});
  this.white=d.createTexture({size:[1,1],format:'rgba8unorm-srgb',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});d.queue.writeTexture({texture:this.white},new Uint8Array([255,255,255,255]),{bytesPerRow:4},[1,1]);
  this.floorMaterial={id:'floor',name:'Ground',color:[.8,.81,.79,1],roughness:1,metalness:0,ground:true};
  this.floor=mesh([[-1,0,-1],[-1,0,1],[1,0,1],[1,0,-1]],[face([[0,1,2,3]])],'Ground');this.floor.id='__floor';
  this.ensureResource(this.floor);
  if(features.length){this.querySet=d.createQuerySet({type:'timestamp',count:2});this.queryResolve=d.createBuffer({size:256,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});this.queryRead=d.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});}
  const info=this.adapter.info;this.stats.backend=`WebGPU${info?.architecture?' · '+info.architecture:''}`;
  this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(this.canvas);this.resize();return this;
 }
 resize(){if(!this.device)return;const rect=this.canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2)*this.resolution;const width=Math.max(1,Math.min(this.device.limits.maxTextureDimension2D,Math.round(rect.width*dpr))),height=Math.max(1,Math.min(this.device.limits.maxTextureDimension2D,Math.round(rect.height*dpr)));
  this.camera.width=rect.width;this.camera.height=rect.height;this.camera.aspect=rect.width/Math.max(1,rect.height);
  if(width!==this.canvas.width||height!==this.canvas.height||!this.depth){this.canvas.width=width;this.canvas.height=height;for(const t of [this.depth,this.msaa,this.pickTexture,this.pickDepth])t?.destroy();const d=this.device;
   this.depth=d.createTexture({size:[width,height],format:'depth24plus',sampleCount:4,usage:GPUTextureUsage.RENDER_ATTACHMENT});
   this.msaa=d.createTexture({size:[width,height],format:this.format,sampleCount:4,usage:GPUTextureUsage.RENDER_ATTACHMENT});
   this.pickTexture=d.createTexture({size:[width,height],format:'r32uint',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});this.pickDepth=d.createTexture({size:[width,height],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
  }this.requestRender();
 }
 createResource(m){const baked=bakeMesh(m),d=this.device;return {...baked,source:m,bvh:new BVH(m,baked.triangles),groups:baked.groups.map(g=>({...g,vertexBuffer:buffer(d,g.vertices,GPUBufferUsage.VERTEX,'Mesh vertices'),indexBuffer:buffer(d,g.indices,GPUBufferUsage.INDEX,'Mesh indices')})),lineBuffer:buffer(d,baked.lines,GPUBufferUsage.VERTEX,'Crease edges'),wireBuffer:buffer(d,baked.wire,GPUBufferUsage.VERTEX,'All edges')};}
 ensureResource(m){let r=this.cache.get(m.id);if(r?.source===m)return r;if(r)this.disposeResource(r);r=this.createResource(m);this.cache.set(m.id,r);return r;}
 previewGeometry(nodeId,m){if(!this.device)return;const old=this.geometryPreviews.get(nodeId);if(old?.source===m)return;const next=this.createResource(m);if(old)this.disposeResource(old);this.geometryPreviews.set(nodeId,next);this.requestRender();}
 clearGeometryPreview(){for(const r of this.geometryPreviews.values())this.disposeResource(r);this.geometryPreviews.clear();this.requestRender();}
 disposeResource(r){for(const g of r.groups){g.vertexBuffer.destroy();g.indexBuffer.destroy();}r.lineBuffer.destroy();r.wireBuffer.destroy();}
 async ensureMaterial(mat){
  let r=this.materialCache.get(mat.id);const textureIdentity=mat.texture;
  if(r&&r.textureIdentity!==textureIdentity){if(r.texture!==this.white)r.texture?.destroy();r.buffer.destroy();this.materialCache.delete(mat.id);r=null;}
  if(!r){let texture=this.white;
   if(mat.texture?.bytes?.length){try{const bitmap=await createImageBitmap(new Blob([mat.texture.bytes],{type:mat.texture.mime}),{colorSpaceConversion:'none'});const max=4096,scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));let source=bitmap,w=Math.max(1,Math.round(bitmap.width*scale)),h=Math.max(1,Math.round(bitmap.height*scale));if(scale<1){source=new OffscreenCanvas(w,h);source.getContext('2d').drawImage(bitmap,0,0,w,h);}
    const levels=1+Math.floor(Math.log2(Math.max(w,h)));texture=this.device.createTexture({label:mat.name,size:[w,h],mipLevelCount:levels,format:'rgba8unorm-srgb',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});this.device.queue.copyExternalImageToTexture({source,flipY:!!mat.texture.flipY},{texture},[w,h]);this.generateMips(texture,levels);bitmap.close();
   }catch(e){this.dispatchEvent(new CustomEvent('warning',{detail:`Texture ${mat.name}: ${e.message}`}));}}
   const b=this.device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});r={texture,textureIdentity,buffer:b};r.bindGroup=this.device.createBindGroup({layout:this.materialLayout,entries:[{binding:0,resource:{buffer:b}},{binding:1,resource:this.colorSampler},{binding:2,resource:texture.createView()}]});this.materialCache.set(mat.id,r);
  }
  this.device.queue.writeBuffer(r.buffer,0,new Float32Array([...mat.color.slice(0,3).map(srgb),mat.color[3]??1,mat.roughness??.7,mat.metalness??0,r.texture!==this.white?1:0,mat.ground?1:0]));return r;
 }
 generateMips(texture,levels){if(levels<=1)return;const encoder=this.device.createCommandEncoder({label:'Generate texture mip chain'});for(let level=1;level<levels;level++){const group=this.device.createBindGroup({layout:this.mipPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.mipSampler},{binding:1,resource:texture.createView({baseMipLevel:level-1,mipLevelCount:1})}]});const pass=encoder.beginRenderPass({colorAttachments:[{view:texture.createView({baseMipLevel:level,mipLevelCount:1}),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:0},storeOp:'store'}]});pass.setPipeline(this.mipPipeline);pass.setBindGroup(0,group);pass.draw(3);pass.end();}this.device.queue.submit([encoder.finish()]);}
 async setProject(project){const generation=++this.generation;this.clearGeometryPreview();this.project=project;this.entries=sceneEntries(project);this.sceneBounds=projectBounds(project);
  this.tagMaterials=new Map(project.tags.filter(t=>!t.folder).map(t=>{const hex=/^#[0-9a-f]{6}$/i.test(t.color)?t.color:'#8aa697';return [t.id,{id:'__tag_'+t.id,name:t.name,color:[...hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255),1],roughness:.85,metalness:0}];}));
  const usedMaterialIds=new Set([...project.materials.map(m=>m.id),...[...this.tagMaterials.values()].map(m=>m.id)]);usedMaterialIds.add('floor');for(const [id,r] of this.materialCache)if(!usedMaterialIds.has(id)){r.buffer.destroy();if(r.texture!==this.white)r.texture.destroy();this.materialCache.delete(id);}
  const used=new Set(this.entries.filter(e=>e.node.mesh).map(e=>e.node.mesh));used.add('__floor');for(const [id,r] of this.cache)if(!used.has(id)){this.disposeResource(r);this.cache.delete(id);}
  for(const id of used)if(id!=='__floor')this.ensureResource(project.meshes[id]);
  await Promise.all([this.ensureMaterial(this.floorMaterial),...project.materials.map(m=>this.ensureMaterial(m)),...[...this.tagMaterials.values()].map(m=>this.ensureMaterial(m))]);
  if(generation!==this.generation)return;this.requestRender();
 }
 clipPlane(){const s=this.project?.section;if(!s?.enabled)return [0,0,0,0];const normal={x:[1,0,0],y:[0,1,0],z:[0,0,1]}[s.axis],sign=s.flip?1:-1;return [...normal.map(v=>v*sign),-s.value*sign];}
 isClipped(point){const c=this.clipPlane();return this.project?.section.enabled&&M.dot(c,point)+c[3]<0;}
 requestRender(){if(this.framePending||this.destroyed)return;this.framePending=true;requestAnimationFrame(()=>{this.framePending=false;try{this.render();}catch(e){this.dispatchEvent(new CustomEvent('error',{detail:e.message}));}});}
 updateFrame(){
  const p=this.project;if(!p||!this.depth)return null;const origin=this.camera.origin,{vp}=this.camera.matrices(origin),planes=M.frustumPlanes(this.camera.matrices([0,0,0]).vp),center=M.center(this.sceneBounds),radius=Math.max(5,M.len(M.extent(this.sceneBounds))*.65),light=M.norm([-.55,.9,.45]);
  const lightVP=M.mmul(M.ortho(-radius,radius,-radius,radius,.1,radius*5),M.lookAt(M.sub(M.add(center,M.mul(light,radius*2.2)),origin),M.sub(center,origin)));
  const data=new Float32Array(64);data.set(vp,0);data.set(lightVP,16);data.set([...M.sub(this.camera.eye,origin),this.exposure],32);data.set([...light,1.3],36);data.set([p.section.enabled?1:0,0,0,0],40);const clip=this.clipPlane();data.set([clip[0],clip[1],clip[2],clip[3]+M.dot(clip,origin)],44);data.set([this.canvas.width,this.canvas.height,this.shadows?1:0,this.style],48);const gridScale=10**Math.floor(Math.log10(Math.max(.1,this.camera.distance/12)));data.set([gridScale,this.grid?1:0,origin[0],origin[2]],52);this.device.queue.writeBuffer(this.frameBuffer,0,data);
  if(this.axes){const span=Math.max(100,this.camera.distance*8,M.dist(this.camera.target,[0,0,0])*2),axisData=[],dash=Math.max(.05,this.camera.distance/50);for(const [axis,color] of [[[1,0,0],[.78,.20,.18]],[[0,0,-1],[.16,.52,.27]],[[0,1,0],[.17,.39,.83]]])for(const sign of [-1,1])for(const t of [0,span])axisData.push(...M.sub(M.mul(axis,t*sign),origin),...color,(sign<0?-1:1)*(1+t/dash));this.device.queue.writeBuffer(this.axisBuffer,0,new Float32Array(axisData));}
  const visible=[],objects=new Float32Array((this.entries.length+1)*36),tags=new Map(p.tags.map(t=>[t.id,tagVisible(p,t.id)]));this.objectIds=[''];
  const floorSize=Math.max(80,radius*10),floorModel=M.mmul(M.translation([-origin[0],this.sceneBounds.min[1]-.03-origin[1],-origin[2]]),M.scaling([floorSize,1,floorSize]));objects.set(floorModel,0);objects.set(M.identity(),16);objects.set([0,0,0,0],32);
  for(let i=0;i<this.entries.length;i++){
   let e=this.entries[i];if(this.previewTransform?.ids.has(e.node.id))e={...e,matrix:M.mmul(this.previewTransform.matrix,e.matrix)};const idx=i+1;this.objectIds[idx]=e.node.id;const model=e.matrix.slice();for(let k=0;k<3;k++)model[12+k]-=origin[k];let normal;try{normal=M.transpose(M.inverse(e.matrix));}catch{normal=M.identity();}
   objects.set(model,idx*36);objects.set(normal,idx*36+16);const reflection=M.dot(M.transform(e.matrix,[1,0,0],0),M.cross(M.transform(e.matrix,[0,1,0],0),M.transform(e.matrix,[0,0,1],0)))<0;objects.set([this.selected.has(e.node.id)?1:0,idx,reflection?1:0,this.editingIds&&!this.editingIds.has(e.node.id)?-1:0],idx*36+32);
   if(!e.visible||!e.node.mesh)continue;const r=this.geometryPreviews.get(e.node.id)||this.cache.get(e.node.mesh);if(!r||!r.source.vertices.length)continue;const box=M.boundsWorld(r.bounds,e.matrix),c=M.center(box),rad=M.len(M.extent(box))*.5;visible.push({...e,index:idx,resource:r,inFrustum:M.visibleSphere(planes,c,rad),distance:M.dist(c,this.camera.eye)});
  }
  const ids=[],main=[],transparent=[],shadow=[],line=[],floorGroup=this.cache.get('__floor').groups[0];ids.push(0);main.push({group:floorGroup,material:this.materialCache.get('floor'),count:1,first:0});
  const batch=(list,shadowPass=false)=>{const groups=new Map();for(const e of visible){if(!shadowPass&&!e.inFrustum)continue;for(let gi=0;gi<e.resource.groups.length;gi++){const g=e.resource.groups[gi];if(tags.get(g.tag)===false)continue;const mi=g.material>=0?g.material:e.material,mat=(this.colorByTag?this.tagMaterials.get(g.tag&&g.tag!=='0'?g.tag:e.tag||'0'):null)||p.materials[mi]||p.materials[0],alpha=mat.color[3]??1;if(shadowPass&&alpha<.5)continue;const trans=!shadowPass&&(alpha<.999||this.style>=2),key=`${this.geometryPreviews.has(e.node.id)?e.node.id:e.node.mesh}:${gi}:${mat.id}${trans?':'+e.index:''}`;let cmd=groups.get(key);if(!cmd){cmd={group:g,material:this.materialCache.get(mat.id),indices:[],transparent:trans,distance:e.distance};groups.set(key,cmd);}cmd.indices.push(e.index);}}
   let commands=[...groups.values()];if(!shadowPass)commands.sort((a,b)=>a.transparent===b.transparent?(a.transparent?b.distance-a.distance:0):Number(a.transparent)-Number(b.transparent));
   for(const cmd of commands){cmd.first=ids.length;cmd.count=cmd.indices.length;ids.push(...cmd.indices);if(cmd.transparent)transparent.push(cmd);else list.push(cmd);}
  };batch(main);if(this.shadows)batch(shadow,true);
  if(this.edges||this.backEdges||this.style>=2){const batches=new Map();for(const e of visible){if(!e.inFrustum)continue;const key=this.geometryPreviews.has(e.node.id)?e.node.id:e.node.mesh;let cmd=batches.get(key);if(!cmd){cmd={resource:e.resource,indices:[]};batches.set(key,cmd);}cmd.indices.push(e.index);}for(const cmd of batches.values()){cmd.first=ids.length;cmd.count=cmd.indices.length;ids.push(...cmd.indices);line.push(cmd);}}
  const max=this.device.limits.maxStorageBufferBindingSize;if(objects.byteLength>max||ids.length*4>max)throw Error('Scene exceeds this adapter’s storage-buffer limit.');
  const alloc=(key,size)=>{if(!this[key]||this[key].size<Math.max(16,size)){this[key]?.destroy();this[key]=this.device.createBuffer({label:key,size:Math.min(max,align(Math.max(16,size)*1.5,256)),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});this.bindGroupsDirty=true;}};
  alloc('objectBuffer',objects.byteLength);alloc('instanceBuffer',ids.length*4);this.device.queue.writeBuffer(this.objectBuffer,0,objects);this.device.queue.writeBuffer(this.instanceBuffer,0,new Uint32Array(ids));
  if(this.bindGroupsDirty||!this.globalGroup){const entries=[{binding:0,resource:{buffer:this.frameBuffer}},{binding:1,resource:{buffer:this.objectBuffer}},{binding:2,resource:{buffer:this.instanceBuffer}}];this.globalGroup=this.device.createBindGroup({layout:this.globalLayout,entries:[...entries,{binding:3,resource:this.shadowSampler},{binding:4,resource:this.shadowTexture.createView()}]});this.shadowGroup=this.device.createBindGroup({layout:this.shadowLayout,entries});this.bindGroupsDirty=false;}
  this.stats.visible=visible.filter(e=>e.inFrustum).length;this.stats.triangles=[...main,...transparent].reduce((n,c)=>n+c.group.indices.length/3*c.count,0);this.stats.draws=main.length+transparent.length+line.length*(this.backEdges?2:1)+(this.axes?1:0)+(this.shadows?shadow.length:0);
  return {main,transparent,shadow,line};
 }
 draw(pass,cmd,material=true){pass.setVertexBuffer(0,cmd.group.vertexBuffer);pass.setIndexBuffer(cmd.group.indexBuffer,'uint32');if(material){if(!cmd.material)return;pass.setBindGroup(1,cmd.material.bindGroup);}pass.drawIndexed(cmd.group.indices.length,cmd.count,0,0,cmd.first);}
 render(){if(!this.device||!this.project||this.destroyed)return;const start=performance.now(),plan=this.updateFrame();if(!plan)return;this.plan=plan;const encoder=this.device.createCommandEncoder({label:'SingleTake frame'});const timing=!!this.querySet&&!this.queryPending;let begin=true;
  if(this.shadows){const pass=encoder.beginRenderPass({label:'Shadows',colorAttachments:[],depthStencilAttachment:{view:this.shadowTexture.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'},...(timing?{timestampWrites:{querySet:this.querySet,beginningOfPassWriteIndex:0}}:{})});pass.setPipeline(this.shadowPipeline);pass.setBindGroup(0,this.shadowGroup);for(const cmd of plan.shadow)this.draw(pass,cmd,false);pass.end();begin=false;}
  const outputTexture=this.context.getCurrentTexture();const pass=encoder.beginRenderPass({label:'MSAA PBR viewport',colorAttachments:[{view:this.msaa.createView(),resolveTarget:outputTexture.createView(),clearValue:{r:.895,g:.91,b:.891,a:1},loadOp:'clear',storeOp:'discard'}],depthStencilAttachment:{view:this.depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'},...(timing?{timestampWrites:{querySet:this.querySet,...(begin?{beginningOfPassWriteIndex:0}:{}),endOfPassWriteIndex:1}}:{})});
  pass.setBindGroup(0,this.globalGroup);pass.setPipeline(this.opaque);for(const cmd of plan.main)this.draw(pass,cmd);pass.setPipeline(this.transparent);for(const cmd of plan.transparent)this.draw(pass,cmd);pass.setPipeline(this.linePipeline);
  const drawLines=()=>{for(const cmd of plan.line){const all=this.style>=2,values=all?cmd.resource.wire:cmd.resource.lines;if(!values.length)continue;pass.setVertexBuffer(0,all?cmd.resource.wireBuffer:cmd.resource.lineBuffer);pass.draw(values.length/3,cmd.count,0,cmd.first);}};
  if(this.edges||this.style>=2)drawLines();if(this.backEdges){pass.setPipeline(this.backLinePipeline);drawLines();}
  if(this.axes){pass.setPipeline(this.axisPipeline);pass.setBindGroup(0,this.axisGroup);pass.setVertexBuffer(0,this.axisBuffer);pass.draw(12);}pass.end();
  if(this.captureFrame)encoder.copyTextureToBuffer({texture:outputTexture},{buffer:this.captureFrame.buffer,bytesPerRow:this.captureFrame.bytesPerRow},[this.canvas.width,this.canvas.height]);
  if(timing){encoder.resolveQuerySet(this.querySet,0,2,this.queryResolve,0);encoder.copyBufferToBuffer(this.queryResolve,0,this.queryRead,0,16);this.queryPending=true;}
  this.device.queue.submit([encoder.finish()]);
  if(timing)this.queryRead.mapAsync(GPUMapMode.READ).then(()=>{const v=new BigUint64Array(this.queryRead.getMappedRange());this.stats.gpuMs=Number(v[1]-v[0])/1e6;this.queryRead.unmap();this.queryPending=false;}).catch(()=>{this.queryPending=false;});
  const end=performance.now();this.stats.cpuMs=end-start;this.stats.fps=this.lastFrame&&start-this.lastFrame<300?1000/(start-this.lastFrame):0;this.lastFrame=start;this.dispatchEvent(new CustomEvent('frame',{detail:this.stats}));
 }
 async pick(x,y){if(!this.plan||this.pickBusy)return null;this.pickBusy=true;let read;
  try{this.render();const encoder=this.device.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:this.pickTexture.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:this.pickDepth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});pass.setPipeline(this.pickPipeline);pass.setBindGroup(0,this.globalGroup);for(const c of [...this.plan.main.slice(1),...this.plan.transparent])this.draw(pass,c,false);pass.end();
   read=this.device.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});const px=M.clamp(Math.floor(x*this.canvas.width/this.camera.width),0,this.canvas.width-1),py=M.clamp(Math.floor(y*this.canvas.height/this.camera.height),0,this.canvas.height-1);encoder.copyTextureToBuffer({texture:this.pickTexture,origin:[px,py]},{buffer:read,bytesPerRow:256},[1,1]);this.device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);const id=new Uint32Array(read.getMappedRange())[0];read.unmap();return this.objectIds[id]||null;
  }finally{read?.destroy();this.pickBusy=false;}
 }
 raycast(x,y,nodeId=null){return raycastScene(this,x,y,nodeId);}
 pickLine(x,y){let best=null;for(const e of this.entries||[]){if(!e.visible||!e.node.mesh)continue;const mesh=this.project.meshes[e.node.mesh];if(mesh.faces.length)continue;for(const edge of mesh.edges||[]){if(edge.hidden)continue;const a=M.transform(e.matrix,mesh.vertices[edge.a]),b=M.transform(e.matrix,mesh.vertices[edge.b]),pa=this.camera.project(a),pb=this.camera.project(b);if(!pa||!pb)continue;const dx=pb[0]-pa[0],dy=pb[1]-pa[1],t=M.clamp(((x-pa[0])*dx+(y-pa[1])*dy)/(dx*dx+dy*dy||1),0,1),distance=Math.hypot(x-pa[0]-dx*t,y-pa[1]-dy*t);if(distance<7&&(!best||distance<best.distance)){const point=M.lerp(a,b,t);if(!this.isClipped(point))best={node:e.node,entry:e,point,distance};}}}return best;}
 async screenshot(){if(this.captureFrame)throw Error('A capture is already in progress.');const width=this.canvas.width,height=this.canvas.height,bytesPerRow=align(width*4,256),buffer=this.device.createBuffer({size:bytesPerRow*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});this.captureFrame={buffer,bytesPerRow};try{this.render();this.captureFrame=null;await buffer.mapAsync(GPUMapMode.READ);const mapped=new Uint8Array(buffer.getMappedRange()),pixels=new Uint8ClampedArray(width*height*4),bgra=this.format.startsWith('bgra');for(let y=0;y<height;y++)for(let x=0;x<width;x++){const a=y*bytesPerRow+x*4,b=(y*width+x)*4;pixels[b]=mapped[a+(bgra?2:0)];pixels[b+1]=mapped[a+1];pixels[b+2]=mapped[a+(bgra?0:2)];pixels[b+3]=255;}buffer.unmap();const canvas=new OffscreenCanvas(width,height);canvas.getContext('2d').putImageData(new ImageData(pixels,width,height),0,0);return await canvas.convertToBlob({type:'image/png'});}finally{this.captureFrame=null;buffer.destroy();}}
 dispose(){this.destroyed=true;this.clearGeometryPreview();this.resizeObserver?.disconnect();for(const r of this.cache.values())this.disposeResource(r);for(const r of this.materialCache.values()){r.buffer.destroy();if(r.texture!==this.white)r.texture?.destroy();}for(const t of [this.depth,this.msaa,this.pickTexture,this.pickDepth,this.shadowTexture,this.white])t?.destroy();for(const b of [this.axisBuffer,this.frameBuffer,this.objectBuffer,this.instanceBuffer,this.queryResolve,this.queryRead])b?.destroy();this.querySet?.destroy();this.device?.destroy();}
}
