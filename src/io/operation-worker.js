import {booleanSolid} from '../geometry/csg.js';
self.onmessage=({data})=>{try{self.postMessage({type:'complete',mesh:booleanSolid(data.a,data.b,data.operation,data.options)});}catch(e){self.postMessage({type:'error',message:e.message});}};
