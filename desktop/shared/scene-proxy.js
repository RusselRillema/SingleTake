import * as M from '../../src/core/math.js';
import {sceneEntries} from '../../src/core/document.js';
import {tagVisible} from '../../src/core/tags.js';
import {Camera} from '../../src/render/camera.js';
import {raycastScene} from '../../src/render/picking.js';
import {bakeMesh} from '../../src/geometry/mesh.js';
import {BVH} from '../../src/geometry/bvh.js';
import {toBase64} from './encoding.js';

/** Render-resource identity follows object identity, not revision numbers (Undo can reuse revisions). */
export class SceneProxy extends EventTarget {
 constructor(invalidate=()=>{}){super();this.invalidate=invalidate;this.camera=new Camera();this.cache=new Map();this.identities=new WeakMap();this.imageIdentities=new WeakMap();this.nextResource=0;this.entries=[];this.selected=new Set();this.editingIds=null;this.previews=new Map();this.previewTransform=null;this.sent=new Set();this.sentImages=new Set();this.style=0;this.axes=true;this.grid=true;this.edges=true;this.backEdges=false;this.colorByTag=false;this.serial=0;this.dirty=true;}
 requestRender(){this.dirty=true;this.invalidate();}
 ensureResource(source){let r=this.identities.get(source);if(!r){const baked=bakeMesh(source);if(baked.errors.length)throw Error(`${source.name}: ${baked.errors.length} faces failed triangulation.`);r={...baked,source,key:'mesh-'+(++this.nextResource),bvh:new BVH(source,baked.triangles)};this.identities.set(source,r);}this.cache.set(source.id,r);return r;}
 setProject(project){this.project=project;this.entries=sceneEntries(project);const used=new Set(this.entries.map(e=>e.node.mesh).filter(Boolean));for(const id of used)this.ensureResource(project.meshes[id]);for(const id of this.cache.keys())if(!used.has(id))this.cache.delete(id);this.previews.clear();this.requestRender();}
 resetResources(){this.sent.clear();this.sentImages.clear();this.requestRender();}
 previewGeometry(nodeId,source){const baked=bakeMesh(source);if(baked.errors.length)return;this.previews.set(nodeId,{...baked,source,key:'preview-'+(++this.nextResource)});this.requestRender();}
 clearGeometryPreview(){if(this.previews.size){this.previews.clear();this.requestRender();}}
 isClipped(point){const s=this.project?.section;return !!s?.enabled&&(point[{x:0,y:1,z:2}[s.axis]]-s.value)*(s.flip?-1:1)>1e-6;}
 raycast(x,y,id=null){return raycastScene(this,x,y,id);}
 resize(width,height){this.camera.width=Math.max(1,width);this.camera.height=Math.max(1,height);this.camera.aspect=this.camera.width/this.camera.height;this.requestRender();}
 packet(overlay=[]){if(!this.project)return null;const p=this.project,c=this.camera,origin=c.origin,resources=new Map(),nodes=[],view=c.matrices(origin).vp;
  for(const e of this.entries){if(!e.visible||!e.node.mesh)continue;const r=this.previews.get(e.node.id)||this.cache.get(e.node.mesh);if(!r)continue;let matrix=this.previewTransform?.ids.has(e.node.id)?M.mmul(this.previewTransform.matrix,e.matrix):e.matrix.slice();matrix=matrix.slice();for(let i=0;i<3;i++)matrix[12+i]-=origin[i];if(!visibleBox(r.bounds,M.mmul(view,matrix)))continue;resources.set(r.key,r);nodes.push({id:e.node.id,mesh:r.key,matrix,material:e.material,selected:this.selected.has(e.node.id),dimmed:!!this.editingIds&&!this.editingIds.has(e.node.id),tag:e.tag});}
  const imageMap=new Map(),materials=p.materials.map(m=>{let key=null;if(m.texture?.bytes?.length){key=this.imageIdentities.get(m.texture.bytes);if(!key){key='image-'+(++this.nextResource);this.imageIdentities.set(m.texture.bytes,key);}imageMap.set(key,m.texture.bytes);}return {id:m.id,color:m.color,roughness:m.roughness??.7,metalness:m.metalness??0,texture:key,flipY:!!m.texture?.flipY};});
  const axis={x:0,y:1,z:2}[p.section.axis],plane=[0,0,0,0];if(p.section.enabled){plane[axis]=p.section.flip?-1:1;plane[3]=(origin[axis]-p.section.value)*plane[axis];}
  const live=new Set(resources.keys()),images=new Set(imageMap.keys());for(const key of this.sent)if(!live.has(key))this.sent.delete(key);for(const key of this.sentImages)if(!images.has(key))this.sentImages.delete(key);
  return {schema:1,serial:++this.serial,documentId:p.id,name:p.name,viewProjection:view,eye:M.sub(c.eye,origin),origin,section:plane,cameraDistance:c.distance,width:c.width,height:c.height,style:this.style,axes:this.axes,grid:this.grid,edges:this.edges,backEdges:this.backEdges,colorByTag:this.colorByTag,
   resources:[...resources.values()].filter(r=>!this.sent.has(r.key)).map(r=>({id:r.key,groups:r.groups.map(g=>({vertices:toBase64(g.vertices),indices:toBase64(g.indices),material:g.material,tag:g.tag})),lines:toBase64(r.lines),wire:toBase64(r.wire)})),resourceIds:[...live],
   images:[...imageMap].filter(([id])=>!this.sentImages.has(id)).map(([id,bytes])=>({id,data:toBase64(bytes)})),imageIds:[...images],nodes,materials,tags:p.tags.map(t=>({id:t.id,visible:tagVisible(p,t.id),color:t.color||'#789087'})),overlay};
 }
 acknowledge(packet){for(const r of packet.resources)this.sent.add(r.id);for(const image of packet.images)this.sentImages.add(image.id);}
}
/** Conservative homogeneous AABB frustum test, including near/far depth in the shared 0..1 convention. */
export function visibleBox(bounds,matrix){if(!Number.isFinite(bounds.min[0]))return false;const q=M.corners(bounds).map(p=>[matrix[0]*p[0]+matrix[4]*p[1]+matrix[8]*p[2]+matrix[12],matrix[1]*p[0]+matrix[5]*p[1]+matrix[9]*p[2]+matrix[13],matrix[2]*p[0]+matrix[6]*p[1]+matrix[10]*p[2]+matrix[14],matrix[3]*p[0]+matrix[7]*p[1]+matrix[11]*p[2]+matrix[15]]);return ![p=>p[0]<-p[3],p=>p[0]>p[3],p=>p[1]<-p[3],p=>p[1]>p[3],p=>p[2]<0,p=>p[2]>p[3]].some(outside=>q.every(outside));}
