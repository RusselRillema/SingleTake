import * as M from '../core/math.js';
import {mesh,face} from '../geometry/mesh.js';
import {newProject,makeNode,makeMaterial,parseProject} from '../core/document.js';
import {importSkp} from './skp.js';
const td=new TextDecoder();
const nameBase=n=>n.replace(/\.[^.]+$/,'');
const mime=n=>/\.png$/i.test(n)?'image/png':/\.webp$/i.test(n)?'image/webp':'image/jpeg';
function resource(files,uri){
 if(uri.startsWith('data:')){const [head,data]=uri.split(',');if(!data)throw Error('Malformed data URI.');return head.includes(';base64')?Uint8Array.from(atob(data),c=>c.charCodeAt(0)):new TextEncoder().encode(decodeURIComponent(data));}
 if(/^[a-z]+:\/\//i.test(uri))throw Error('Remote asset references are not fetched. Select all model buffers and textures with the file.');
 const clean=decodeURIComponent(uri).replace(/\\/g,'/').replace(/^\.\//,'');const found=files.find(f=>f.name===clean||f.name.split('/').pop()===clean.split('/').pop());if(!found)throw Error(`Missing companion file: ${clean}. Select it together with the model.`);return new Uint8Array(found.buffer);
}
function imported(p,type,name,extra={}){p.source={type,report:{file:name,...extra,warnings:extra.warnings||[]}};return p;}
export function importOBJ(files,name,scale=1){
 const file=files.find(f=>f.name===name),p=newProject(nameBase(name)),v=[],uv=[],vn=[],materials=new Map();
 for(const f of files.filter(f=>/\.mtl$/i.test(f.name))){let mat=null;for(const line of td.decode(f.buffer).split(/\r?\n/)){const parts=line.trim().split(/\s+/),key=parts.shift();if(key==='newmtl'){mat=makeMaterial(parts.join(' '));materials.set(mat.name,p.materials.length);p.materials.push(mat);}else if(mat&&key==='Kd')mat.color=[...parts.slice(0,3).map(Number),mat.color[3]];else if(mat&&(key==='d'||key==='Tr'))mat.color[3]=key==='Tr'?1-Number(parts[0]):Number(parts[0]);else if(mat&&key==='Ns')mat.roughness=Math.sqrt(2/(Number(parts[0])+2));else if(mat&&key==='map_Kd'){const uri=parts.join(' ');try{mat.texture={bytes:resource(files,uri),mime:mime(uri),name:uri,flipY:true};mat.color=[1,1,1,mat.color[3]];}catch{p.sourceMissing=p.sourceMissing||[];p.sourceMissing.push(uri);}}}}
 let group=mesh([],[],'Mesh'),mat=null;const groups=[];
 function finish(){if(group.faces.length||group.edges.length)groups.push(group);group=mesh([],[],'Mesh');}
 const idx=(s,a)=>{const n=Number(s);return n<0?a.length+n:n-1;};
 for(const line of td.decode(file.buffer).split(/\r?\n/)){
  const parts=line.trim().split(/\s+/),key=parts.shift();if(!key||key.startsWith('#'))continue;
  if(key==='v'){const pos=parts.slice(0,3).map(Number);if(pos.length!==3||!pos.every(Number.isFinite))throw Error('Invalid OBJ vertex.');v.push(pos.map(x=>x*scale));}
  else if(key==='vt')uv.push(parts.slice(0,2).map(Number));else if(key==='vn')vn.push(parts.slice(0,3).map(Number));
  else if(key==='o'||key==='g'){finish();group.name=parts.join(' ')||'Object';}
  else if(key==='usemtl')mat=materials.get(parts.join(' '))??null;
  else if(key==='f'){
   const ids=[],tex=[],normals=[];
   for(const token of parts){const [a,b,c]=token.split('/'),vi=idx(a,v);if(vi<0||vi>=v.length)throw Error('OBJ face index out of range.');ids.push(vi);tex.push(b?uv[idx(b,uv)]||[0,0]:[0,0]);normals.push(c?vn[idx(c,vn)]:null);}
   if(ids.length>=3)group.faces.push(face([ids],mat,{uv:[tex],cornerNormals:normals.every(Boolean)?[normals]:undefined}));
  }else if(key==='l'){const ids=parts.map(t=>idx(t.split('/')[0],v));for(let i=0;i<ids.length-1;i++)group.edges.push({a:ids[i],b:ids[i+1]});}
 }
 finish();for(const g of groups){const used=[...new Set([...g.faces.flatMap(f=>f.loops.flat()),...g.edges.flatMap(e=>[e.a,e.b])])],map=new Map(used.map((x,i)=>[x,i]));g.vertices=used.map(i=>v[i]);for(const f of g.faces)f.loops=f.loops.map(l=>l.map(i=>map.get(i)));for(const e of g.edges){e.a=map.get(e.a);e.b=map.get(e.b);}p.meshes[g.id]=g;p.nodes.push(makeNode(g.name,g.id));}
 if(!p.nodes.length)throw Error('OBJ contains no supported faces or lines.');
 return imported(p,'obj',name,{vertices:v.length,objects:p.nodes.length,warnings:(p.sourceMissing||[]).map(t=>'Missing texture '+t)});
}
export function importSTL(buffer,name,scale=1){
 const bytes=new Uint8Array(buffer),view=new DataView(buffer),m=mesh([],[],nameBase(name)),verts=new Map();
 const vertex=p=>{const key=p.join(',');if(verts.has(key))return verts.get(key);const i=m.vertices.length;verts.set(key,i);m.vertices.push(p.map(v=>v*scale));return i;};
 const count=bytes.length>=84?view.getUint32(80,true):0,binary=bytes.length>=84&&84+count*50===bytes.length;
 if(binary){if(count>3000000)throw Error('STL exceeds the 3 million triangle limit.');for(let i=0;i<count;i++){const ids=[],offset=84+i*50;for(let j=0;j<3;j++){const p=Array.from({length:3},(_,k)=>view.getFloat32(offset+12+j*12+k*4,true));if(!p.every(Number.isFinite))throw Error('Invalid STL coordinate.');ids.push(vertex(p));}m.faces.push(face([ids]));}}
 else{const values=[...td.decode(buffer).matchAll(/vertex\s+([\-+.\deE]+)\s+([\-+.\deE]+)\s+([\-+.\deE]+)/g)].map(x=>x.slice(1).map(Number));if(!values.length||values.length%3)throw Error('Invalid ASCII STL.');for(let i=0;i<values.length;i+=3)m.faces.push(face([[vertex(values[i]),vertex(values[i+1]),vertex(values[i+2])]]));}
 const p=newProject(nameBase(name));p.meshes[m.id]=m;p.nodes.push(makeNode(m.name,m.id));return imported(p,'stl',name,{triangles:m.faces.length,scale});
}
export function importPLY(buffer,name,scale=1){
 const bytes=new Uint8Array(buffer),headEnd=td.decode(bytes.subarray(0,Math.min(bytes.length,65536))).indexOf('end_header');if(headEnd<0)throw Error('PLY header is missing.');let start=headEnd+10;if(bytes[start]===13)start++;if(bytes[start]===10)start++;const lines=td.decode(bytes.subarray(0,start)).split(/\r?\n/),elements=[];let format='ascii',current=null;
 for(const l of lines){const t=l.trim().split(/\s+/);if(t[0]==='format')format=t[1];if(t[0]==='element'){current={name:t[1],count:Number(t[2]),props:[]};if(current.count>10000000)throw Error('PLY element count exceeds the safety limit.');elements.push(current);}if(t[0]==='property'&&current)current.props.push(t[1]==='list'?{list:true,countType:t[2],type:t[3],name:t[4]}:{type:t[1],name:t[2]});}
 const sizes={char:1,int8:1,uchar:1,uint8:1,short:2,int16:2,ushort:2,uint16:2,int:4,int32:4,uint:4,uint32:4,float:4,float32:4,double:8,float64:8},methods={char:'getInt8',int8:'getInt8',uchar:'getUint8',uint8:'getUint8',short:'getInt16',int16:'getInt16',ushort:'getUint16',uint16:'getUint16',int:'getInt32',int32:'getInt32',uint:'getUint32',uint32:'getUint32',float:'getFloat32',float32:'getFloat32',double:'getFloat64',float64:'getFloat64'};
 const tokens=format==='ascii'?td.decode(bytes.subarray(start)).trim().split(/\s+/):null,dv=new DataView(buffer);let at=start,ti=0;const read=type=>{if(tokens){const n=Number(tokens[ti++]);if(!Number.isFinite(n))throw Error('Invalid PLY number.');return n;}if(!sizes[type]||at+sizes[type]>bytes.length)throw Error('Truncated PLY.');const v=dv[methods[type]](at,format!=='binary_big_endian');at+=sizes[type];return v;};
 const m=mesh([],[],nameBase(name)),colors=[],p=newProject(nameBase(name));
 for(const e of elements)for(let i=0;i<e.count;i++){const values={};for(const pr of e.props){if(pr.list){const count=read(pr.countType);if(count<0||count>100000)throw Error('Invalid PLY list size.');values[pr.name]=Array.from({length:count},()=>read(pr.type));}else values[pr.name]=read(pr.type);}if(e.name==='vertex'){m.vertices.push([values.x,values.y,values.z].map(v=>v*scale));colors.push(values.red!==undefined?[values.red/255,values.green/255,values.blue/255]:null);}if(e.name==='face'){const ids=values.vertex_indices||values.vertex_index;if(ids?.length>=3)m.faces.push(face([ids]));}}
 const colorMap=new Map();for(const f of m.faces){if(f.loops[0].some(i=>!m.vertices[i]))throw Error('PLY face index out of range.');const cs=f.loops[0].map(i=>colors[i]);if(cs.every(Boolean)){const col=[0,1,2].map(k=>cs.reduce((s,c)=>s+c[k],0)/cs.length),key=col.map(v=>Math.round(v*31)).join(',');if(!colorMap.has(key)&&colorMap.size<1024){colorMap.set(key,p.materials.length);p.materials.push(makeMaterial('Vertex color '+colorMap.size,[...col,1]));}f.material=colorMap.get(key)??null;}}
 p.meshes[m.id]=m;p.nodes.push(makeNode(m.name,m.id));return imported(p,'ply',name,{vertices:m.vertices.length,faces:m.faces.length,warnings:colors.some(Boolean)?['PLY vertex colors are averaged per face.']:[]});
}
export function importDXF(buffer,name,scale=1){
 const lines=td.decode(buffer).replace(/\r/g,'').split('\n'),records=[];let current=null;for(let i=0;i+1<lines.length;i+=2){const code=Number(lines[i].trim()),value=lines[i+1].trim();if(code===0){current={type:value,pairs:[]};records.push(current);}else current?.pairs.push([code,value]);}
 const p=newProject(nameBase(name)),groups=new Map(),get=(r,c,d=0)=>Number(r.pairs.find(x=>x[0]===c)?.[1]??d),str=(r,c,d='')=>r.pairs.find(x=>x[0]===c)?.[1]??d,toPoint=(x,y,z)=>[x*scale,z*scale,-y*scale];
 for(let ri=0;ri<records.length;ri++){const r=records[ri];if(!['3DFACE','LINE','LWPOLYLINE','POLYLINE'].includes(r.type))continue;const layer=str(r,8,'0');let m=groups.get(layer);if(!m){m=mesh([],[],layer==='0'?'DXF geometry':layer);groups.set(layer,m);}let vertices=[],closed=false;
  if(r.type==='3DFACE'){vertices=Array.from({length:4},(_,j)=>toPoint(get(r,10+j),get(r,20+j),get(r,30+j)));if(M.dist(vertices[2],vertices[3])<1e-8)vertices.pop();closed=true;}
  if(r.type==='LINE')vertices=[toPoint(get(r,10),get(r,20),get(r,30)),toPoint(get(r,11),get(r,21),get(r,31))];
  if(r.type==='LWPOLYLINE'){let x=null;for(const [c,v] of r.pairs){if(c===10)x=Number(v);if(c===20&&x!==null){vertices.push(toPoint(x,Number(v),get(r,38)));x=null;}}closed=!!(get(r,70)&1);}
  if(r.type==='POLYLINE'){closed=!!(get(r,70)&1);while(records[ri+1]?.type==='VERTEX'){const v=records[++ri];vertices.push(toPoint(get(v,10),get(v,20),get(v,30)));}}
  const ids=vertices.map(v=>m.vertices.push(v)-1);if(closed&&ids.length>=3)m.faces.push(face([ids]));else for(let i=0;i<ids.length-1;i++)m.edges.push({a:ids[i],b:ids[i+1]});
 }
 for(const [tag,m] of groups){p.tags.push({id:tag,name:tag,visible:true,color:'#a1ad92'});p.meshes[m.id]=m;p.nodes.push(makeNode(m.name,m.id,{tag}));}p.tags=p.tags.filter((t,i,a)=>a.findIndex(x=>x.id===t.id)===i);
 if(!p.nodes.length)throw Error('No supported DXF entities. This reader handles 3DFACE, LINE and straight POLYLINE/LWPOLYLINE entities.');return imported(p,'dxf',name,{objects:p.nodes.length,warnings:['DXF curves, bulges, blocks, dimensions, and ACIS solids are not imported. Unitless coordinates use the chosen import scale.']});
}
export async function importGLTF(files,name){
 const f=files.find(f=>f.name===name),bytes=new Uint8Array(f.buffer),dv=new DataView(f.buffer);let json,binary=null;
 if(bytes.length>=12&&dv.getUint32(0,true)===0x46546c67){if(dv.getUint32(4,true)!==2)throw Error('Only glTF 2.0 is supported.');if(dv.getUint32(8,true)!==bytes.length)throw Error('GLB length does not match its header.');for(let at=12;at+8<=bytes.length;){const size=dv.getUint32(at,true),type=dv.getUint32(at+4,true);if(at+8+size>bytes.length)throw Error('Truncated GLB chunk.');const b=bytes.subarray(at+8,at+8+size);if(type===0x4e4f534a)json=JSON.parse(td.decode(b).replace(/\0+$/,''));if(type===0x004e4942)binary=b;at+=8+size;}}
 else json=JSON.parse(td.decode(f.buffer));
 if(!json?.asset?.version?.startsWith('2'))throw Error('Only glTF 2.0 is supported.');
 const required=json.extensionsRequired||[];const unsupported=required;if(unsupported.length)throw Error('Required glTF extensions are not supported: '+unsupported.join(', ')+'. Export uncompressed glTF/GLB.');
 const buffers=(json.buffers||[]).map(b=>b.uri?resource(files,b.uri):binary);for(let i=0;i<buffers.length;i++)if(!buffers[i]||buffers[i].length<json.buffers[i].byteLength)throw Error('Missing or truncated glTF buffer.');
 const components={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16,MAT3:9,MAT2:4},types={5120:[1,'getInt8'],5121:[1,'getUint8'],5122:[2,'getInt16'],5123:[2,'getUint16'],5125:[4,'getUint32'],5126:[4,'getFloat32']};
 const readView=(vi,off,type,count,componentCount,strideOverride)=>{const view=json.bufferViews[vi];if(!view)throw Error('Missing glTF buffer view.');const [size,method]=types[type]||[];if(!size)throw Error('Unsupported glTF component type.');const buf=buffers[view.buffer],dv=new DataView(buf.buffer,buf.byteOffset,buf.byteLength),stride=strideOverride||view.byteStride||size*componentCount,base=(view.byteOffset||0)+(off||0);if(base+(count-1)*stride+size*componentCount>buf.byteLength)throw Error('glTF accessor exceeds its buffer.');return Array.from({length:count},(_,i)=>Array.from({length:componentCount},(_,j)=>dv[method](base+i*stride+j*size,true)));};
 function accessor(index){const a=json.accessors[index];if(!a||a.count>10000000)throw Error('Invalid or excessively large glTF accessor.');const n=components[a.type];if(!n)throw Error('Unsupported glTF accessor type.');let values=a.bufferView===undefined?Array.from({length:a.count},()=>new Array(n).fill(0)):readView(a.bufferView,a.byteOffset,a.componentType,a.count,n);
  if(a.sparse){const ids=readView(a.sparse.indices.bufferView,a.sparse.indices.byteOffset,a.sparse.indices.componentType,a.sparse.count,1),val=readView(a.sparse.values.bufferView,a.sparse.values.byteOffset,a.componentType,a.sparse.count,n);for(let i=0;i<ids.length;i++){if(ids[i][0]>=a.count)throw Error('Sparse glTF index out of range.');values[ids[i][0]]=val[i];}}
  if(a.normalized&&a.componentType!==5126){const max={5120:127,5121:255,5122:32767,5123:65535,5125:4294967295}[a.componentType];values=values.map(v=>v.map(x=>Math.max(-1,x/max)));}return values;
 }
 const p=newProject(nameBase(name));p.materials=[];
 for(const m of json.materials||[]){const pb=m.pbrMetallicRoughness||{},mat=makeMaterial(m.name||'Material '+p.materials.length,(pb.baseColorFactor||[1,1,1,1]).map((v,i)=>i===3?v:v<=.0031308?v*12.92:1.055*Math.pow(v,1/2.4)-.055),{roughness:pb.roughnessFactor??1,metalness:pb.metallicFactor??1});if(m.alphaMode==='OPAQUE'||!m.alphaMode)mat.color[3]=1;
  if(pb.baseColorTexture){const tex=json.textures?.[pb.baseColorTexture.index],image=json.images?.[tex?.source];if(image){let data;if(image.uri)data=resource(files,image.uri);else if(image.bufferView!==undefined){const v=json.bufferViews[image.bufferView];data=buffers[v.buffer].slice(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);}if(data)mat.texture={bytes:data,mime:image.mimeType||mime(image.uri||''),name:image.name||'texture',flipY:false};}}
  p.materials.push(mat);
 }
 if(!p.materials.length)p.materials.push(makeMaterial());const meshIds=[];
 for(const [mi,source] of (json.meshes||[]).entries()){const m=mesh([],[],source.name||'Mesh '+mi);for(const pr of source.primitives){if(pr.extensions?.KHR_draco_mesh_compression)throw Error('Draco-compressed geometry is not supported. Export uncompressed GLB.');if(pr.attributes.POSITION===undefined)continue;const v=accessor(pr.attributes.POSITION),n=pr.attributes.NORMAL!==undefined?accessor(pr.attributes.NORMAL):null,uv=pr.attributes.TEXCOORD_0!==undefined?accessor(pr.attributes.TEXCOORD_0):null,index=pr.indices!==undefined?accessor(pr.indices).map(v=>v[0]):v.map((_,i)=>i),base=m.vertices.length;for(const point of v)m.vertices.push(point);const mode=pr.mode??4;let tris=[];
  if(mode===4)tris=index;else if(mode===5)for(let i=0;i<index.length-2;i++)tris.push(index[i+(i%2)],index[i+1-(i%2)],index[i+2]);else if(mode===6)for(let i=1;i<index.length-1;i++)tris.push(index[0],index[i],index[i+1]);else if(mode===1){for(let i=0;i<index.length-1;i+=2)m.edges.push({a:base+index[i],b:base+index[i+1]});continue;}else throw Error(`glTF primitive mode ${mode} is not supported.`);
  for(let i=0;i<tris.length;i+=3){const t=tris.slice(i,i+3);if(t.length!==3||t.some(k=>k<0||k>=v.length))throw Error('Invalid glTF triangle indices.');m.faces.push(face([t.map(k=>base+k)],pr.material??0,{uv:uv?[t.map(k=>uv[k])]:undefined,cornerNormals:n?[t.map(k=>n[k])]:undefined}));}
 }p.meshes[m.id]=m;meshIds.push(m.id);}
 const scene=json.scenes?.[json.scene||0],roots=scene?.nodes||((json.nodes||[]).map((_,i)=>i).filter(i=>!(json.nodes||[]).some(n=>n.children?.includes(i)))),visited=new Set();
 const visit=(index,parent=null,chain=new Set())=>{if(chain.has(index)||chain.size>128)throw Error('Cyclic glTF node hierarchy.');const n=json.nodes?.[index];if(!n)throw Error('Missing glTF node.');if(visited.has(index))return;visited.add(index);const matrix=n.matrix||M.mmul(M.translation(n.translation||[0,0,0]),M.mmul(M.quaternion(n.rotation||[0,0,0,1]),M.scaling(n.scale||[1,1,1]))),node=makeNode(n.name||'Node '+index,n.mesh===undefined?null:meshIds[n.mesh],{parent,matrix});p.nodes.push(node);for(const child of n.children||[])visit(child,node.id,new Set([...chain,index]));};for(const root of roots)visit(root);
 if(!p.nodes.length)for(const id of meshIds)p.nodes.push(makeNode(p.meshes[id].name,id));const warnings=[];if((json.materials||[]).some(m=>m.alphaMode==='MASK'||m.extensions||m.emissiveFactor||m.occlusionTexture||m.pbrMetallicRoughness?.baseColorTexture?.extensions))warnings.push('Alpha masking, emissive/occlusion channels, texture transforms and optional material extensions are approximated or not evaluated.');if(json.animations?.length||json.skins?.length)warnings.push('Animations, morph targets and skin deformation are not evaluated; base meshes are imported.');if((json.materials||[]).some(m=>m.normalTexture||m.pbrMetallicRoughness?.metallicRoughnessTexture))warnings.push('Normal, occlusion and packed metallic/roughness texture maps are not evaluated by this renderer.');
 return imported(p,'gltf',name,{meshes:meshIds.length,nodes:p.nodes.length,materials:p.materials.length,warnings});
}
export async function importFiles(files,name=files[0]?.name,scale=1,progress=()=>{}){
 if(!name)throw Error('No model file selected.');const f=files.find(f=>f.name===name);if(!f)throw Error('Model file not found.');if(f.buffer.byteLength>300*1024*1024)throw Error('Input exceeds the 300 MB safety limit.');const ext=name.split('.').pop().toLowerCase();progress({stage:'Reading '+name,value:.1});let p;
 switch(ext){case 'skp':return importSkp(f.buffer,name,progress);case 'glb':case 'gltf':p=await importGLTF(files,name);break;case 'take':case 'json':p=parseProject(td.decode(f.buffer));break;case 'obj':p=importOBJ(files,name,scale);break;case 'stl':p=importSTL(f.buffer,name,scale);break;case 'ply':p=importPLY(f.buffer,name,scale);break;case 'dxf':p=importDXF(f.buffer,name,scale);break;default:throw Error('Unsupported format. Use SKP 2021+, GLB/glTF 2, OBJ, STL, PLY, DXF or TAKE.');}progress({stage:'Model ready',value:1});return p;
}
