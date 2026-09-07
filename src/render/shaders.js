export const sceneShader=/* wgsl */`
struct Frame {
 vp: mat4x4<f32>, lightVP: mat4x4<f32>,
 camera: vec4<f32>, light: vec4<f32>, settings: vec4<f32>,
 clip: vec4<f32>, viewport: vec4<f32>, grid: vec4<f32>,
};
struct ObjectData { model: mat4x4<f32>, normalMatrix: mat4x4<f32>, flags: vec4<f32> };
struct Material { color: vec4<f32>, surface: vec4<f32> };
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> objects: array<ObjectData>;
@group(0) @binding(2) var<storage, read> instances: array<u32>;
@group(0) @binding(3) var shadowSampler: sampler_comparison;
@group(0) @binding(4) var shadowMap: texture_depth_2d;
@group(1) @binding(0) var<uniform> material: Material;
@group(1) @binding(1) var colorSampler: sampler;
@group(1) @binding(2) var colorMap: texture_2d<f32>;
struct VertexInput { @location(0) position: vec3<f32>, @location(1) normal: vec3<f32>, @location(2) uv: vec2<f32> };
struct VertexOutput {
 @builtin(position) clipPosition: vec4<f32>, @location(0) world: vec3<f32>,
 @location(1) normal: vec3<f32>, @location(2) uv: vec2<f32>,
 @location(3) @interpolate(flat) flags: vec4<f32>, @location(4) lightPosition: vec4<f32>
};
@vertex fn vs(input: VertexInput, @builtin(instance_index) instance: u32) -> VertexOutput {
 let object = objects[instances[instance]];
 let w = object.model * vec4<f32>(input.position, 1.0);
 var out: VertexOutput;
 out.clipPosition = frame.vp * w; out.world = w.xyz;
 out.normal = normalize((object.normalMatrix * vec4<f32>(input.normal,0.0)).xyz);
 out.uv = input.uv; out.flags = object.flags; out.lightPosition = frame.lightVP*w;
 return out;
}
struct ShadowOutput { @builtin(position) position:vec4<f32>, @location(0) world:vec3<f32> };
@vertex fn shadowVS(input: VertexInput, @builtin(instance_index) instance: u32) -> ShadowOutput {
 let world=objects[instances[instance]].model*vec4<f32>(input.position,1.0);
 var out:ShadowOutput;out.position=frame.lightVP*world;out.world=world.xyz;return out;
}
@fragment fn shadowFS(input:ShadowOutput){
 if(frame.settings.x>.5 && dot(vec4<f32>(input.world,1.0),frame.clip)<0.0){discard;}
}
fn shadowVisibility(lightPosition: vec4<f32>, nDotL: f32) -> f32 {
 let p=lightPosition.xyz/lightPosition.w;
 let uv=vec2<f32>(p.x*.5+.5,.5-p.y*.5);
 if (uv.x<0.0 || uv.x>1.0 || uv.y<0.0 || uv.y>1.0 || p.z<0.0 || p.z>1.0) { return 1.0; }
 let texel=1.0/f32(textureDimensions(shadowMap).x);
 let bias=max(0.00007,0.00035*(1.0-nDotL));
 var sum=0.0;
 for(var x=-1;x<=1;x++){for(var y=-1;y<=1;y++){
  sum+=textureSampleCompareLevel(shadowMap,shadowSampler,uv+vec2<f32>(f32(x),f32(y))*texel,p.z-bias);
 }}
 return sum/9.0;
}
fn aces(x: vec3<f32>) -> vec3<f32> { return clamp((x*(2.51*x+vec3<f32>(.03)))/(x*(2.43*x+vec3<f32>(.59))+vec3<f32>(.14)),vec3<f32>(0.0),vec3<f32>(1.0)); }
fn gridLine(p: vec2<f32>, scale: f32) -> f32 {
 let coords=p/scale;let deriv=max(fwidth(coords),vec2<f32>(0.00001));
 let g=abs(fract(coords-vec2<f32>(.5))-vec2<f32>(.5))/deriv;
 return 1.0-min(min(g.x,g.y),1.0);
}
@fragment fn fs(input: VertexOutput,@builtin(front_facing) front: bool) -> @location(0) vec4<f32> {
 // Derivative-dependent operations run before any non-uniform discard.
 let sampledColor=textureSample(colorMap,colorSampler,input.uv);
 let minorGrid=gridLine(input.world.xz+frame.grid.zw,frame.grid.x);
 let majorGrid=gridLine(input.world.xz+frame.grid.zw,frame.grid.x*5.0);
 if(frame.settings.x>0.5 && dot(vec4<f32>(input.world,1.0),frame.clip)<0.0 && input.flags.y>0.0){discard;}
 var base=material.color.rgb;var alpha=material.color.a;
 if(material.surface.z>0.5){base*=sampledColor.rgb;alpha*=sampledColor.a;}
 if(alpha<.025){discard;}
 var n=normalize(input.normal);if(front==(input.flags.z>.5)){n=-n;}
 let l=normalize(frame.light.xyz);let v=normalize(frame.camera.xyz-input.world);let h=normalize(l+v);
 let ndl=max(dot(n,l),0.0);let ndv=max(dot(n,v),0.001);let ndh=max(dot(n,h),0.0);let vdh=max(dot(v,h),0.0);
 let rough=max(.08,material.surface.x);let metallic=material.surface.y;
 let a2=rough*rough*rough*rough;let denom=ndh*ndh*(a2-1.0)+1.0;
 let D=a2/(3.14159265*denom*denom+.00001);
 let k=(rough+1.0)*(rough+1.0)/8.0;
 let G=ndv/(ndv*(1.0-k)+k)*ndl/(ndl*(1.0-k)+k);
 let f0=mix(vec3<f32>(.04),base,metallic);
 let F=f0+(vec3<f32>(1.0)-f0)*pow(1.0-vdh,5.0);
 let spec=D*G*F/(4.0*ndv*max(ndl,.001)+.00001);
 let kd=(vec3<f32>(1.0)-F)*(1.0-metallic);
 var shadow=1.0;if(frame.viewport.z>.5){shadow=shadowVisibility(input.lightPosition,ndl);}
 if(frame.viewport.w==1.0){base=vec3<f32>(.76,.75,.71);}
 var color=base*(.40+.20*(n.y*.5+.5))+(kd*base+spec)*ndl*frame.light.w*shadow;
 if(material.surface.w>.5){
  let fade=1.0-smoothstep(frame.grid.x*12.0,frame.grid.x*70.0,length(input.world.xz-frame.camera.xz));
  let minor=minorGrid*.065*fade;
  let major=majorGrid*.085*fade;
  color=vec3<f32>(.72,.735,.71)*(.65+.35*shadow)-vec3<f32>((minor+major)*frame.grid.y);
 }
 if(input.flags.x>.5 && material.surface.w<.5){color=mix(color,vec3<f32>(.10,.66,.48),.20);}
 if(frame.viewport.w==2.0 && material.surface.w<.5){color=vec3<f32>(.9,.92,.90);alpha=.03;}
 if(frame.viewport.w==3.0 && material.surface.w<.5){alpha=min(alpha,.22);}
 if(input.flags.w<0.0){color=mix(color,vec3<f32>(.87,.88,.86),.72);}
 color=aces(color*frame.camera.w);
 return vec4<f32>(pow(color,vec3<f32>(1.0/2.2)),alpha);
}
@fragment fn pickFS(input: VertexOutput) -> @location(0) u32 {
 if(frame.settings.x>.5 && dot(vec4<f32>(input.world,1.0),frame.clip)<0.0){discard;}
 return u32(input.flags.y);
}
struct LineOutput { @builtin(position) position: vec4<f32>, @location(0) world: vec3<f32>, @location(1) @interpolate(flat) flags: vec4<f32> };
@vertex fn lineVS(@location(0) position: vec3<f32>, @builtin(instance_index) instance:u32)->LineOutput{
 let object=objects[instances[instance]];let world=object.model*vec4<f32>(position,1.0);var out:LineOutput;
 out.position=frame.vp*world;out.position.z-=.00002*out.position.w;out.world=world.xyz;out.flags=object.flags;return out;
}
@fragment fn lineFS(input:LineOutput)->@location(0) vec4<f32>{
 if(frame.settings.x>.5&&dot(vec4<f32>(input.world,1.0),frame.clip)<0.0){discard;}
 return select(vec4<f32>(.22,.255,.24,.55),vec4<f32>(.02,.56,.36,1.0),input.flags.x>.5);
}
@fragment fn backLineFS(input:LineOutput)->@location(0) vec4<f32>{
 if(frame.settings.x>.5&&dot(vec4<f32>(input.world,1.0),frame.clip)<0.0){discard;}
 if(fract((input.position.x+input.position.y)/9.0)>.5){discard;}
 return select(vec4<f32>(.30,.35,.32,.36),vec4<f32>(.02,.56,.36,.7),input.flags.x>.5);
}
`;
/** Global axes are a separate pipeline, not part of the document or ground grid. */
export const axisShader=`
struct Frame {vp:mat4x4<f32>};
@group(0) @binding(0) var<uniform> frame:Frame;
struct Out {@builtin(position) position:vec4<f32>,@location(0) color:vec3<f32>,@location(1) distance:f32};
@vertex fn vs(@location(0) position:vec3<f32>,@location(1) color:vec3<f32>,@location(2) distance:f32)->Out{
 var out:Out;out.position=frame.vp*vec4<f32>(position,1.0);out.position.z-=.00001*out.position.w;out.color=color;out.distance=distance;return out;
}
@fragment fn fs(input:Out)->@location(0) vec4<f32>{
 if(input.distance<0.0&&fract(abs(input.distance))>.55){discard;}
 return vec4<f32>(input.color,.95);
}
`;

