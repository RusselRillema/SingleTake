using Avalonia;
using Avalonia.Controls;
using Avalonia.OpenGL;
using Avalonia.OpenGL.Controls;
using Avalonia.Threading;
using Silk.NET.OpenGL;
using SkiaSharp;
using SingleTake.Protocol;
using System.Numerics;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using GL = Silk.NET.OpenGL.GL;

namespace SingleTake.Desktop.Rendering;

/// <summary>Native GPU surface. No browser, JavaScript GL emulation, or pixels streamed from an HTML canvas.</summary>
public sealed unsafe class NativeViewport : OpenGlControlBase
{
    readonly Dictionary<string,GpuMesh> meshes=new(StringComparer.Ordinal);
    readonly Dictionary<string,long> texturePixels=new(StringComparer.Ordinal);
    readonly HashSet<string> translucentTextures=[];
    readonly Dictionary<string,uint> textures=new(StringComparer.Ordinal);
    readonly Dictionary<string,int> uniforms=new(StringComparer.Ordinal);
    GL? gl;
    uint program,instances,lineVao,lineVbo;
    SceneSnapshot? snapshot;
    long residentSerial;
    bool failed;
    TaskCompletionSource<byte[]>? screenshot;
    public event Action? Reset;
    public event Action<string>? Failed;
    public sealed record FrameEvidence(long Serial, int Placements, int DrawCalls, int ChangedPixels, string Diagnostics, long Triangles, double CpuMs);
    public event Action<FrameEvidence>? Presented;
    // Readback is opt-in for acceptance tests, never part of the interactive frame path.
    public bool CaptureAcceptancePixels { get; set; }
    public NativeViewport(){Focusable=false;IsHitTestVisible=false;ClipToBounds=true;}
    public void SetScene(SceneSnapshot scene){Volatile.Write(ref snapshot,scene);RequestNextFrameRendering();}
    protected override void OnOpenGlInit(GlInterface api)
    {
        try
        {
            gl=GL.GetApi(api.GetProcAddress);
            var prefix=GlVersion.Type==GlProfileType.OpenGLES?"#version 300 es\nprecision highp float;\n":"#version 150\n";
            var vertex=GlVersion.Type==GlProfileType.OpenGLES?VertexShader:Regex.Replace(VertexShader,@"layout\(location=\d+\)\s*", "");
            program=Compile(prefix+vertex,prefix+FragmentShader);instances=gl.GenBuffer();lineVao=gl.GenVertexArray();lineVbo=gl.GenBuffer();failed=false;residentSerial=0;
            Dispatcher.UIThread.Post(()=>Reset?.Invoke());
        }
        catch(Exception ex){ReportFailure("Native GPU initialization failed: "+ex.Message);}
    }
    protected override void OnOpenGlRender(GlInterface api,int framebuffer)
    {
        if(gl is null||failed)return;
        var scene=Volatile.Read(ref snapshot);
        try
        {
            var scale=TopLevel.GetTopLevel(this)?.RenderScaling??1;
            gl.BindFramebuffer(FramebufferTarget.Framebuffer,(uint)framebuffer);
            gl.Viewport(0,0,(uint)Math.Max(1,Bounds.Width*scale),(uint)Math.Max(1,Bounds.Height*scale));
            gl.Disable(EnableCap.ScissorTest);gl.Disable(EnableCap.CullFace);gl.Enable(EnableCap.DepthTest);gl.DepthFunc(DepthFunction.Lequal);gl.DepthMask(true);
            gl.ClearColor(.85f,.88f,.85f,1);gl.Clear(ClearBufferMask.ColorBufferBit|ClearBufferMask.DepthBufferBit);
            if(scene is null)return;
            var watch=System.Diagnostics.Stopwatch.StartNew();Synchronize(scene);
            gl.UseProgram(program);Matrix("vp",scene.Frame.ViewProjection);Vec3("eye",scene.Frame.Eye);Vec4("sectionPlane",scene.Frame.Section);
            gl.Uniform1(U("exposure"),scene.Frame.Exposure);gl.Uniform1(U("style"),scene.Frame.Style);gl.Uniform1(U("tex"),0);
            var frame=scene.Frame;
            if(frame.Grid||frame.Axes)DrawWorld(frame);
            var tags=frame.Tags.ToDictionary(t=>t.Id,t=>t,StringComparer.Ordinal);
            var opaque=new List<Batch>();var transparent=new List<Batch>();
            foreach(var bucket in frame.Nodes.GroupBy(n=>new {n.Mesh,n.Material,n.Selected,n.Dimmed,n.Tag}))
            {
                var resource=meshes[bucket.Key.Mesh];var nodes=bucket.ToArray();
                for(var i=0;i<resource.Groups.Length;i++)
                {
                    var part=resource.Groups[i];if(part.Tag is not null&&tags.TryGetValue(part.Tag,out var gt)&&!gt.Visible)continue;
                    var material=frame.Materials[part.Material<0?bucket.Key.Material:part.Material];var color=material.Color.ToArray();
                    if(frame.ColorByTag&&tags.TryGetValue(part.Tag is not null&&part.Tag!="0"?part.Tag:bucket.Key.Tag,out var tag))color=ColorArray(tag.Color,color[3]);
                    var b=new Batch(part,nodes,material,color,bucket.Key.Selected,bucket.Key.Dimmed);
                    if(color[3]<.999||frame.Style==3||material.Texture is not null&&translucentTextures.Contains(material.Texture)){foreach(var node in nodes)transparent.Add(b with {Nodes=[node]});}else opaque.Add(b);
                }
            }
            var calls=0;
            // Opaque faces are batched by shared resource/material; transparent placements sort back-to-front.
            gl.Disable(EnableCap.Blend);gl.DepthMask(true);
            if(frame.Style!=2){foreach(var batch in opaque){DrawBatch(batch,frame);calls++;}}
            if(frame.Edges||frame.Style==2)
            {
                gl.Uniform1(U("unlit"),1);gl.Uniform1(U("hasTexture"),0);gl.Uniform1(U("selected"),0);gl.Uniform1(U("dimmed"),0);gl.Uniform1(U("linePass"),1);
                gl.Enable(EnableCap.Blend);gl.BlendFunc(BlendingFactor.SrcAlpha,BlendingFactor.OneMinusSrcAlpha);gl.DepthMask(false);
                foreach(var bucket in frame.Nodes.GroupBy(n=>new{n.Mesh,n.Selected,n.Dimmed}))
                {
                    var resource=meshes[bucket.Key.Mesh];var line=frame.Style==2?resource.Wire:resource.Lines;if(line.Count==0)continue;
                    Vec4("color",bucket.Key.Selected?[.96f,.61f,.18f,1]:[.12f,.20f,.16f,bucket.Key.Dimmed ? .3f : .8f]);
                    DrawPart(line,bucket.ToArray(),PrimitiveType.Lines);calls++;
                }
                if(frame.BackEdges)
                {
                    gl.Disable(EnableCap.DepthTest);Vec4("color",[.15f,.22f,.18f,.18f]);
                    foreach(var bucket in frame.Nodes.GroupBy(n=>n.Mesh)){var resource=meshes[bucket.Key];DrawPart(resource.Lines,bucket.ToArray(),PrimitiveType.Lines);calls++;}
                    gl.Enable(EnableCap.DepthTest);
                }
            }
            if(frame.Style!=2&&transparent.Count>0)
            {
                gl.Enable(EnableCap.Blend);gl.BlendFunc(BlendingFactor.SrcAlpha,BlendingFactor.OneMinusSrcAlpha);gl.DepthMask(false);
                foreach(var batch in transparent.OrderByDescending(b=>Distance(b.Nodes[0].Matrix,frame.Eye))){DrawBatch(batch,frame);calls++;}
            }
            gl.DepthMask(true);gl.Disable(EnableCap.Blend);gl.BindVertexArray(0);gl.UseProgram(0);gl.Flush();
            var gpuError=gl.GetError();if(gpuError!=GLEnum.NoError)throw new InvalidOperationException("OpenGL error: "+gpuError);
            var changedPixels=0;
            if(CaptureAcceptancePixels && frame.Nodes.Length>0)
            {
                // The acceptance model is fitted at the viewport center. Read actual native framebuffer pixels.
                var width=(int)Math.Max(1,Bounds.Width*scale);var height=(int)Math.Max(1,Bounds.Height*scale);
                var pixels=new byte[8*8*4];
                fixed(byte* target=pixels)gl.ReadPixels(Math.Max(0,width/2-4),Math.Max(0,height/2-4),8,8,PixelFormat.Rgba,PixelType.UnsignedByte,target);
                var readError=gl.GetError();if(readError!=GLEnum.NoError)throw new InvalidOperationException("Native readback failed: "+readError);
                for(var i=0;i<pixels.Length;i+=4)if(Math.Abs(pixels[i]-217)+Math.Abs(pixels[i+1]-224)+Math.Abs(pixels[i+2]-217)>25)changedPixels++;
            }
            watch.Stop();var info=$"Native GL · {frame.Nodes.Length:N0} placements · {calls:N0} draws · submission {watch.Elapsed.TotalMilliseconds:F1} ms";
            var triangles=frame.Style==2?0L:opaque.Concat(transparent).Sum(b=>(long)b.Part.Count/3*b.Nodes.Length);
            var evidence=new FrameEvidence(frame.Serial,frame.Nodes.Length,calls,changedPixels,info,triangles,watch.Elapsed.TotalMilliseconds);
            var capture=Interlocked.Exchange(ref screenshot,null);
            if(capture is not null){try{capture.TrySetResult(CapturePng((int)Math.Max(1,Bounds.Width*scale),(int)Math.Max(1,Bounds.Height*scale)));}catch(Exception ex){capture.TrySetException(ex);}}
            Dispatcher.UIThread.Post(()=>Presented?.Invoke(evidence));
        }
        catch(Exception ex){ReportFailure("Native GPU rendering failed: "+ex.Message);}
    }
    public Task<byte[]> RequestScreenshotAsync()
    {
        if (failed || gl is null || snapshot is null) throw new InvalidOperationException("The native renderer is not ready.");
        var request = new TaskCompletionSource<byte[]>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (Interlocked.CompareExchange(ref screenshot, request, null) is not null)
            throw new InvalidOperationException("A viewport capture is already pending.");
        RequestNextFrameRendering(); return request.Task;
    }
    byte[] CapturePng(int width, int height)
    {
        if (width > 8192 || height > 8192 || (long)width*height > 32*1024*1024)
            throw new InvalidOperationException("Viewport capture exceeds its pixel limit.");
        var bytes = new byte[checked(width*height*4)];
        fixed (byte* target = bytes) gl!.ReadPixels(0, 0, (uint)width, (uint)height, PixelFormat.Rgba, PixelType.UnsignedByte, target);
        if (gl!.GetError() != GLEnum.NoError) throw new InvalidOperationException("Native viewport readback failed.");
        using var bitmap = new SKBitmap(width, height, SKColorType.Rgba8888, SKAlphaType.Unpremul);
        for (var row=0; row<height; row++) Marshal.Copy(bytes, (height-1-row)*width*4, bitmap.GetPixels()+row*bitmap.RowBytes, width*4);
        using var image = SKImage.FromBitmap(bitmap); using var png = image.Encode(SKEncodedImageFormat.Png, 100);
        return png.ToArray();
    }
    void Synchronize(SceneSnapshot scene)
    {
        if(gl is null||residentSerial==scene.Frame.Serial)return;
        foreach(var id in meshes.Keys.Where(id=>!scene.Meshes.ContainsKey(id)).ToArray()){Delete(meshes[id]);meshes.Remove(id);}
        foreach(var id in textures.Keys.Where(id=>!scene.Images.ContainsKey(id)).ToArray()){gl.DeleteTexture(textures[id]);textures.Remove(id);texturePixels.Remove(id);translucentTextures.Remove(id);}
        foreach(var (id,source) in scene.Meshes)if(!meshes.ContainsKey(id))
        {
            var parts=new List<GpuPart>();GpuPart? lines=null,wire=null;
            try{foreach(var group in source.Groups)parts.Add(Upload(group.Vertices,group.Indices,8,group.Material,group.Tag));lines=Upload(source.Lines,[],3);wire=Upload(source.Wire,[],3);meshes[id]=new GpuMesh(parts.ToArray(),lines,wire);}
            catch{foreach(var part in parts)Delete(part);if(lines is not null)Delete(lines);if(wire is not null)Delete(wire);throw;}
        }
        long decodedPixels=texturePixels.Values.Sum();
        foreach(var (id,data)in scene.Images)
        {
            if(textures.ContainsKey(id))continue;
            // Read dimensions before allocating a bitmap; compressed file size does not bound decoded memory.
            using var stream=new SKMemoryStream(data);using var codec=SKCodec.Create(stream)??throw new InvalidDataException("Unsupported embedded texture.");
            var width=codec.Info.Width;var height=codec.Info.Height;var pixels=(long)width*height;
            if(width<=0||height<=0||width>8192||height>8192||pixels>16777216)throw new InvalidDataException("Texture dimensions exceed the native budget.");
            decodedPixels+=pixels;if(decodedPixels>67108864)throw new InvalidDataException("Decoded texture memory budget exceeded.");
            using var bitmap=new SKBitmap(new SKImageInfo(width,height,SKColorType.Rgba8888,SKAlphaType.Unpremul));
            if(codec.GetPixels(bitmap.Info,bitmap.GetPixels())!=SKCodecResult.Success)throw new InvalidDataException("Texture decoding failed.");
            var texture=gl.GenTexture();
            try{gl.BindTexture(TextureTarget.Texture2D,texture);gl.PixelStore(PixelStoreParameter.UnpackAlignment,1);gl.TexImage2D(TextureTarget.Texture2D,0,InternalFormat.Rgba8,(uint)width,(uint)height,0,PixelFormat.Rgba,PixelType.UnsignedByte,(void*)bitmap.GetPixels());gl.TexParameter(TextureTarget.Texture2D,TextureParameterName.TextureMinFilter,(int)TextureMinFilter.LinearMipmapLinear);gl.TexParameter(TextureTarget.Texture2D,TextureParameterName.TextureMagFilter,(int)TextureMagFilter.Linear);gl.TexParameter(TextureTarget.Texture2D,TextureParameterName.TextureWrapS,(int)TextureWrapMode.Repeat);gl.TexParameter(TextureTarget.Texture2D,TextureParameterName.TextureWrapT,(int)TextureWrapMode.Repeat);gl.GenerateMipmap(TextureTarget.Texture2D);textures[id]=texture;texturePixels[id]=pixels;if(codec.Info.AlphaType!=SKAlphaType.Opaque)translucentTextures.Add(id);}
            catch{gl.DeleteTexture(texture);throw;}
        }
        residentSerial=scene.Frame.Serial;
    }
    GpuPart Upload(float[] vertices,uint[] indices,int stride,int material=-1,string? tag=null)
    {
        var g=gl!;uint vao=g.GenVertexArray(),vbo=g.GenBuffer(),ebo=0;
        try
        {
            g.BindVertexArray(vao);g.BindBuffer(BufferTargetARB.ArrayBuffer,vbo);fixed(float* data=vertices)g.BufferData(BufferTargetARB.ArrayBuffer,(nuint)(vertices.Length*sizeof(float)),data,BufferUsageARB.StaticDraw);
            g.EnableVertexAttribArray(0);g.VertexAttribPointer(0,3,VertexAttribPointerType.Float,false,(uint)(stride*4),(void*)0);
            if(stride==8){g.EnableVertexAttribArray(1);g.VertexAttribPointer(1,3,VertexAttribPointerType.Float,false,32,(void*)12);g.EnableVertexAttribArray(2);g.VertexAttribPointer(2,2,VertexAttribPointerType.Float,false,32,(void*)24);}
            else{g.DisableVertexAttribArray(1);g.DisableVertexAttribArray(2);g.VertexAttrib3(1,0f,1f,0f);g.VertexAttrib2(2,0f,0f);}
            if(indices.Length>0){ebo=g.GenBuffer();g.BindBuffer(BufferTargetARB.ElementArrayBuffer,ebo);fixed(uint* data=indices)g.BufferData(BufferTargetARB.ElementArrayBuffer,(nuint)(indices.Length*4),data,BufferUsageARB.StaticDraw);}
            return new GpuPart(vao,vbo,ebo,(uint)(indices.Length>0?indices.Length:vertices.Length/stride),material,tag);
        }
        catch{if(ebo!=0)g.DeleteBuffer(ebo);g.DeleteBuffer(vbo);g.DeleteVertexArray(vao);throw;}
    }
    void DrawBatch(Batch batch,SceneFrame frame)
    {
        var g=gl!;Vec4("color",batch.Color);g.Uniform1(U("unlit"),0);g.Uniform1(U("linePass"),0);g.Uniform1(U("selected"),batch.Selected?1:0);g.Uniform1(U("dimmed"),batch.Dimmed?1:0);g.Uniform1(U("roughness"),batch.Material.Roughness);g.Uniform1(U("metalness"),batch.Material.Metalness);g.Uniform1(U("flipY"),batch.Material.FlipY?1:0);
        var texture=batch.Material.Texture;bool has=texture is not null&&textures.TryGetValue(texture,out var unused);g.Uniform1(U("hasTexture"),has?1:0);g.ActiveTexture(TextureUnit.Texture0);g.BindTexture(TextureTarget.Texture2D,has?textures[texture!]:0);
        DrawPart(batch.Part,batch.Nodes,PrimitiveType.Triangles);
    }
    void DrawPart(GpuPart part,SceneNode[] nodes,PrimitiveType mode)
    {
        if(part.Count==0||nodes.Length==0)return;var g=gl!;g.BindVertexArray(part.Vao);var matrices=new float[nodes.Length*16];for(var i=0;i<nodes.Length;i++)Array.Copy(nodes[i].Matrix,0,matrices,i*16,16);g.BindBuffer(BufferTargetARB.ArrayBuffer,instances);
        fixed(float* values=matrices)g.BufferData(BufferTargetARB.ArrayBuffer,(nuint)(matrices.Length*4),values,BufferUsageARB.StreamDraw);
        for(uint i=0;i<4;i++){g.EnableVertexAttribArray(3+i);g.VertexAttribPointer(3+i,4,VertexAttribPointerType.Float,false,64,(void*)(nuint)(i*16));g.VertexAttribDivisor(3+i,1);}
        if(part.Ebo!=0)g.DrawElementsInstanced(mode,part.Count,DrawElementsType.UnsignedInt,(void*)0,(uint)nodes.Length);else g.DrawArraysInstanced(mode,0,part.Count,(uint)nodes.Length);
    }
    void DrawWorld(SceneFrame frame)
    {
        var g=gl!;g.Uniform1(U("unlit"),1);g.Uniform1(U("linePass"),1);g.Uniform1(U("hasTexture"),0);g.Uniform1(U("selected"),0);g.Uniform1(U("dimmed"),0);Vec4("sectionPlane",[0,0,0,0]);
        var identity=new float[]{1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1};var node=new SceneNode("world","world",identity,0,false,false,"0");
        var origin=frame.Origin;var span=Math.Max(10,frame.CameraDistance*5);var step=MathF.Pow(10,MathF.Floor(MathF.Log10(Math.Max(.1f,frame.CameraDistance)/12)));var centerX=MathF.Round((frame.Eye[0]+origin[0])/step)*step-origin[0];var centerZ=MathF.Round((frame.Eye[2]+origin[2])/step)*step-origin[2];
        if(frame.Grid)
        {
            var points=new List<float>();for(int i=-60;i<=60;i++){var d=i*step;points.AddRange([centerX+d,-origin[1]-.002f,centerZ-60*step,centerX+d,-origin[1]-.002f,centerZ+60*step]);points.AddRange([centerX-60*step,-origin[1]-.002f,centerZ+d,centerX+60*step,-origin[1]-.002f,centerZ+d]);}
            Vec4("color",[.61f,.67f,.61f,1]);DynamicLines(points.ToArray(),node);
        }
        if(frame.Axes)
        {
            var zero=new float[]{-origin[0],-origin[1],-origin[2]};
            var directions=new[]{new float[]{1,0,0},new float[]{0,0,-1},new float[]{0,1,0}};
            var colors=new[]{new float[]{.85f,.22f,.18f,1},new float[]{.20f,.59f,.26f,1},new float[]{.16f,.39f,.86f,1}};
            for(var i=0;i<3;i++){var d=directions[i];Vec4("color",colors[i]);DynamicLines([zero[0]-d[0]*span,zero[1]-d[1]*span,zero[2]-d[2]*span,zero[0]+d[0]*span,zero[1]+d[1]*span,zero[2]+d[2]*span],node);}
        }
        Vec4("sectionPlane",frame.Section);
    }
    void DynamicLines(float[] vertices,SceneNode node)
    {
        var g=gl!;g.BindVertexArray(lineVao);g.BindBuffer(BufferTargetARB.ArrayBuffer,lineVbo);fixed(float* p=vertices)g.BufferData(BufferTargetARB.ArrayBuffer,(nuint)(vertices.Length*4),p,BufferUsageARB.StreamDraw);g.EnableVertexAttribArray(0);g.VertexAttribPointer(0,3,VertexAttribPointerType.Float,false,12,(void*)0);g.DisableVertexAttribArray(1);g.DisableVertexAttribArray(2);g.VertexAttrib3(1,0f,1f,0f);g.VertexAttrib2(2,0f,0f);DrawPart(new GpuPart(lineVao,lineVbo,0,(uint)(vertices.Length/3),-1,null),[node],PrimitiveType.Lines);
    }
    uint Compile(string vertex,string fragment)
    {
        var g=gl!;uint vs=0,fs=0,p=0;try{vs=Shader(ShaderType.VertexShader,vertex);fs=Shader(ShaderType.FragmentShader,fragment);p=g.CreateProgram();g.AttachShader(p,vs);g.AttachShader(p,fs);g.BindAttribLocation(p,0,"position");g.BindAttribLocation(p,1,"normal");g.BindAttribLocation(p,2,"uv");g.BindAttribLocation(p,3,"model");g.LinkProgram(p);g.GetProgram(p,ProgramPropertyARB.LinkStatus,out var ok);if(ok==0)throw new InvalidOperationException(g.GetProgramInfoLog(p));return p;}catch{if(p!=0)g.DeleteProgram(p);throw;}finally{if(vs!=0)g.DeleteShader(vs);if(fs!=0)g.DeleteShader(fs);}
    }
    uint Shader(ShaderType type,string text){var g=gl!;var s=g.CreateShader(type);g.ShaderSource(s,text);g.CompileShader(s);g.GetShader(s,ShaderParameterName.CompileStatus,out var ok);if(ok!=0)return s;var error=g.GetShaderInfoLog(s);g.DeleteShader(s);throw new InvalidOperationException(error);}
    int U(string name){if(!uniforms.TryGetValue(name,out var value)){value=gl!.GetUniformLocation(program,name);uniforms[name]=value;}return value;}
    void Matrix(string name,float[] m){fixed(float* v=m)gl!.UniformMatrix4(U(name),1,false,v);}
    void Vec3(string name,float[] v)=>gl!.Uniform3(U(name),v[0],v[1],v[2]);
    void Vec4(string name,float[] v)=>gl!.Uniform4(U(name),v[0],v[1],v[2],v[3]);
    static float[] ColorArray(string color,float alpha)=>[Convert.ToByte(color.Substring(1,2),16)/255f,Convert.ToByte(color.Substring(3,2),16)/255f,Convert.ToByte(color.Substring(5,2),16)/255f,alpha];
    static float Distance(float[] m,float[] eye)=>(m[12]-eye[0])*(m[12]-eye[0])+(m[13]-eye[1])*(m[13]-eye[1])+(m[14]-eye[2])*(m[14]-eye[2]);
    void Delete(GpuMesh m){foreach(var part in m.Groups)Delete(part);Delete(m.Lines);Delete(m.Wire);}
    void Delete(GpuPart p){var g=gl!;if(p.Ebo!=0)g.DeleteBuffer(p.Ebo);g.DeleteBuffer(p.Vbo);g.DeleteVertexArray(p.Vao);}
    protected override void OnOpenGlDeinit(GlInterface api){Interlocked.Exchange(ref screenshot,null)?.TrySetCanceled();if(gl is null)return;foreach(var mesh in meshes.Values)Delete(mesh);meshes.Clear();foreach(var t in textures.Values)gl.DeleteTexture(t);textures.Clear();texturePixels.Clear();translucentTextures.Clear();if(program!=0)gl.DeleteProgram(program);if(instances!=0)gl.DeleteBuffer(instances);if(lineVbo!=0)gl.DeleteBuffer(lineVbo);if(lineVao!=0)gl.DeleteVertexArray(lineVao);uniforms.Clear();gl.Dispose();gl=null;}
    protected override void OnOpenGlLost(){Interlocked.Exchange(ref screenshot,null)?.TrySetException(new InvalidOperationException("The native GPU context was lost."));meshes.Clear();textures.Clear();texturePixels.Clear();translucentTextures.Clear();uniforms.Clear();residentSerial=0;gl?.Dispose();gl=null;Dispatcher.UIThread.Post(()=>Reset?.Invoke());}
    void ReportFailure(string text){failed=true;Interlocked.Exchange(ref screenshot,null)?.TrySetException(new InvalidOperationException(text));Dispatcher.UIThread.Post(()=>Failed?.Invoke(text));}

    sealed record GpuPart(uint Vao,uint Vbo,uint Ebo,uint Count,int Material,string? Tag);
    sealed record GpuMesh(GpuPart[] Groups,GpuPart Lines,GpuPart Wire);
    sealed record Batch(GpuPart Part,SceneNode[] Nodes,SceneMaterial Material,float[] Color,bool Selected,bool Dimmed);

    const string VertexShader="""
    layout(location=0) in vec3 position;
    layout(location=1) in vec3 normal;
    layout(location=2) in vec2 uv;
    layout(location=3) in mat4 model;
    uniform mat4 vp;
    uniform int linePass;
    out vec3 worldPosition;
    out vec3 worldNormal;
    out vec2 texCoord;
    void main(){vec4 w=model*vec4(position,1.0);worldPosition=w.xyz;worldNormal=transpose(inverse(mat3(model)))*normal;texCoord=uv;vec4 p=vp*w;p.z=2.0*p.z-p.w;if(linePass==1)p.z-=0.00004*p.w;gl_Position=p;}
    """;
    const string FragmentShader="""
    in vec3 worldPosition;
    in vec3 worldNormal;
    in vec2 texCoord;
    uniform vec3 eye;
    uniform vec4 color;
    uniform vec4 sectionPlane;
    uniform float exposure;
    uniform float roughness;
    uniform float metalness;
    uniform sampler2D tex;
    uniform int hasTexture;
    uniform int flipY;
    uniform int unlit;
    uniform int selected;
    uniform int dimmed;
    uniform int style;
    out vec4 result;
    const float PI=3.141592653589793;
    void main(){
      if(dot(vec4(worldPosition,1.0),sectionPlane)>0.000001)discard;
      vec4 base=color;
      if(hasTexture==1)base*=texture(tex,vec2(texCoord.x,flipY==1?1.0-texCoord.y:texCoord.y));
      if(base.a<0.015)discard;
      vec3 outputColor=base.rgb;
      if(unlit==0){
        if(style==1)base.rgb=vec3(0.79,0.80,0.75);
        vec3 n=normalize(worldNormal)*(gl_FrontFacing?1.0:-1.0),v=normalize(eye-worldPosition),l=normalize(vec3(0.45,0.85,0.38)),h=normalize(l+v);
        float nl=max(dot(n,l),0.0),nv=max(dot(n,v),0.001),nh=max(dot(n,h),0.0),vh=max(dot(v,h),0.0);
        float r=max(roughness,0.06),a=r*r,a2=a*a,d=a2/(PI*pow(nh*nh*(a2-1.0)+1.0,2.0));
        float k=(r+1.0)*(r+1.0)/8.0,g=(nv/(nv*(1.0-k)+k))*(nl/(nl*(1.0-k)+k));
        vec3 albedo=pow(max(base.rgb,vec3(0.0)),vec3(2.2)),f0=mix(vec3(0.04),albedo,metalness),f=f0+(1.0-f0)*pow(1.0-vh,5.0);
        vec3 diffuse=(1.0-f)*(1.0-metalness)*albedo/PI,specular=d*g*f/max(4.0*nv*nl,0.001);
        vec3 linear=albedo*(0.28+0.15*max(n.y,0.0))+(diffuse+specular)*nl*2.2;
        linear*=exposure;outputColor=pow(linear/(linear+vec3(0.35)),vec3(1.0/2.2));
        if(style==3)base.a*=0.28;
        if(selected==1)outputColor=mix(outputColor,vec3(1.0,0.66,0.24),0.35);
        if(dimmed==1)outputColor=mix(outputColor,vec3(0.85,0.88,0.85),0.65);
      }
      result=vec4(outputColor,base.a);
    }
    """;
}
