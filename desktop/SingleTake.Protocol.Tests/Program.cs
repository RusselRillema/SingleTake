using SingleTake.Protocol;
using System.Buffers.Binary;
using System.Text.Json;

var failures=0;var passed=0;
void Test(string name,Action action){try{action();passed++;Console.WriteLine("PASS "+name);}catch(Exception e){failures++;Console.Error.WriteLine("FAIL "+name+": "+e.Message);}}
void Check(bool condition){if(!condition)throw new Exception("Assertion failed.");}
void Reject(Action action){try{action();}catch(InvalidDataException){return;}throw new Exception("Expected invalid data rejection.");}
var identity=new float[]{1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1};
SceneFrame Empty(long serial=1)=>new(){Schema=1,Serial=serial,DocumentId="test",Name="Test",ViewProjection=identity,Eye=[0,0,4],Origin=[0,0,0],Section=[0,0,0,0],CameraDistance=4,Width=800,Height=600,Materials=[new SceneMaterial("m",[1,1,1,1],.7f,0,null)],Tags=[new SceneTag("0",true,"#789087")]};
string Floats(float[] values){var bytes=new byte[values.Length*4];for(var i=0;i<values.Length;i++)BinaryPrimitives.WriteSingleLittleEndian(bytes.AsSpan(i*4),values[i]);return Convert.ToBase64String(bytes);}
MeshPacket Triangle()=>new("mesh",[new MeshGroupPacket(Floats([0,0,0,0,0,1,0,0,1,0,0,0,0,1,1,0,0,1,0,0,0,1,0,1]),Convert.ToBase64String(new byte[]{0,0,0,0,1,0,0,0,2,0,0,0}),-1,"0")],"","");
SceneFrame MeshFrame()=>Empty() with{Resources=[Triangle()],ResourceIds=["mesh"],Nodes=[new SceneNode("n","mesh",identity,0,false,false,"0")]};
Test("Empty frame validates",()=>Check(new SceneStore().Accept(Empty()).Frame.Serial==1));
Test("Unsupported protocol fails",()=>Reject(()=>new SceneStore().Accept(Empty() with{Schema=5})));
Test("Camera matrices reject NaN",()=>Reject(()=>new SceneStore().Accept(Empty() with{Eye=[float.NaN,0,0]})));
Test("Missing resources fail atomically",()=>{var s=new SceneStore();var old=s.Accept(Empty());Reject(()=>s.Accept(Empty(2) with{ResourceIds=["missing"]}));Check(ReferenceEquals(old,s.Current));});
Test("Indexed geometry decodes",()=>{var s=new SceneStore().Accept(MeshFrame());Check(s.Meshes["mesh"].Groups[0].Indices.Length==3);});
Test("Out-of-range indices reject",()=>{var r=Triangle();var g=r.Groups[0] with{Indices=Convert.ToBase64String(new byte[]{9,0,0,0,1,0,0,0,2,0,0,0})};Reject(()=>new SceneStore().Accept(MeshFrame() with{Resources=[r with{Groups=[g]}]}));});
Test("Camera-only deltas retain decoded resources",()=>{var s=new SceneStore();var first=s.Accept(MeshFrame());var second=s.Accept(MeshFrame() with{Serial=2,Resources=[]});Check(ReferenceEquals(first.Meshes["mesh"],second.Meshes["mesh"]));});
Test("Context reset accepts identical resources under immutable IDs",()=>{var s=new SceneStore();var first=s.Accept(MeshFrame());var again=s.Accept(MeshFrame() with{Serial=2});Check(ReferenceEquals(first.Meshes["mesh"],again.Meshes["mesh"]));});
Test("Resource IDs cannot change geometry in place",()=>{var s=new SceneStore();s.Accept(MeshFrame());var r=Triangle();Reject(()=>s.Accept(MeshFrame() with{Serial=2,Resources=[r with{Lines=Floats([0,0,0,1,1,1])}]}));});
Test("Unreferenced resources are evicted",()=>{var s=new SceneStore();s.Accept(MeshFrame());Check(s.Accept(Empty(2)).Meshes.Count==0);});
Test("Stale frame is rejected",()=>{var s=new SceneStore();s.Accept(Empty(3));Reject(()=>s.Accept(Empty(2)));});
Test("Negative material rejects",()=>{var f=MeshFrame();Reject(()=>new SceneStore().Accept(f with{Nodes=[f.Nodes[0] with{Material=-1}]}));});
Test("Singular transform rejects",()=>{var f=MeshFrame();Reject(()=>new SceneStore().Accept(f with{Nodes=[f.Nodes[0] with{Matrix=new float[16]}]}));});
Test("Invalid texture reference rejects",()=>Reject(()=>new SceneStore().Accept(Empty() with{Materials=[new SceneMaterial("m",[1,1,1,1],.5f,0,"missing")]})));
Test("Input motion coalesces but retains key and pointer boundaries",()=>{var q=new InputQueue();q.Add(new(){Kind="down"});q.Add(new(){Kind="move",X=1});q.Add(new(){Kind="move",X=2});q.Add(new(){Kind="keyDown",Key="Shift"});q.Add(new(){Kind="move",X=3});q.Add(new(){Kind="up"});var b=q.Drain();Check(b.Length==5&&b[1].X==2&&b[2].Kind=="keyDown"&&b[4].Kind=="up"&&q.Count==0);});
Test("Binary bounds reject oversize",()=>Reject(()=>SceneStore.Decode("AAAA",2)));
Test("JSON agrees with camelCase JS protocol",()=>{var text=JsonSerializer.Serialize(MeshFrame(),SceneStore.JsonOptions);using var json=JsonDocument.Parse(text);Check(new SceneStore().Accept(json.RootElement).Frame.Nodes.Length==1);});
if(args.Length>0)
{
    Test("External generated scene packet validates",()=>{using var document=JsonDocument.Parse(File.ReadAllText(args[0]));var snapshot=new SceneStore().Accept(document.RootElement);Check(snapshot.Meshes.Count>0&&snapshot.Frame.Nodes.Length>0);});
}
Console.WriteLine(JsonSerializer.Serialize(new{passed,failed=failures,scope="Native scene protocol and queue; no GPU"}));return failures==0?0:1;
