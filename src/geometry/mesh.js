import * as M from '../core/math.js';
import {triangulate,polygonArea} from './triangulate.js';
export const face=(loops,material=null,extra={})=>({id:M.uid('f'),loops,material,...extra});
export function mesh(vertices=[],faces=[],name='Mesh'){return {id:M.uid('m'),name,vertices,faces,edges:[],revision:0};}
export function cloneMesh(m){return {...m,vertices:m.vertices.map(v=>v.slice()),faces:m.faces.map(f=>({...f,loops:f.loops.map(l=>l.slice()),uv:f.uv?structuredClone(f.uv):undefined})),edges:m.edges?.map(e=>({...e})),revision:(m.revision||0)+1};}
export function box(w=2,h=2,d=2){const v=[[0,0,0],[w,0,0],[w,0,d],[0,0,d],[0,h,0],[w,h,0],[w,h,d],[0,h,d]];return mesh(v,[[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]].map(l=>face([l])),'Box');}
export function rectangle(a,b,basis={u:[1,0,0],v:[0,0,-1]}){const delta=M.sub(b,a),u=M.mul(basis.u,M.dot(delta,basis.u)),v=M.mul(basis.v,M.dot(delta,basis.v));return mesh([a,M.add(a,u),M.add(M.add(a,u),v),M.add(a,v)],[face([[0,1,2,3]])],'Rectangle');}
export function circle(center,radius,segments=48,normal=[0,1,0]){if(radius<=1e-7)throw Error('Radius must be positive.');segments=M.clamp(Math.round(segments),3,256);const {u,v}=M.planeBasis(normal),vs=Array.from({length:segments},(_,i)=>M.add(center,M.add(M.mul(u,radius*Math.cos(i*Math.PI*2/segments)),M.mul(v,radius*Math.sin(i*Math.PI*2/segments)))));return mesh(vs,[face([vs.map((_,i)=>i)])],'Circle');}
export function sphere(radius=1,segments=32,rings=16){const vs=[[0,radius,0]],fs=[];for(let j=1;j<rings;j++)for(let i=0;i<segments;i++){const phi=j*Math.PI/rings,theta=i*2*Math.PI/segments;vs.push([radius*Math.sin(phi)*Math.cos(theta),radius*Math.cos(phi),radius*Math.sin(phi)*Math.sin(theta)]);}const bottom=vs.push([0,-radius,0])-1;for(let i=0;i<segments;i++)fs.push(face([[0,1+(i+1)%segments,1+i]]));for(let j=0;j<rings-2;j++)for(let i=0;i<segments;i++){const a=1+j*segments+i,b=1+j*segments+(i+1)%segments;fs.push(face([[a,b,b+segments,a+segments]]));}for(let i=0;i<segments;i++)fs.push(face([[bottom,1+(rings-2)*segments+i,1+(rings-2)*segments+(i+1)%segments]]));const m=mesh(vs,fs,'Sphere');m.smooth=true;return m;}
export function polygon(points,normal=null){if(points.length<3)throw Error('A face needs at least three vertices.');const n=normal||M.faceNormal(points);if(M.len(n)<1e-8)throw Error('These points are collinear.');if(points.some(p=>Math.abs(M.dot(M.sub(p,points[0]),n))>1e-5))throw Error('Polygon points must lie on one plane.');const m=mesh(points.map(p=>p.slice()),[face([points.map((_,i)=>i)],null,{normal:n})],'Polygon');triangulate(m.vertices,m.faces[0].loops,n);return m;}
/** Topological push/pull. Shared boundary remains welded to adjacent faces. */
export function extrudeFace(input,faceId,distance){
 if(!Number.isFinite(distance)||Math.abs(distance)<1e-8)throw Error('Enter a nonzero extrusion distance.');
 const m=cloneMesh(input),idx=m.faces.findIndex(f=>f.id===faceId);if(idx<0)throw Error('Select a face first.');
 const f=m.faces[idx],n=f.normal||M.faceNormal(f.loops[0].map(i=>m.vertices[i])),map=new Map();
 for(const l of f.loops)for(const i of l)if(!map.has(i)){map.set(i,m.vertices.length);m.vertices.push(M.add(m.vertices[i],M.mul(n,distance)));}
 const usedElsewhere=new Set(m.faces.filter(x=>x!==f).flatMap(x=>x.loops.flat()));
 const standalone=f.loops.flat().every(i=>!usedElsewhere.has(i));
 // Moving a complete cap inward shortens its perpendicular walls, rather than
 // adding overlapping coplanar side walls inside the existing solid.
 if(!standalone&&distance<0){const boundary=new Set(f.loops.flat()),adjacent=m.faces.filter(other=>other!==f&&other.loops.some(l=>l.some(i=>boundary.has(i))));
  if(adjacent.length&&adjacent.every(other=>Math.abs(M.dot(other.normal||M.faceNormal(other.loops[0].map(i=>m.vertices[i])),n))<1e-6)){
   const moved=cloneMesh(input);for(const i of boundary)moved.vertices[i]=M.add(moved.vertices[i],M.mul(n,distance));
   for(const other of moved.faces){const points=other.loops[0].map(i=>moved.vertices[i]),nn=M.faceNormal(points),old=input.faces.find(x=>x.id===other.id),on=old.normal||M.faceNormal(old.loops[0].map(i=>input.vertices[i]));
    if(M.len(nn)<.5||M.dot(nn,on)<.01)throw Error('Push/pull would collapse or invert the solid. Use a smaller distance or Solid Difference.');
    if(other.loops.flat().some(i=>Math.abs(M.dot(M.sub(moved.vertices[i],points[0]),nn))>1e-5))throw Error('This push/pull would make an adjacent face nonplanar.');
    other.normal=nn;other.cornerNormals=undefined;}
   moved.edges=[];return moved;
  }
 }
 const top={...f,loops:f.loops.map(l=>l.map(i=>map.get(i))),normal:n,uv:undefined,cornerNormals:undefined};
 m.faces.splice(idx,1,top);
 if(standalone)m.faces.push(face(f.loops.map(l=>l.slice().reverse()),f.material));
 for(const l of f.loops)for(let j=0;j<l.length;j++){const a=l[j],b=l[(j+1)%l.length];m.faces.push(face([[a,b,map.get(b),map.get(a)]],f.material));}
 if(standalone&&distance<0)for(const side of m.faces){side.loops=side.loops.map(l=>l.slice().reverse());if(side.normal)side.normal=M.mul(side.normal,-1);side.cornerNormals=undefined;}
 m.edges=[];return m;
}
/** Inset one planar face; builds a center face and an annular face with a hole. */
export function offsetFace(input,faceId,distance){
 if(!Number.isFinite(distance)||distance<=1e-8)throw Error('Enter a positive inset distance.');
 const m=cloneMesh(input),f=m.faces.find(f=>f.id===faceId);if(!f)throw Error('Select a face first.');if(f.loops.length!==1)throw Error('Offset currently requires a single-boundary face.');
 const loop=f.loops[0],pts=loop.map(i=>m.vertices[i]),n=f.normal||M.faceNormal(pts),{u,v}=M.planeBasis(n),origin=pts[0],p=pts.map(x=>[M.dot(M.sub(x,origin),u),M.dot(M.sub(x,origin),v)]);let signed=p.reduce((s,a,i)=>s+a[0]*p[(i+1)%p.length][1]-p[(i+1)%p.length][0]*a[1],0);const sign=Math.sign(signed);
 const inset=[];
 for(let i=0;i<p.length;i++){
  const prev=p[(i+p.length-1)%p.length],cur=p[i],next=p[(i+1)%p.length],a=[cur[0]-prev[0],cur[1]-prev[1]],b=[next[0]-cur[0],next[1]-cur[1]],la=Math.hypot(...a),lb=Math.hypot(...b);if(la<1e-9||lb<1e-9)throw Error('Degenerate face edge.');
  const n1=[-a[1]/la*sign,a[0]/la*sign],n2=[-b[1]/lb*sign,b[0]/lb*sign],bis=[n1[0]+n2[0],n1[1]+n2[1]],den=bis[0]*n1[0]+bis[1]*n1[1];if(Math.abs(den)<1e-9)throw Error('Offset is undefined at a folded corner.');
  const q=[cur[0]+bis[0]*distance/den,cur[1]+bis[1]*distance/den];inset.push(m.vertices.length);m.vertices.push(M.add(origin,M.add(M.mul(u,q[0]),M.mul(v,q[1]))));
 }
 for(const i of inset){const q=[M.dot(M.sub(m.vertices[i],origin),u),M.dot(M.sub(m.vertices[i],origin),v)];for(let j=0;j<p.length;j++){const a=p[j],b=p[(j+1)%p.length],dx=b[0]-a[0],dy=b[1]-a[1],t=M.clamp(((q[0]-a[0])*dx+(q[1]-a[1])*dy)/(dx*dx+dy*dy),0,1);if(Math.hypot(q[0]-a[0]-t*dx,q[1]-a[1]-t*dy)<distance-1e-6)throw Error('Inset exceeds the available face width or crosses another edge.');}}
 const newLoop=face([inset],f.material);triangulate(m.vertices,newLoop.loops,n);
 f.loops=[loop,inset.slice().reverse()];f.uv=undefined;m.faces.push(newLoop);m.edges=[];return m;
}
export function sweep(profile,path){
 if(profile.length<3||path.length<2)throw Error('Sweep needs a closed profile and a path with at least two points.');
 const verts=[],faces=[];let prevU=null;
 for(let i=0;i<path.length;i++){const t=M.norm(M.sub(path[Math.min(i+1,path.length-1)],path[Math.max(0,i-1)]));let {u,v}=M.planeBasis(t);if(prevU&&M.dot(prevU,u)<0){u=M.mul(u,-1);v=M.mul(v,-1);}prevU=u;for(const p of profile)verts.push(M.add(path[i],M.add(M.mul(u,p[0]),M.mul(v,p[1]))));}
 const n=profile.length;faces.push(face([Array.from({length:n},(_,i)=>n-1-i)]));faces.push(face([Array.from({length:n},(_,i)=>(path.length-1)*n+i)]));
 for(let j=0;j<path.length-1;j++)for(let i=0;i<n;i++)faces.push(face([[j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i]]));return mesh(verts,faces,'Sweep');
}
export function transformMesh(input,matrix){const m=cloneMesh(input);m.vertices=m.vertices.map(p=>M.transform(matrix,p));for(const f of m.faces){f.normal=undefined;f.cornerNormals=undefined;}return m;}
export function weld(input,tolerance=1e-6){const m=cloneMesh(input),map=new Map(),remap=[],vs=[];for(const v of m.vertices){const key=v.map(x=>Math.round(x/tolerance)).join(',');let idx=map.get(key);if(idx===undefined){idx=vs.length;vs.push(v);map.set(key,idx);}remap.push(idx);}m.vertices=vs;for(const f of m.faces)f.loops=f.loops.map(l=>l.map(i=>remap[i]).filter((v,i,a)=>v!==a[(i+a.length-1)%a.length]));m.faces=m.faces.filter(f=>f.loops[0].length>=3);m.edges=[];return m;}
export function topology(m){
 const edgeMap=new Map();let area=0,volume=0,triangles=0,degenerate=0;
 for(const f of m.faces){for(const l of f.loops)for(let i=0;i<l.length;i++){const a=l[i],b=l[(i+1)%l.length],key=a<b?`${a}:${b}`:`${b}:${a}`,e=edgeMap.get(key)||{a,b,uses:[]};e.uses.push(f.id);edgeMap.set(key,e);}
  try{area+=polygonArea(m.vertices,f.loops);const t=triangulate(m.vertices,f.loops,f.normal);triangles+=t.length/3;for(let i=0;i<t.length;i+=3)volume+=M.dot(m.vertices[t[i]],M.cross(m.vertices[t[i+1]],m.vertices[t[i+2]]))/6;}catch{degenerate++;}
 }
 const edges=[...edgeMap.values()],boundary=edges.filter(e=>e.uses.length===1).length,nonmanifold=edges.filter(e=>e.uses.length>2).length;
 return {vertices:m.vertices.length,faces:m.faces.length,edges:edges.length,triangles,boundary,nonmanifold,degenerate,area,volume:Math.abs(volume),closed:boundary===0&&nonmanifold===0&&degenerate===0&&m.faces.length>0};
}
/** Smooth normals only across explicitly softened source edges, retaining hard corners. */
function sourceCornerNormals(m,normals){
 if(!(m.edges||[]).some(e=>e.smooth))return null;
 const adjacency=new Map(),soft=new Set(m.edges.filter(e=>e.smooth).map(e=>e.a<e.b?`${e.a}:${e.b}`:`${e.b}:${e.a}`));
 for(let fi=0;fi<m.faces.length;fi++)for(const l of m.faces[fi].loops)for(let i=0;i<l.length;i++){const a=l[i],b=l[(i+1)%l.length],k=a<b?`${a}:${b}`:`${b}:${a}`;if(!soft.has(k))continue;let e=adjacency.get(k);if(!e){e={a,b,faces:[]};adjacency.set(k,e);}e.faces.push(fi);}
 const parents=new Map(),faceIndex=new Map();const root=k=>{if(!parents.has(k)){parents.set(k,k);return k;}let r=k;while(parents.get(r)!==r)r=parents.get(r);while(parents.get(k)!==k){const n=parents.get(k);parents.set(k,r);k=n;}return r;};
 for(const e of adjacency.values())for(const vertex of [e.a,e.b])for(const fi of e.faces){const a=`${vertex}:${e.faces[0]}`,b=`${vertex}:${fi}`;parents.set(root(b),root(a));faceIndex.set(b,fi);}
 const sums=new Map();for(const [key,fi] of faceIndex){const r=root(key);sums.set(r,M.add(sums.get(r)||[0,0,0],normals[fi]));}const result=new Map();for(const key of faceIndex.keys())result.set(key,M.norm(sums.get(root(key))));return result;
}
/** Bake indexed GPU attributes grouped by material, retaining triangle -> source face mapping. */
export function bakeMesh(m){
 const groups=new Map(),errors=[],edges=new Map(),smoothNormals=m.smooth?m.vertices.map(()=>[0,0,0]):null;
 const normals=m.faces.map(f=>f.normal||M.faceNormal(f.loops[0].map(i=>m.vertices[i]))),sourceNormals=sourceCornerNormals(m,normals);
 if(smoothNormals)for(let fi=0;fi<m.faces.length;fi++)for(const i of m.faces[fi].loops.flat())smoothNormals[i]=M.add(smoothNormals[i],normals[fi]);
 if(smoothNormals)for(let i=0;i<smoothNormals.length;i++)smoothNormals[i]=M.norm(smoothNormals[i]);
 const triangles=[];
 for(let fi=0;fi<m.faces.length;fi++){
  const f=m.faces[fi];if(f.hidden)continue;const normal=normals[fi];let ids;
  try{ids=triangulate(m.vertices,f.loops,normal);}catch(e){errors.push({face:fi,message:e.message});continue;}
  const key=`${f.material??-1}:${f.tag||'0'}`;let g=groups.get(key);if(!g){g={material:f.material??-1,tag:f.tag||'0',vertices:[],indices:[],faceIds:[]};groups.set(key,g);}
  const basis=M.planeBasis(normal),uvMap=new Map(),normalMap=new Map();if(f.cornerNormals)for(let li=0;li<f.loops.length;li++)for(let j=0;j<f.loops[li].length;j++)normalMap.set(f.loops[li][j],f.cornerNormals[li]?.[j]);if(f.uv)for(let li=0;li<f.loops.length;li++)for(let j=0;j<f.loops[li].length;j++)uvMap.set(f.loops[li][j],f.uv[li]?.[j]);
  const local=new Map();
  for(const idx of ids){let v=local.get(idx);if(v===undefined){v=g.vertices.length/8;local.set(idx,v);const p=m.vertices[idx],n=normalMap.get(idx)||sourceNormals?.get(`${idx}:${fi}`)||(smoothNormals?smoothNormals[idx]:normal),uv=uvMap.get(idx)||[M.dot(p,basis.u),M.dot(p,basis.v)];g.vertices.push(...p,...n,...uv);}g.indices.push(v);}
  for(let i=0;i<ids.length;i+=3){g.faceIds.push(fi);triangles.push({a:ids[i],b:ids[i+1],c:ids[i+2],face:fi});}
  for(const l of f.loops)for(let i=0;i<l.length;i++){const a=l[i],b=l[(i+1)%l.length],key=a<b?`${a}:${b}`:`${b}:${a}`;let edge=edges.get(key);if(!edge){edge={a,b,normals:[]};edges.set(key,edge);}edge.normals.push(normal);}
 }
 const explicit=new Map((m.edges||[]).map(e=>[e.a<e.b?`${e.a}:${e.b}`:`${e.b}:${e.a}`,e]));
 for(const e of m.edges||[])if(!edges.has(e.a<e.b?`${e.a}:${e.b}`:`${e.b}:${e.a}`))edges.set(e.a<e.b?`${e.a}:${e.b}`:`${e.b}:${e.a}`,{...e,normals:[]});
 const lines=[],wire=[];
 for(const [key,e] of edges){const a=m.vertices[e.a],b=m.vertices[e.b];if(!a||!b)continue;wire.push(...a,...b);const flag=explicit.get(key);if(flag?.hidden||flag?.smooth||m.smooth)continue;if(e.normals.length!==2||M.dot(e.normals[0],e.normals[1])<.9995)lines.push(...a,...b);}
 return {groups:[...groups.values()].map(g=>({...g,vertices:new Float32Array(g.vertices),indices:new Uint32Array(g.indices)})),lines:new Float32Array(lines),wire:new Float32Array(wire),bounds:M.bounds(m.vertices),triangles,errors};
}
