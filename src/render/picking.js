import * as M from '../core/math.js';
import {tagVisible} from '../core/tags.js';
/** Shared CPU picking for native and browser presenters. */
export function raycastScene(state,x,y,nodeId=null){if(!state.project)return null;const ray=state.camera.ray(x,y);let best=null;const tags=new Map(state.project.tags.map(t=>[t.id,tagVisible(state.project,t.id)]));
  for(const e of state.entries){if(!e.visible||!e.node.mesh||(nodeId&&e.node.id!==nodeId))continue;const r=state.cache.get(e.node.mesh);if(!r)continue;let inverse;try{inverse=M.inverse(e.matrix);}catch{continue;}const localRay={origin:M.transform(inverse,ray.origin),direction:M.transform(inverse,ray.direction,0)};
   const hit=r.bvh.intersect(localRay,h=>{const w=M.transform(e.matrix,h.point);return !state.isClipped(w)&&tags.get(r.source.faces[h.face].tag)!==false;});if(!hit||tags.get(r.source.faces[hit.face].tag)===false)continue;const point=M.transform(e.matrix,hit.point),distance=M.dist(ray.origin,point);if(best&&distance>=best.distance)continue;const f=r.source.faces[hit.face],normal=f.normal||M.faceNormal(f.loops[0].map(i=>r.source.vertices[i]));best={...hit,point,localPoint:hit.point,distance,node:e.node,entry:e,mesh:r.source,normal:M.norm(M.transform(M.transpose(inverse),normal,0)),faceId:f.id};
  }return best;
 }
