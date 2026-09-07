/** Polygon triangulation with holes. No fan fallback: degenerate faces are reported. */
import {faceNormal,planeBasis,dot,sub} from '../core/math.js';
const area2=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const same=(a,b)=>Math.abs(a.x-b.x)<1e-10&&Math.abs(a.y-b.y)<1e-10;
const area=p=>p.reduce((s,a,i)=>s+a.x*p[(i+1)%p.length].y-p[(i+1)%p.length].x*a.y,0)/2;
function clean(p){p=p.filter((a,i)=>!same(a,p[(i+p.length-1)%p.length]));return p;}
function inside(p,q){let yes=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const a=p[i],b=p[j];if((a.y>q.y)!==(b.y>q.y)&&q.x<(b.x-a.x)*(q.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;}
function intersects(a,b,c,d){if(same(a,c)||same(a,d)||same(b,c)||same(b,d))return false;const ab1=area2(a,b,c),ab2=area2(a,b,d),cd1=area2(c,d,a),cd2=area2(c,d,b);return ab1*ab2<-1e-18&&cd1*cd2<-1e-18;}
function visible(a,b,outer,holes){for(const ring of [outer,...holes])for(let i=0;i<ring.length;i++)if(intersects(a,b,ring[i],ring[(i+1)%ring.length]))return false;const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};return inside(outer,mid)&&holes.every(h=>!inside(h,mid));}
function bridge(outer,holes){
 const sorted=holes.map(h=>{let i=0;for(let j=1;j<h.length;j++)if(h[j].x<h[i].x)i=j;return {h,i};}).sort((a,b)=>a.h[a.i].x-b.h[b.i].x);
 for(const {h,i} of sorted){const p=h[i];let at=-1,best=Infinity;
  for(let j=0;j<outer.length;j++){const q=outer[j],d=(q.x-p.x)**2+(q.y-p.y)**2;if(d<best&&visible(p,q,outer,holes)){at=j;best=d;}}
  if(at===-1)throw Error('Could not bridge a polygon hole.');
  const around=h.slice(i).concat(h.slice(0,i));outer=outer.slice(0,at+1).concat(around,[p,outer[at]],outer.slice(at+1));
 }
 return outer;
}
function inTriangle(a,b,c,p){return area2(a,b,p)>=-1e-12&&area2(b,c,p)>=-1e-12&&area2(c,a,p)>=-1e-12;}
function clip(poly,depth=0){
 if(depth>12)throw Error('Polygon is self-intersecting or numerically degenerate.');
 const p=poly.slice(),tris=[];let cursor=0,miss=0;
 while(p.length>3){const n=p.length,i=cursor%n,a=p[(i+n-1)%n],b=p[i],c=p[(i+1)%n];const turn=area2(a,b,c);let ear=turn>1e-13;
  if(ear)for(let j=0;j<n;j++){const q=p[j];if(same(q,a)||same(q,b)||same(q,c))continue;if(inTriangle(a,b,c,q)){ear=false;break;}}
  if(ear){tris.push(a.i,b.i,c.i);p.splice(i,1);cursor=Math.max(0,i-1);miss=0;continue;}
  if(Math.abs(turn)<1e-13&&!same(a,c)){p.splice(i,1);miss=0;continue;}
  cursor++;miss++;
  if(miss>p.length*2){
   // Split on a visible interior diagonal, rather than inventing triangles.
   for(let s=0;s<p.length;s++)for(let t=s+2;t<p.length;t++){
    if(s===0&&t===p.length-1)continue;const a=p[s],b=p[t];if(same(a,b))continue;
    if(!visible(a,b,p,[]))continue;
    const left=p.slice(s,t+1),right=p.slice(t).concat(p.slice(0,s+1));
    if(Math.abs(area(left))<1e-14||Math.abs(area(right))<1e-14)continue;
    try{return tris.concat(clip(left,depth+1),clip(right,depth+1));}catch{}
   }
   throw Error('Polygon triangulation failed; check for crossing edges.');
  }
 }
 if(p.length===3&&Math.abs(area2(...p))>1e-14)tris.push(p[0].i,p[1].i,p[2].i);
 return tris;
}
export function triangulate(vertices,loops,normal=null){
 if(!loops.length||loops[0].length<3)return [];
 normal=normal||faceNormal(loops[0].map(i=>vertices[i]));
 const basis=planeBasis(normal),origin=vertices[loops[0][0]];
 let rings=loops.map(loop=>clean(loop.map(i=>{const d=sub(vertices[i],origin);return {i,x:dot(d,basis.u),y:dot(d,basis.v)};}))).filter(r=>r.length>=3);
 if(!rings.length)return [];
 // VFF model can store the outer loop in a non-first position.
 rings.sort((a,b)=>Math.abs(area(b))-Math.abs(area(a)));
 if(area(rings[0])<0)rings[0].reverse();for(let i=1;i<rings.length;i++)if(area(rings[i])>0)rings[i].reverse();
 const outer=rings.length>1?bridge(rings[0],rings.slice(1)):rings[0];
 return clip(outer);
}
export function polygonArea(vertices,loops){const normal=faceNormal(loops[0].map(i=>vertices[i])),b=planeBasis(normal);return loops.reduce((sum,l,i)=>{const r=l.map(k=>({x:dot(vertices[k],b.u),y:dot(vertices[k],b.v)}));return sum+(i===0?1:-1)*Math.abs(area(r));},0);}
