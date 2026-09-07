/** Modern SKP/VFF reader, informed by the independent MIT-licensed binary-format research.
 * No proprietary SDK, network upload, or thumbnail-as-geometry substitution.
 * This is a separately implemented, deliberately bounded 2021+ reader.
 * See THIRD_PARTY_NOTICES.md and docs/COMPATIBILITY.md for its fidelity limits.
 */
import {unzip} from '../io/zip.js';
import * as M from '../core/math.js';
import {newProject,makeNode,makeMaterial} from '../core/document.js';
const CONTAINERS=new Set('F401 F701 D430 D530 C832 7C15 8813 8913 8A13 8B13 8C13 8D13 4C1D 6419 F901 7017 7117 D007 C409 9411 9511 0F01 384A B80B 9713 2C4C AC0D AE0D F601 F801 983A 993A 8C3C 8D3C 9013 401F'.split(' '));
const td=new TextDecoder();
const int=b=>{let n=0;for(let i=0;i<b.length;i++)n+=b[i]*256**i;if(!Number.isSafeInteger(n))throw Error('Entity ID exceeds safe integer range.');return n;};
const text=n=>n?td.decode(n.data).replace(/\0/g,'').trim():'';
const f64=(b,n=3)=>{if(b.length<n*8)return null;const v=new DataView(b.buffer,b.byteOffset,b.byteLength);return Array.from({length:n},(_,i)=>v.getFloat64(i*8,true));};
function tlv(b,start=0,end=b.length,depth=0,containers=CONTAINERS){
 if(depth>96)throw Error('SKP hierarchy exceeds the parser depth limit.');const v=new DataView(b.buffer,b.byteOffset,b.byteLength),out=[];
 for(let p=start;p+6<=end;){const tag=b[p].toString(16).padStart(2,'0').toUpperCase()+b[p+1].toString(16).padStart(2,'0').toUpperCase(),size=v.getUint32(p+2,true),stop=p+6+size;if(stop>end)throw Error(`Invalid SKP TLV length at ${p}.`);const data=b.subarray(p+6,stop);let children=[];if(containers.has(tag)&&size>=6){try{children=tlv(b,p+6,stop,depth+1,containers);}catch(e){if(tag!=='8D3C')throw e;}}
  out.push({tag,data,children,offset:p});p=stop;
 }
 return out;
}
function find(nodes,tag){for(const n of nodes){if(n.tag===tag)return n;const found=find(n.children,tag);if(found)return found;}return null;}
function all(nodes,tag,out=[]){for(const n of nodes){if(n.tag===tag)out.push(n);else all(n.children,tag,out);}return out;}
const direct=(n,t)=>n.children.find(c=>c.tag===t);
function eid(n){const node=direct(n,'DE05')||direct(n,'DC05');if(node){if(node.tag==='DE05')return int(node.data);if(node.data[0]===0xde&&node.data[1]===0x05){const inner=tlv(node.data,0,node.data.length,0,new Set());return int(inner[0].data);}return int(node.data);}for(const c of n.children){const id=eid(c);if(id!==null)return id;}return null;}
const val=n=>n?int(n.data):null;
function props(n){const d=direct(n,'D007');return {material:val(d&&direct(d,'D107')),tag:val(d&&direct(d,'D207')),flags:val(d&&direct(d,'D307'))||0,meta:d&&direct(d,'DC05')};}
function uvMatrix(meta,side){if(!meta)return null;let data=meta.data;for(const tag of ['DD05','B136','B236','1027',side,'1327','1527']){let n;try{n=tlv(data,0,data.length,0,new Set()).find(n=>n.tag===tag);}catch{return null;}if(!n)return null;data=n.data;}return data.length===72?f64(data,9):null;}
const CONVERT=[.0254,0,0,0,0,0,-.0254,0,0,.0254,0,0,0,0,0,1],UNCONVERT=M.inverse(CONVERT);
const point=p=>[p[0]*.0254,p[2]*.0254,-p[1]*.0254];
const normal=p=>[p[0],p[2],-p[1]];
function transform13(f){if(!f||f.length<12)return M.identity();const raw=[f[0],f[3],f[6],0,f[1],f[4],f[7],0,f[2],f[5],f[8],0,f[9],f[10],f[11],1];return M.mmul(CONVERT,M.mmul(raw,UNCONVERT));}
const xmlDecode=s=>s.replace(/&(amp|quot|apos|lt|gt|#x[\da-f]+|#\d+);/gi,(_,x)=>({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'}[x]||(x.startsWith('#x')?String.fromCodePoint(parseInt(x.slice(2),16)):String.fromCodePoint(Number(x.slice(1))))));
function attrs(s){return Object.fromEntries([...s.matchAll(/([\w:]+)="([^"]*)"/g)].map(m=>[m[1],xmlDecode(m[2])]));}
function inv3(a){const [A,B,C,D,E,F,G,H,I]=a,d=A*(E*I-F*H)-B*(D*I-F*G)+C*(D*H-E*G);return Math.abs(d)<1e-18?null:[E*I-F*H,C*H-B*I,B*F-C*E,F*G-D*I,A*I-C*G,C*D-A*F,D*H-E*G,B*G-A*H,A*E-B*D].map(x=>x/d);}
function getUv(p,n,mat,uvm){
 const z=[0,0,1];let xr=M.norm(M.cross(z,n));if(M.len(xr)<1e-8)xr=[1,0,0];const yr=M.cross(n,xr);let u=M.dot(p,xr),v=M.dot(p,yr);
 if(uvm){const qx=u*uvm[0]+v*uvm[3]+uvm[6],qy=u*uvm[1]+v*uvm[4]+uvm[7],qw=u*uvm[2]+v*uvm[5]+uvm[8];if(Math.abs(qw)>1e-10){u=qx/qw;v=qy/qw;}}
 return [u/(mat?.tileW||39.3700787402),v/(mat?.tileH||39.3700787402)];
}
export async function importSkp(buffer,name='VFF model model',progress=()=>{}){
 const started=performance.now(),bytes=new Uint8Array(buffer);
 if(bytes.length<60||bytes[0]!==255||bytes[1]!==254||bytes[2]!==255||bytes[3]!==14)throw Error('Not a VFF model file: header signature is invalid.');
 const header=new TextDecoder('utf-16le').decode(bytes.subarray(0,Math.min(120,bytes.length))),version=header.match(/\{([^}]+)\}/)?.[1]||'unknown';
 const hasPK=bytes.subarray(0,512).some((v,i,a)=>v===80&&a[i+1]===75&&a[i+2]===3&&a[i+3]===4);
 if(!hasPK)throw Error('This is a pre-2021 (MFC) SKP. This build reads modern VFF SKP only. Open and re-save in VFF model 2021+ or export GLB/OBJ.');
 progress({stage:'Unpacking VFF model archive',value:.02});
 const files=await unzip(bytes,{onProgress:p=>progress({stage:'Reading embedded assets',value:.03+p*.17})});
 const data=files.get('model.dat');if(!data)throw Error('VFF model archive has no model.dat geometry.');
 const project=newProject(name.replace(/\.skp$/i,'')),materialByName=new Map(),materialIds=new Map(),layerIds=new Map([[1,'Untagged']]),definitions=new Map(),warnings=[];
 const report={file:name,version,bytes:bytes.length,geometryBytes:data.length,definitions:0,instances:0,sourceFaces:0,sourceVertices:0,hiddenFaces:0,unresolvedInstances:0,invalidFaces:0,warnings};
 for(const [path,raw] of files){if(!/^materials\/.+\/material\.xml$/i.test(path))continue;const xml=td.decode(raw),a=attrs(xml.match(/<(?:mat:)?material\s[^>]+>/)?.[0]||'');if(!a.name)continue;const textureTag=attrs(xml.match(/<(?:mat:)?texture\s[^>]+>/)?.[0]||'');const mat=makeMaterial(a.name,[Number(a.colorRed||0)/255,Number(a.colorGreen||0)/255,Number(a.colorBlue||0)/255,a.useTrans==='1'?1-Number(a.trans||0):1]);
  mat.tileW=Number(textureTag.xScale)||1;mat.tileH=Number(textureTag.yScale)||1;
  if(a.hasTexture==='1'){
   const base=path.slice(0,path.lastIndexOf('/')+1),filename=textureTag.textureFilename||attrs(xml.match(/<(?:mat:)?image\s[^>]+>/)?.[0]||'').file_name;
   let image=files.get(base+filename),imagePath=base+filename;
   if(!image){const found=[...files.entries()].find(([key])=>key.startsWith(base)&&/\.(jpg|jpeg|png|webp)$/i.test(key)&&!key.endsWith('thumbnail.jpg'));if(found){imagePath=found[0];image=found[1];}}
   if(!image){const found=[...files.entries()].find(([key])=>key.endsWith('/'+filename));if(found){imagePath=found[0];image=found[1];}}
   if(image){mat.texture={bytes:image,mime:/\.png$/i.test(imagePath)?'image/png':/\.webp$/i.test(imagePath)?'image/webp':'image/jpeg',name:imagePath.split('/').pop(),flipY:true};mat.color=[1,1,1,mat.color[3]];}
   else warnings.push('Missing embedded texture: '+a.name);
  }
  const idx=project.materials.length;project.materials.push(mat);materialByName.set(a.name,idx);materialByName.set(path.split('/')[1],idx);
 }
 progress({stage:'Parsing face topology and components',value:.22});
 let nodes=tlv(data);if(nodes.length===1&&nodes[0].tag==='F401')nodes=nodes[0].children;
 for(const n of all(nodes,'C832')){const id=eid(n),label=text(find(n.children,'CC32'));if(id!==null&&label)materialIds.set(id,materialByName.get(label)??0);}
 for(const n of all(nodes,'8C3C')){const id=eid(n),label=text(find(n.children,'8D3C'));if(id!==null&&label)layerIds.set(id,label==='Layer0'?'Untagged':label);}
 project.tags=[...layerIds].map(([id,name])=>({id:id===1?'0':String(id),name,visible:true,color:'#94a6a0'}));
 function readGeometry(nodes,label,id){
  const verts=new Map(),edges=new Map(),faces=[],instances=[];
  function walk(list){for(const n of list){
   if(n.tag==='C409'){const coords=find(n.children,'C509'),id=eid(n);if(id!==null&&coords){const p=f64(coords.data);if(p?.every(Number.isFinite))verts.set(id,p);}}
   else if(n.tag==='B80B'){const id=eid(n);if(id!==null)edges.set(id,{a:val(find(n.children,'B90B')),b:val(find(n.children,'BA0B')),flags:props(n).flags});}
   else if(n.tag==='AC0D'){
    const normalNode=find(n.children,'AD0D'),rawNormal=normalNode?f64(normalNode.data):[0,0,1],pr=props(n),loops=[];
    for(const l of all(n.children,'9411')){const coedges=[];for(const c of all(l.children,'A00F')){const subnodes=tlv(c.data,0,c.data.length,0,new Set()),edge=val(subnodes.find(n=>n.tag==='A10F')),reverse=val(subnodes.find(n=>n.tag==='A20F'));if(edge!==null)coedges.push({edge,reverse});}if(coedges.length)loops.push(coedges);}
    faces.push({id:eid(n),loops,normal:rawNormal,material:pr.material,backMaterial:val(direct(n,'AF0D')),hidden:!!(pr.flags&1),tag:pr.tag,uv:uvMatrix(pr.meta,'1127')});
   }else if(n.tag==='6419'){
    const pr=props(n);instances.push({name:text(find(n.children,'6519')),ref:val(find(n.children,'6719')),matrix:transform13(f64(find(n.children,'6619')?.data||new Uint8Array(),13)),material:pr.material,tag:pr.tag,hidden:!!(pr.flags&1)});
   }else if(n.tag!=='7C15'&&n.children.length)walk(n.children);
  }}
  walk(nodes);return {id,name:label,verts,edges,faces,instances};
 }
 const defnodes=all(nodes,'7C15');
 for(let i=0;i<defnodes.length;i++){const n=defnodes[i],id=eid(n);if(id===null)continue;definitions.set(id,readGeometry(n.children,text(direct(n,'7E15'))||'Component '+id,id));if(i%20===0)progress({stage:'Resolving component definitions',value:.3+.3*i/defnodes.length});}
 const rootNode=nodes.find(n=>n.tag==='F601');if(!rootNode)throw Error('SKP has no root geometry container.');definitions.set('ROOT',readGeometry(rootNode.children,'Model geometry','ROOT'));
 for(const [key,d] of definitions){
  const rawVerts=[...d.verts.values()],index=new Map([...d.verts.keys()].map((id,i)=>[id,i])),vertices=rawVerts.map(point),outFaces=[];
  report.sourceVertices+=vertices.length;report.sourceFaces+=d.faces.length;
  for(const f of d.faces){
   const loops=f.loops.map(l=>l.map(c=>{const e=d.edges.get(c.edge);return e?index.get(c.reverse===0?e.a:e.b):undefined;}).filter((v,i,a)=>v!==a[(i+a.length-1)%a.length])).filter(l=>l.length>=3);
   if(!loops.length||loops.some(l=>l.some(i=>i===undefined))){report.invalidFaces++;continue;}
   const material=materialIds.get(f.material)??(f.material===null?null:0),backMaterial=materialIds.get(f.backMaterial)??null,mat=project.materials[material??backMaterial??0],uvm=f.uv?inv3(f.uv):null;
   const uv=loops.map(l=>l.map(i=>getUv(rawVerts[i],f.normal,mat,uvm)));
   outFaces.push({id:`skpf_${key}_${f.id}`,loops,normal:normal(f.normal),material:material??backMaterial,backMaterial,hidden:f.hidden,tag:f.tag===1||f.tag===null?'0':String(f.tag),uv});
   if(f.hidden)report.hiddenFaces++;
  }
  const meshId='skpm_'+key;
  project.meshes[meshId]={id:meshId,name:d.name,vertices,faces:outFaces,edges:[...d.edges.values()].filter(e=>index.has(e.a)&&index.has(e.b)).map(e=>({a:index.get(e.a),b:index.get(e.b),hidden:!!(e.flags&1),smooth:!!(e.flags&24)})),revision:0};d.meshId=meshId;
 }
 const root=definitions.get('ROOT'),rootGroup=makeNode(project.name,null,{id:'skp-root',tag:'0'});project.nodes.push(rootGroup);
 if(root.verts.size)project.nodes.push(makeNode('Model geometry',root.meshId,{parent:rootGroup.id}));
 const visit=(d,parent,ancestors=new Set(),inheritedTag='0')=>{
  if(ancestors.size>96)throw Error('VFF model instance hierarchy is too deep.');
  for(const inst of d.instances){
   const def=definitions.get(inst.ref);if(!def){report.unresolvedInstances++;continue;}
   if(ancestors.has(inst.ref)){warnings.push('Recursive component '+def.name+' was not expanded.');continue;}
   const tag=inst.tag&&inst.tag!==1?String(inst.tag):inheritedTag;
   const node=makeNode(inst.name||def.name,def.verts.size?def.meshId:null,{parent,matrix:inst.matrix,material:materialIds.get(inst.material)??null,tag,visible:!inst.hidden,component:String(inst.ref)});
   project.nodes.push(node);report.instances++;if(project.nodes.length>250000)throw Error('SKP instance expansion exceeds 250,000 nodes.');
   visit(def,node.id,new Set([...ancestors,inst.ref]),tag);
  }
 };
 visit(root,rootGroup.id);
 report.definitions=definitions.size-1;report.materials=project.materials.length-1;report.textures=project.materials.filter(m=>m.texture).length;report.layers=project.tags.length;report.parseMs=Math.round(performance.now()-started);
 if(report.invalidFaces)warnings.push(`${report.invalidFaces} invalid face loops were not imported.`);
 if(report.unresolvedInstances)warnings.push(`${report.unresolvedInstances} component references could not be resolved.`);
 warnings.push('Modern SKP tag visibility defaults to visible. Saved scenes, dimensions, dynamic-component behavior, projected textures and extension-specific data are not reconstructed by this reader.');
 project.source={type:'skp',report,thumbnail:files.get('meta/model_thumbnail.png')||null};
 progress({stage:'VFF model geometry ready',value:1});return project;
}
