/** Polygon BSP solid operations. Meter-space epsilon; operands must be closed, non-self-intersecting meshes. */
import * as M from '../core/math.js';
import {triangulate} from './triangulate.js';
import {mesh,face,topology,transformMesh} from './mesh.js';
const EPS=1e-6;
class Poly {
 constructor(points,material=null){this.points=points;this.material=material;this.normal=M.norm(M.cross(M.sub(points[1],points[0]),M.sub(points[2],points[0])));this.w=M.dot(this.normal,points[0]);}
 flip(){this.points.reverse();this.normal=M.mul(this.normal,-1);this.w=-this.w;}
 clone(){return new Poly(this.points.map(v=>v.slice()),this.material);}
}
function split(plane,p,coplanarFront,coplanarBack,front,back){
 const types=p.points.map(v=>{const d=M.dot(plane.normal,v)-plane.w;return d<-EPS?2:d>EPS?1:0;}),type=types.reduce((a,b)=>a|b,0);
 if(type===0){(M.dot(plane.normal,p.normal)>0?coplanarFront:coplanarBack).push(p);return;}
 if(type===1){front.push(p);return;}if(type===2){back.push(p);return;}
 const f=[],b=[];
 for(let i=0;i<p.points.length;i++){
  const j=(i+1)%p.points.length,a=p.points[i],z=p.points[j],ta=types[i],tz=types[j];if(ta!==2)f.push(a);if(ta!==1)b.push(a);
  if((ta|tz)===3){const d=M.sub(z,a),t=(plane.w-M.dot(plane.normal,a))/M.dot(plane.normal,d),v=M.add(a,M.mul(d,t));f.push(v);b.push(v);}
 }
 const clean=vs=>vs.filter((v,i)=>M.dist(v,vs[(i+vs.length-1)%vs.length])>EPS*.1);
 const fp=clean(f),bp=clean(b);if(fp.length>=3){const q=new Poly(fp,p.material);if(M.len(q.normal)>.5)front.push(q);}if(bp.length>=3){const q=new Poly(bp,p.material);if(M.len(q.normal)>.5)back.push(q);}
}
class BSP {
 constructor(polys=[],depth=0){this.polys=[];this.front=null;this.back=null;this.plane=null;if(polys.length)this.build(polys,depth);}
 build(polys,depth=0){if(!polys.length)return;if(depth>256)throw Error('Boolean BSP exceeded its depth limit. Simplify or split the operands.');if(!this.plane){const p=polys[(polys.length/2)|0];this.plane={normal:p.normal.slice(),w:p.w};}const front=[],back=[];for(const p of polys)split(this.plane,p,this.polys,this.polys,front,back);if(front.length){this.front??=new BSP();this.front.build(front,depth+1);}if(back.length){this.back??=new BSP();this.back.build(back,depth+1);}}
 invert(){for(const p of this.polys)p.flip();if(this.plane){this.plane.normal=M.mul(this.plane.normal,-1);this.plane.w=-this.plane.w;}this.front?.invert();this.back?.invert();[this.front,this.back]=[this.back,this.front];}
 clipPolys(polys){if(!this.plane)return polys.slice();let f=[],b=[];for(const p of polys)split(this.plane,p,f,b,f,b);if(this.front)f=this.front.clipPolys(f);b=this.back?this.back.clipPolys(b):[];return f.concat(b);}
 clipTo(other){this.polys=other.clipPolys(this.polys);this.front?.clipTo(other);this.back?.clipTo(other);}
 all(){return this.polys.concat(this.front?.all()||[],this.back?.all()||[]);}
}
function polygons(m,fallback=0){const out=[];let volume=0;for(const f of m.faces){const ids=triangulate(m.vertices,f.loops,f.normal);for(let i=0;i<ids.length;i+=3){const points=ids.slice(i,i+3).map(j=>m.vertices[j].slice());volume+=M.dot(points[0],M.cross(points[1],points[2]))/6;const p=new Poly(points,f.material??fallback);if(M.len(p.normal)>.5)out.push(p);}}if(volume<0)for(const p of out)p.flip();return out;}
function toMesh(polys,name){
 const vertices=[],ids=new Map(),faces=[];const key=v=>v.map(x=>Math.round(x/EPS)).join(',');
 for(const p of polys){const loop=p.points.map(v=>{const k=key(v);let i=ids.get(k);if(i===undefined){i=vertices.length;vertices.push(v);ids.set(k,i);}return i;}).filter((v,i,a)=>v!==a[(i+a.length-1)%a.length]);if(new Set(loop).size>=3)faces.push(face([loop],p.material));}
 // Stitch BSP-created T junctions so each adjacent polygon shares the same edge segments.
 // Bounded quadratic pass is intentional: boolean operands are capped below.
 if(vertices.length<=12000){for(const f of faces){const loop=f.loops[0],stitched=[];for(let i=0;i<loop.length;i++){const a=loop[i],b=loop[(i+1)%loop.length],va=vertices[a],d=M.sub(vertices[b],va),length2=M.dot(d,d),between=[];stitched.push(a);if(length2<EPS*EPS)continue;for(let j=0;j<vertices.length;j++){if(j===a||j===b)continue;const t=M.dot(M.sub(vertices[j],va),d)/length2;if(t<=EPS||t>=1-EPS)continue;if(M.dist(M.add(va,M.mul(d,t)),vertices[j])<EPS*.75)between.push([t,j]);}between.sort((a,b)=>a[0]-b[0]);for(const [,j] of between)stitched.push(j);}f.loops=[stitched];}}
 return mesh(vertices,faces,name);
}
export function booleanSolid(a,b,operation='union',options={}){
 if(!['union','subtract','intersect'].includes(operation))throw Error('Unknown boolean operation.');
 if(!topology(a).closed||!topology(b).closed)throw Error('Solid tools require two closed manifold meshes. Inspect boundary edges first.');
 const am=options.aMatrix?transformMesh(a,options.aMatrix):a,bm=options.bMatrix?transformMesh(b,options.bMatrix):b,ap=polygons(am,options.aMaterial),bp=polygons(bm,options.bMaterial);
 if(ap.length+bp.length>16000)throw Error('Interactive solid tools are limited to 16,000 input triangles. Use smaller operands.');
 const A=new BSP(ap),B=new BSP(bp);
 if(operation==='union'){A.clipTo(B);B.clipTo(A);B.invert();B.clipTo(A);B.invert();A.build(B.all());}
 if(operation==='subtract'){A.invert();A.clipTo(B);B.clipTo(A);B.invert();B.clipTo(A);B.invert();A.build(B.all());A.invert();}
 if(operation==='intersect'){A.invert();B.clipTo(A);B.invert();A.clipTo(B);B.clipTo(A);A.build(B.all());A.invert();}
 const result=toMesh(A.all(),{union:'Union',subtract:'Difference',intersect:'Intersection'}[operation]);
 if(!result.faces.length)throw Error('The boolean result is empty. The operands may not overlap.');return result;
}
