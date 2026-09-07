import * as M from './math.js';
import {validateTags,tagVisible} from './tags.js';
export const makeMaterial=(name='Warm white',color=[.87,.855,.815,1],extra={})=>({id:M.uid('mat'),name,color,roughness:.7,metalness:0,...extra});
export function newProject(name='Untitled model'){return {id:M.uid('project'),format:'SingleTake',version:1,name,units:'m',meshes:{},nodes:[],materials:[makeMaterial()],tags:[{id:'0',name:'Untagged',visible:true,color:'#789087'}],scenes:[],measurements:[],guides:[],section:{enabled:false,axis:'y',value:1.5,flip:false},source:null};}
export const makeNode=(name,mesh=null,extra={})=>({id:M.uid('n'),name,mesh,parent:null,matrix:M.identity(),material:null,tag:'0',visible:true,locked:false,...extra});
function draft(p){return {...p,meshes:{...p.meshes},nodes:p.nodes.map(n=>({...n,matrix:n.matrix.slice()})),materials:p.materials.map(m=>({...m,color:m.color.slice()})),tags:p.tags.map(t=>({...t})),scenes:p.scenes.map(s=>({...s})),measurements:p.measurements.map(m=>({...m})),guides:(p.guides||[]).map(g=>({...g})),section:{...p.section}};}
/** Immutable mesh resources + copy-on-write transactions. Undo does not duplicate the entire imported model. */
export class Document extends EventTarget{
 constructor(){super();this.project=newProject();this.undoStack=[];this.redoStack=[];this.dirty=false;this.revision=0;}
 changed(label='Change'){this.dirty=true;this.revision++;this.dispatchEvent(new CustomEvent('change',{detail:label}));}
 transaction(label,edit){const before=this.project,next=draft(before);edit(next);validateProject(next);this.project=next;this.undoStack.push({label,before,after:next});if(this.undoStack.length>100)this.undoStack.shift();this.redoStack=[];this.changed(label);}
 amendLast(label,edit){const last=this.undoStack.at(-1);if(!last)throw Error('There is no operation to revise.');const next=draft(last.before);edit(next);validateProject(next);last.after=next;last.label=label;this.project=next;this.redoStack=[];this.changed(label);}
 replace(p){validateProject(p);if(!p.id)p={...p,id:M.uid('project')};this.project=p;this.undoStack=[];this.redoStack=[];this.dirty=false;this.revision++;this.dispatchEvent(new CustomEvent('change',{detail:'Open model'}));}
 undo(){const c=this.undoStack.pop();if(!c)return;this.redoStack.push(c);this.project=c.before;this.changed('Undo '+c.label);}
 redo(){const c=this.redoStack.pop();if(!c)return;this.undoStack.push(c);this.project=c.after;this.changed('Redo '+c.label);}
 addMesh(m,name=m.name){let id;this.transaction('Create '+name,p=>{p.meshes[m.id]=m;const n=makeNode(name,m.id);id=n.id;p.nodes.push(n);});return id;}
}
export function validateProject(p){
 if(p?.format!=='SingleTake'||p.version!==1)throw Error('Unsupported SingleTake document version.');
 if(!Array.isArray(p.nodes)||!p.meshes||!Array.isArray(p.materials))throw Error('Malformed model document.');
 if(!Array.isArray(p.tags)||!Array.isArray(p.scenes)||!Array.isArray(p.measurements)||!p.section)throw Error('The document is missing scene metadata.');
 if(!['m','mm','cm','in','ft'].includes(p.units))throw Error('Unsupported document units.');
 if(!p.materials.length||p.materials.length>20000)throw Error('Invalid material count.');
 for(const m of p.materials)if(!Array.isArray(m.color)||m.color.length!==4||m.color.some(x=>!Number.isFinite(x)||x<0||x>1))throw Error('Material colors must be four finite values between zero and one.');
 if(!['x','y','z'].includes(p.section.axis)||!Number.isFinite(p.section.value))throw Error('Invalid section plane.');
 if(p.nodes.length>250000)throw Error('Model exceeds the 250,000-node safety limit.');
 validateTags(p);
 const ids=new Set();for(const n of p.nodes){if(ids.has(n.id))throw Error('Duplicate node IDs.');ids.add(n.id);if(n.matrix?.length!==16||!n.matrix.every(Number.isFinite))throw Error('Invalid transform.');if(n.mesh&&!p.meshes[n.mesh])throw Error('Missing mesh reference.');}
 const byId=new Map(p.nodes.map(n=>[n.id,n]));for(const n of p.nodes){let q=n,depth=0;while(q.parent){q=byId.get(q.parent);if(!q)throw Error('Missing parent node.');if(q===n||++depth>128)throw Error('Cyclic or excessively deep hierarchy.');}}
}
export function sceneEntries(project){
 const byId=new Map(project.nodes.map(n=>[n.id,n])),cached=new Map(),tags=new Map(project.tags.map(t=>[t.id,tagVisible(project,t.id)]));
 function get(n){if(cached.has(n.id))return cached.get(n.id);let parent=n.parent?get(byId.get(n.parent)):null;const out={node:n,matrix:parent?M.mmul(parent.matrix,n.matrix):n.matrix,visible:n.visible!==false&&(parent?.visible??true)&&tags.get(n.tag)!==false,locked:n.locked||parent?.locked||false,tag:n.tag&&n.tag!=='0'?n.tag:parent?.tag||'0',material:n.material??parent?.material??0};cached.set(n.id,out);return out;}
 return project.nodes.map(get);
}
export function projectBounds(p,ids=null){const b=M.emptyBounds();for(const e of sceneEntries(p)){if(!e.visible||!e.node.mesh||(ids&&!ids.has(e.node.id)))continue;const mesh=p.meshes[e.node.mesh];const indices=new Set(mesh.faces.flatMap(f=>f.loops.flat()));for(const edge of mesh.edges||[]){indices.add(edge.a);indices.add(edge.b);}if(!indices.size)continue;const local=M.bounds([...indices].map(i=>mesh.vertices[i]));for(const point of M.corners(local))M.extendBounds(b,M.transform(e.matrix,point));}if(!Number.isFinite(b.min[0]))return {min:[-1,0,-1],max:[1,2,1]};return b;}
export function descendants(p,ids){const set=new Set(ids);let added=true;while(added){added=false;for(const n of p.nodes)if(n.parent&&set.has(n.parent)&&!set.has(n.id)){set.add(n.id);added=true;}}return set;}
export function purge(p){const used=new Set(p.nodes.map(n=>n.mesh));for(const id of Object.keys(p.meshes))if(!used.has(id))delete p.meshes[id];}
export function serializeProject(p){return JSON.stringify(p,(_,v)=>v instanceof Uint8Array?{$bytes:Array.from(v)}:v);}
export function parseProject(text){if(text.length>300*1024*1024)throw Error('Project exceeds 300 MB.');const p=JSON.parse(text,(_,v)=>v?.$bytes?new Uint8Array(v.$bytes):v);validateProject(p);let vertices=0;for(const m of Object.values(p.meshes)){vertices+=m.vertices.length;if(vertices>10000000)throw Error('Project exceeds 10 million vertices.');for(const v of m.vertices)if(v.length!==3||!v.every(Number.isFinite))throw Error('Invalid vertex.');for(const f of m.faces)for(const l of f.loops)for(const i of l)if(!Number.isInteger(i)||i<0||i>=m.vertices.length)throw Error('Face index out of bounds.');}return p;}
