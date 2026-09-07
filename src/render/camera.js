import * as M from '../core/math.js';
export class Camera{
 constructor(){this.target=[0,1,0];this.distance=18;this.yaw=.75;this.pitch=.62;this.fov=45*Math.PI/180;this.orthographic=false;this.aspect=1;this.near=.01;this.far=10000;this.width=1;this.height=1;}
 get eye(){return M.add(this.target,M.mul([Math.sin(this.yaw)*Math.cos(this.pitch),Math.sin(this.pitch),Math.cos(this.yaw)*Math.cos(this.pitch)],this.distance));}
 get direction(){return M.norm(M.sub(this.target,this.eye));}
 get up(){if(this.freeUp)return this.freeUp;return Math.abs(this.pitch)>1.56?[0,0,this.pitch>0?-1:1]:[0,1,0];}
 get origin(){return this.target.map(v=>Math.round(v/100)*100);}
 matrices(origin=this.origin){const height=this.distance*Math.tan(this.fov/2)*2,view=M.lookAt(M.sub(this.eye,origin),M.sub(this.target,origin),this.up),proj=this.orthographic?M.ortho(-height*this.aspect/2,height*this.aspect/2,-height/2,height/2,this.near,this.far):M.perspective(this.fov,this.aspect,this.near,this.far);return {view,projection:proj,vp:M.mmul(proj,view)};}
 ray(x,y){const ndc=[x/this.width*2-1,1-y/this.height*2],inv=M.inverse(this.matrices([0,0,0]).vp),a=M.transform(inv,[...ndc,0]),b=M.transform(inv,[...ndc,1]);return {origin:this.orthographic?a:this.eye,direction:M.norm(M.sub(b,a))};}
 project(p){const matrix=this.matrices([0,0,0]).vp,w=matrix[3]*p[0]+matrix[7]*p[1]+matrix[11]*p[2]+matrix[15];if(w<=0)return null;const v=M.transform(matrix,p);if(v[2]<0||v[2]>1)return null;return [(v[0]+1)*this.width/2,(1-v[1])*this.height/2,v[2]];}
 orbit(dx,dy,free=false){if(free){const offset=M.sub(this.eye,this.target),right=M.norm(M.cross(this.direction,this.up)),up=M.norm(M.cross(right,this.direction)),rot=M.mmul(M.rotation(up,-dx*.007),M.rotation(right,dy*.006)),next=M.transform(rot,offset,0);this.freeUp=M.norm(M.transform(rot,up,0));this.yaw=Math.atan2(next[0],next[2]);this.pitch=Math.asin(M.clamp(next[1]/this.distance,-1,1));return;}this.freeUp=null;this.yaw-=dx*.007;this.pitch=M.clamp(this.pitch+dy*.006,-1.55,1.55);}
 pan(dx,dy){const dir=this.direction,right=M.norm(M.cross(dir,this.up)),up=M.norm(M.cross(right,dir)),scale=this.distance*Math.tan(this.fov/2)*2/this.height;this.target=M.add(this.target,M.add(M.mul(right,-dx*scale),M.mul(up,dy*scale)));}
 zoom(delta){this.distance=M.clamp(this.distance*Math.exp(delta*.001),.025,1e8);this.near=Math.max(.0005,this.distance/10000);this.far=Math.max(1000,this.distance*1000);}
 zoomAt(delta,x,y,anchor=null){const normal=this.direction,point=anchor||this.target,before=M.rayPlane(this.ray(x,y),point,normal);this.zoom(delta);const after=M.rayPlane(this.ray(x,y),point,normal);if(before&&after)this.target=M.add(this.target,M.sub(before,after));}
 changeFov(dy){this.fov=M.clamp(this.fov+dy*.003,5*Math.PI/180,120*Math.PI/180);}
 recenter(point){this.target=point.slice();}
 fit(bounds){this.target=M.center(bounds);const e=M.extent(bounds),r=M.len(e)*.5;this.distance=Math.max(.2,r/Math.sin(this.fov/2)*1.1/Math.min(1,this.aspect));this.near=Math.max(.001,this.distance/10000);this.far=Math.max(1000,this.distance*1000);}
 preset(name){this.freeUp=null;if(name==='iso'){this.yaw=.72;this.pitch=.65;this.orthographic=false;}else{this.orthographic=true;const views={top:[0,Math.PI/2],bottom:[0,-Math.PI/2],front:[0,0],back:[Math.PI,0],right:[Math.PI/2,0],left:[-Math.PI/2,0]};if(views[name])[this.yaw,this.pitch]=views[name];}}
 save(){return {target:this.target.slice(),distance:this.distance,yaw:this.yaw,pitch:this.pitch,fov:this.fov,orthographic:this.orthographic,freeUp:this.freeUp?.slice()||null};}
 restore(state){for(const k of ['target','distance','yaw','pitch','fov','orthographic','freeUp'])if(state[k]!==undefined)this[k]=Array.isArray(state[k])?state[k].slice():state[k];this.near=Math.max(.001,this.distance/10000);this.far=Math.max(1000,this.distance*1000);}
}
