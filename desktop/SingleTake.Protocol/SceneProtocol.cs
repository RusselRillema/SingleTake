using System.Buffers.Binary;
using System.Numerics;
using System.Text.Json;

namespace SingleTake.Protocol;

public sealed record SceneFrame
{
    public int Schema { get; init; }
    public long Serial { get; init; }
    public string DocumentId { get; init; } = "";
    public string Name { get; init; } = "";
    public float[] ViewProjection { get; init; } = [];
    public float[] Eye { get; init; } = [];
    public float[] Origin { get; init; } = [];
    public float[] Section { get; init; } = [];
    public float CameraDistance { get; init; }
    public double Width { get; init; }
    public double Height { get; init; }
    public int Style { get; init; }
    public bool Axes { get; init; }
    public bool Grid { get; init; }
    public bool Edges { get; init; }
    public bool BackEdges { get; init; }
    public bool ColorByTag { get; init; }
    public MeshPacket[] Resources { get; init; } = [];
    public string[] ResourceIds { get; init; } = [];
    public ImagePacket[] Images { get; init; } = [];
    public string[] ImageIds { get; init; } = [];
    public SceneNode[] Nodes { get; init; } = [];
    public SceneMaterial[] Materials { get; init; } = [];
    public SceneTag[] Tags { get; init; } = [];
    public OverlayPrimitive[] Overlay { get; init; } = [];
}
public sealed record MeshPacket(string Id, MeshGroupPacket[] Groups, string Lines, string Wire);
public sealed record MeshGroupPacket(string Vertices, string Indices, int Material, string? Tag);
public sealed record ImagePacket(string Id, string Data);
public sealed record SceneNode(string Id, string Mesh, float[] Matrix, int Material, bool Selected, bool Dimmed, string Tag);
public sealed record SceneMaterial(string Id, float[] Color, float Roughness, float Metalness, string? Texture, bool FlipY = false);
public sealed record SceneTag(string Id, bool Visible, string Color);
public sealed record OverlayPrimitive(string Type, Dictionary<string,string> Attributes, string Text);
public sealed record DecodedGroup(float[] Vertices, uint[] Indices, int Material, string? Tag);
public sealed record DecodedMesh(string Id, DecodedGroup[] Groups, float[] Lines, float[] Wire)
{
    public long ByteLength => Groups.Sum(g => (long)g.Vertices.Length * 4 + (long)g.Indices.Length * 4) + ((long)Lines.Length + Wire.Length) * 4;
}
public sealed record SceneSnapshot(SceneFrame Frame, IReadOnlyDictionary<string, DecodedMesh> Meshes, IReadOnlyDictionary<string,byte[]> Images);

/// <summary>Validates the entire delta before atomically replacing the accepted scene. Never mutates the previous snapshot.</summary>
public sealed class SceneStore
{
    public const int MaxPayloadBytes = 256 * 1024 * 1024;
    public const int MaxGeometryBytes = 192 * 1024 * 1024;
    public const int MaxImageBytes = 32 * 1024 * 1024;
    public static JsonSerializerOptions JsonOptions { get; } = new(JsonSerializerDefaults.Web) { MaxDepth = 32 };
    public SceneSnapshot? Current { get; private set; }

    public SceneSnapshot Accept(JsonElement json)
    {
        // The bridge is application-owned, not a browser-grade isolation boundary. Still reject malformed scene data.
        var text = json.GetRawText();
        if (text.Length > MaxPayloadBytes) throw new InvalidDataException("Scene message exceeds the transport limit.");
        return Accept(JsonSerializer.Deserialize<SceneFrame>(text, JsonOptions) ?? throw new InvalidDataException("Missing frame."));
    }

    public SceneSnapshot Accept(SceneFrame f)
    {
        Require(f.Schema == 1 && f.Serial > 0, "Unsupported scene protocol.");
        Require(Current is null || f.Serial > Current.Frame.Serial, "Out-of-order scene revision.");
        Id(f.DocumentId); Require(f.Name.Length <= 1024, "Model title too long.");
        Finite(f.ViewProjection, 16); Finite(f.Eye, 3); Finite(f.Origin, 3); Finite(f.Section, 4);
        Require(double.IsFinite(f.Width) && double.IsFinite(f.Height) && f.Width > 0 && f.Height > 0 && f.Width <= 65536 && f.Height <= 65536, "Invalid viewport size.");
        Require(float.IsFinite(f.CameraDistance) && f.CameraDistance > 0 && f.Style is >= 0 and <= 3, "Invalid view parameters.");
        Require(f.Nodes.Length <= 250000 && f.Resources.Length <= 50000 && f.Materials.Length is > 0 and <= 20000 && f.Tags.Length <= 50000, "Scene count exceeds limits.");
        Require(f.Images.Length <= 4096 && f.ImageIds.Length <= 4096 && f.Overlay.Length <= 20000, "Scene decorations exceed limits.");
        long encodedGeometry=f.Resources.Sum(r=>(long)r.Lines.Length+r.Wire.Length+r.Groups.Sum(g=>(long)g.Vertices.Length+g.Indices.Length));
        Require(encodedGeometry*3/4<=MaxGeometryBytes+f.Resources.Length*8L,"Geometry transfer budget exceeded.");
        var live = Unique(f.ResourceIds, 50000); var liveImages = Unique(f.ImageIds, 4096);
        var meshes = new Dictionary<string,DecodedMesh>(StringComparer.Ordinal);
        var images = new Dictionary<string,byte[]>(StringComparer.Ordinal);
        if (Current is not null)
        {
            foreach (var id in live) if (Current.Meshes.TryGetValue(id, out var mesh)) meshes.Add(id, mesh);
            foreach (var id in liveImages) if (Current.Images.TryGetValue(id, out var image)) images.Add(id, image);
        }
        long geometryBytes = 0;
        var newIds = new HashSet<string>();
        foreach (var r in f.Resources)
        {
            Id(r.Id); Require(live.Contains(r.Id) && newIds.Add(r.Id), "Invalid resource declaration.");

            Require(r.Groups.Length <= 20000, "Too many material groups.");
            var groups = r.Groups.Select(g => {
                var vertices = Floats(g.Vertices, 8, MaxGeometryBytes);
                var bytes = Decode(g.Indices, MaxGeometryBytes);
                Require(bytes.Length % 12 == 0, "Triangle indices must be uint32 triples.");
                var indices = new uint[bytes.Length / 4];
                for (var i = 0; i < indices.Length; i++) { indices[i] = BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(i*4)); Require(indices[i] < vertices.Length / 8, "Triangle index outside vertex buffer."); }
                Require(g.Material >= -1 && g.Material < f.Materials.Length, "Invalid face material.");
                if (g.Tag is not null) Id(g.Tag);
                return new DecodedGroup(vertices, indices, g.Material, g.Tag);
            }).ToArray();
            var mesh = new DecodedMesh(r.Id, groups, Floats(r.Lines, 6, MaxGeometryBytes), Floats(r.Wire, 6, MaxGeometryBytes));
            if(meshes.TryGetValue(r.Id,out var existing)){Require(SameMesh(existing,mesh),"Immutable resource IDs cannot be overwritten.");mesh=existing;}
            geometryBytes += mesh.ByteLength; Require(geometryBytes <= MaxGeometryBytes, "Geometry budget exceeded."); meshes[r.Id] = mesh;
        }
        Require(live.All(meshes.ContainsKey), "Missing scene resource; reset and resend resources.");
        Require(meshes.Values.Sum(m=>m.ByteLength) <= MaxGeometryBytes, "Resident geometry budget exceeded.");
        newIds.Clear();
        foreach (var image in f.Images)
        {
            Id(image.Id); Require(liveImages.Contains(image.Id) && newIds.Add(image.Id), "Invalid texture declaration.");
            var data = Decode(image.Data, MaxImageBytes);
            if(images.TryGetValue(image.Id,out var existingImage))Require(existingImage.SequenceEqual(data),"Immutable image IDs cannot be overwritten.");
            else images[image.Id] = data;
        }
        Require(liveImages.All(images.ContainsKey) && images.Values.Sum(b=>(long)b.Length) <= 128*1024*1024, "Texture budget exceeded or missing texture.");
        var nodeIds = new HashSet<string>();
        foreach(var node in f.Nodes)
        {
            Id(node.Id); Require(nodeIds.Add(node.Id) && meshes.ContainsKey(node.Mesh), "Invalid node resource.");
            Finite(node.Matrix, 16); Require(node.Material >= 0 && node.Material < f.Materials.Length, "Invalid instance material.");
            Require(Math.Abs(node.Matrix[3]) < 1e-6 && Math.Abs(node.Matrix[7]) < 1e-6 && Math.Abs(node.Matrix[11]) < 1e-6 && Math.Abs(node.Matrix[15]-1) < 1e-6, "Only affine transforms are supported.");
            var m=node.Matrix; var determinant=m[0]*(m[5]*m[10]-m[9]*m[6])-m[4]*(m[1]*m[10]-m[9]*m[2])+m[8]*(m[1]*m[6]-m[5]*m[2]);
            Require(float.IsFinite(determinant) && Math.Abs(determinant)>1e-20, "Singular model transform."); Id(node.Tag);
        }
        foreach(var material in f.Materials)
        {
            Id(material.Id); Finite(material.Color,4); Require(material.Color.All(c=>c is >=0 and <=1), "Invalid material color.");
            Require(float.IsFinite(material.Roughness) && float.IsFinite(material.Metalness) && material.Roughness is >=0 and <=1 && material.Metalness is >=0 and <=1, "Invalid material parameters.");
            Require(material.Texture is null || images.ContainsKey(material.Texture), "Unknown material texture.");
        }
        foreach(var tag in f.Tags) { Id(tag.Id); Require(tag.Color.Length == 7 && tag.Color[0]=='#' && tag.Color.AsSpan(1).ToString().All(Uri.IsHexDigit), "Invalid tag color."); }
        foreach(var primitive in f.Overlay)
        {
            Require(primitive.Type is "line" or "polyline" or "polygon" or "circle" or "rect" or "path" or "text", "Unsupported overlay primitive.");
            Require(primitive.Text.Length<=4096 && primitive.Attributes.Count<=24 && primitive.Attributes.All(a=>a.Key.Length<=32 && a.Value.Length<=131072), "Oversized overlay.");
        }
        return Current = new SceneSnapshot(f,meshes,images);
    }
    static bool SameMesh(DecodedMesh a,DecodedMesh b) => a.Lines.SequenceEqual(b.Lines) && a.Wire.SequenceEqual(b.Wire) && a.Groups.Length==b.Groups.Length && a.Groups.Zip(b.Groups).All(p=>p.First.Material==p.Second.Material&&p.First.Tag==p.Second.Tag&&p.First.Vertices.SequenceEqual(p.Second.Vertices)&&p.First.Indices.SequenceEqual(p.Second.Indices));
    public void Reset() => Current=null;
    public static byte[] Decode(string text, int limit)
    {
        Require(text is not null && text.Length <= ((long)limit+2)/3*4 && text.Length%4==0, "Invalid binary length.");
        byte[] bytes; try {bytes=Convert.FromBase64String(text!);}catch(FormatException ex){throw new InvalidDataException("Invalid base64 data.",ex);}
        Require(bytes.Length <= limit, "Binary size limit exceeded."); return bytes;
    }
    static float[] Floats(string text,int stride,int budget)
    {
        var bytes=Decode(text,budget); Require(bytes.Length%(stride*4)==0,"Invalid vertex stride."); var a=new float[bytes.Length/4];
        for(var i=0;i<a.Length;i++){a[i]=BinaryPrimitives.ReadSingleLittleEndian(bytes.AsSpan(i*4));Require(float.IsFinite(a[i]),"Non-finite geometry coordinate.");}return a;
    }
    static HashSet<string> Unique(string[] ids,int limit){Require(ids.Length<=limit,"Too many resources.");var set=new HashSet<string>(StringComparer.Ordinal);foreach(var id in ids){Id(id);Require(set.Add(id),"Duplicate resource ID.");}return set;}
    static void Id(string id) => Require(!string.IsNullOrEmpty(id) && id.Length<=256 && id.All(c=>!char.IsControl(c)),"Invalid identifier.");
    static void Finite(float[] a,int length)=>Require(a is not null && a.Length==length && a.All(float.IsFinite),"Invalid numeric vector.");
    static void Require(bool condition,string message){if(!condition)throw new InvalidDataException(message);}
}
