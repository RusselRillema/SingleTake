/** Public modeling frame: right-handed, Z-up. GPU frame: right-handed, Y-up. */
export const AXES=Object.freeze({x:[1,0,0],y:[0,0,-1],z:[0,1,0]});
export const AXIS_COLORS=Object.freeze({x:'#c34b49',y:'#358855',z:'#477acd'});
export const ARROW_AXES=Object.freeze({ArrowRight:'x',ArrowLeft:'y',ArrowUp:'z'});
export const toWorld=([x,y,z])=>[x,z,-y];
export const fromWorld=([x,y,z])=>[x,-z,y];
