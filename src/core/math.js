/** Float64 modeling math; matrices are column-major, points are meters, Y is up. */
export const EPS=1e-8;
export const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
export const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
export const mul=(a,k)=>[a[0]*k,a[1]*k,a[2]*k];
export const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const len=a=>Math.hypot(...a);
export const norm=a=>mul(a,1/(len(a)||1));
export const dist=(a,b)=>len(sub(a,b));
export const lerp=(a,b,t)=>add(a,mul(sub(b,a),t));
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
export function mmul(a,b){const c=new Array(16).fill(0);for(let j=0;j<4;j++)for(let i=0;i<4;i++)for(let k=0;k<4;k++)c[j*4+i]+=a[k*4+i]*b[j*4+k];return c;}
export const translation=(v)=>[1,0,0,0,0,1,0,0,0,0,1,0,v[0],v[1],v[2],1];
export const scaling=(v)=>[v[0],0,0,0,0,v[1],0,0,0,0,v[2],0,0,0,0,1];
export function rotation(axis,angle){const [x,y,z]=norm(axis),c=Math.cos(angle),s=Math.sin(angle),t=1-c;return [t*x*x+c,t*x*y+s*z,t*x*z-s*y,0,t*x*y-s*z,t*y*y+c,t*y*z+s*x,0,t*x*z+s*y,t*y*z-s*x,t*z*z+c,0,0,0,0,1];}
export function quaternion(q){const [x,y,z,w]=q;return [1-2*(y*y+z*z),2*(x*y+z*w),2*(x*z-y*w),0,2*(x*y-z*w),1-2*(x*x+z*z),2*(y*z+x*w),0,2*(x*z+y*w),2*(y*z-x*w),1-2*(x*x+y*y),0,0,0,0,1];}
export function transform(m,p,w=1){const x=m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12]*w,y=m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13]*w,z=m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]*w,ww=m[3]*p[0]+m[7]*p[1]+m[11]*p[2]+m[15]*w;return w&&Math.abs(ww)>EPS?[x/ww,y/ww,z/ww]:[x,y,z];}
export function transpose(a){return [a[0],a[4],a[8],a[12],a[1],a[5],a[9],a[13],a[2],a[6],a[10],a[14],a[3],a[7],a[11],a[15]];}
export function inverse(a){
 const m=a.slice(),b=identity();
 for(let i=0;i<4;i++){
  let pivot=i;for(let j=i+1;j<4;j++)if(Math.abs(m[i*4+j])>Math.abs(m[i*4+pivot]))pivot=j;
  if(Math.abs(m[i*4+pivot])<1e-14)throw Error('Singular transform: a scale axis cannot be zero.');
  if(pivot!==i)for(let k=0;k<4;k++){[m[k*4+i],m[k*4+pivot]]=[m[k*4+pivot],m[k*4+i]];[b[k*4+i],b[k*4+pivot]]=[b[k*4+pivot],b[k*4+i]];}
  const d=m[i*4+i];for(let k=0;k<4;k++){m[k*4+i]/=d;b[k*4+i]/=d;}
  for(let j=0;j<4;j++){if(j===i)continue;const f=m[i*4+j];for(let k=0;k<4;k++){m[k*4+j]-=f*m[k*4+i];b[k*4+j]-=f*b[k*4+i];}}
 }
 return b;
}
export function lookAt(eye,target,up=[0,1,0]){const z=norm(sub(eye,target));let x=norm(cross(up,z));if(len(x)<EPS)x=[1,0,0];const y=cross(z,x);return [x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1];}
/** WebGPU right-handed, clip depth 0..1. */
export function perspective(fovy,aspect,near,far){const f=1/Math.tan(fovy/2);return [f/aspect,0,0,0,0,f,0,0,0,0,far/(near-far),-1,0,0,near*far/(near-far),0];}
export function ortho(l,r,b,t,n,f){return [2/(r-l),0,0,0,0,2/(t-b),0,0,0,0,1/(n-f),0,-(r+l)/(r-l),-(t+b)/(t-b),n/(n-f),1];}
export function bounds(points){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const p of points)for(let i=0;i<3;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}return {min,max};}
export const emptyBounds=()=>({min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]});
export function extendBounds(b,p){for(let i=0;i<3;i++){b.min[i]=Math.min(b.min[i],p[i]);b.max[i]=Math.max(b.max[i],p[i]);}return b;}
export function corners(b){return Array.from({length:8},(_,i)=>[i&1?b.max[0]:b.min[0],i&2?b.max[1]:b.min[1],i&4?b.max[2]:b.min[2]]);}
export function boundsWorld(b,m){return bounds(corners(b).map(p=>transform(m,p)));}
export const center=b=>mul(add(b.min,b.max),.5);
export const extent=b=>sub(b.max,b.min);
export function rayPlane(ray,point,normal){const d=dot(ray.direction,normal);if(Math.abs(d)<1e-9)return null;const t=dot(sub(point,ray.origin),normal)/d;return t>=0?add(ray.origin,mul(ray.direction,t)):null;}
export function rayBox(ray,b){let lo=0,hi=Infinity;for(let i=0;i<3;i++){if(Math.abs(ray.direction[i])<1e-14){if(ray.origin[i]<b.min[i]||ray.origin[i]>b.max[i])return null;continue;}let a=(b.min[i]-ray.origin[i])/ray.direction[i],z=(b.max[i]-ray.origin[i])/ray.direction[i];if(a>z)[a,z]=[z,a];lo=Math.max(lo,a);hi=Math.min(hi,z);if(hi<lo)return null;}return lo;}
export function rayTriangle(ray,a,b,c){const e1=sub(b,a),e2=sub(c,a),h=cross(ray.direction,e2),det=dot(e1,h);if(Math.abs(det)<1e-12)return null;const f=1/det,s=sub(ray.origin,a),u=f*dot(s,h);if(u<0||u>1)return null;const q=cross(s,e1),v=f*dot(ray.direction,q);if(v<0||u+v>1)return null;const t=f*dot(e2,q);return t>1e-7?{t,u,v,point:add(ray.origin,mul(ray.direction,t))}:null;}
export function planeBasis(n){const normal=norm(n),u=norm(cross(Math.abs(normal[1])<.9?[0,1,0]:[0,0,1],normal));return {u,v:cross(normal,u),normal};}
export function faceNormal(points){let n=[0,0,0];for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];n[0]+=(a[1]-b[1])*(a[2]+b[2]);n[1]+=(a[2]-b[2])*(a[0]+b[0]);n[2]+=(a[0]-b[0])*(a[1]+b[1]);}return norm(n);}
export function frustumPlanes(m){const rows=[0,1,2,3].map(i=>[m[i],m[i+4],m[i+8],m[i+12]]),r=rows[3];return [[0,1],[0,-1],[1,1],[1,-1],[2,-1]].map(([i,s])=>r.map((v,k)=>v+s*rows[i][k])).concat([rows[2]]).map(p=>{const d=Math.hypot(p[0],p[1],p[2]);return p.map(v=>v/d);});}
export const visibleSphere=(planes,c,r)=>planes.every(p=>p[0]*c[0]+p[1]*c[1]+p[2]*c[2]+p[3]>=-r);
export function parseLength(text,units='m'){
 const s=String(text).trim().toLowerCase();
 const feet=s.match(/^(-?\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in)?)?$/);
 if(feet)return Number(feet[1])*.3048+Math.sign(Number(feet[1])||1)*Number(feet[2]||0)*.0254;
 const m=s.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(mm|cm|m|in|ft|"|')?$/);
 if(!m)throw Error('Enter a length such as 2.4m, 2400mm, 8ft, or 5\' 6".');
 const factors={mm:.001,cm:.01,m:1,in:.0254,ft:.3048,'"':.0254,"'":.3048};const v=Number(m[1])*factors[m[2]||units];if(!Number.isFinite(v))throw Error('Length must be finite.');return v;
}
export function formatLength(m,units='m',digits=3){const f={mm:1000,cm:100,m:1,in:1/.0254,ft:1/.3048}[units]||1;return `${(m*f).toLocaleString('en-US',{maximumFractionDigits:digits,useGrouping:false})} ${units}`;}
export const uid=(prefix='o')=>prefix+'_'+(globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2));
