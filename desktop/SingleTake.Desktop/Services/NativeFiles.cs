using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Platform.Storage;
using SingleTake.Protocol;
using System.IO.Compression;

namespace SingleTake.Desktop.Services;

public sealed record PickedFile(string Name,string Data);
public sealed record PickedFiles(PickedFile[] Files);
public sealed record SavedFile(bool Saved,string? Name=null);
public static class NativeFiles
{
    public const int MaximumFileBytes=128*1024*1024;
    public static async Task<PickedFiles> OpenAsync(Window owner,CancellationToken ct,string kind="model")
    {
        if(kind is not ("model" or "image"))throw new InvalidDataException("Invalid picker kind.");
        var files=await UiThread.Run(()=>owner.StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions{Title="Open model and companion assets",AllowMultiple=kind=="model",FileTypeFilter=[new FilePickerFileType(kind=="image"?"Image":"Model and companion files"){Patterns=kind=="image"?["*.png","*.jpg","*.jpeg","*.webp"]:["*.take","*.skp","*.glb","*.gltf","*.bin","*.obj","*.mtl","*.stl","*.ply","*.dxf","*.png","*.jpg","*.jpeg","*.webp"]}]}));
        if(files.Count>128)throw new InvalidDataException("Select at most 128 model and companion files.");
        var result=new List<PickedFile>();long total=0;
        try
        {
            foreach(var file in files)
            {
                ct.ThrowIfCancellationRequested();await using var stream=await file.OpenReadAsync();using var data=new MemoryStream();var buffer=new byte[65536];int count;
                while((count=await stream.ReadAsync(buffer,ct))>0){total+=count;if(total>MaximumFileBytes)throw new InvalidDataException("Selected data exceeds the 128 MiB native import limit.");await data.WriteAsync(buffer.AsMemory(0,count),ct);}
                result.Add(new PickedFile(file.Name,Convert.ToBase64String(data.ToArray())));
            }
        }
        finally{foreach(var file in files)file.Dispose();}
        return new PickedFiles(result.ToArray());
    }
    public static async Task<SavedFile> SaveAsync(Window owner,string suggestedName,string data,CancellationToken ct)
    {
        if(suggestedName.Length>240||suggestedName!=Path.GetFileName(suggestedName)||suggestedName.Any(char.IsControl))throw new InvalidDataException("Invalid suggested filename.");
        var bytes=SceneStore.Decode(data,MaximumFileBytes);
        var file=await UiThread.Run(()=>owner.StorageProvider.SaveFilePickerAsync(new FilePickerSaveOptions{Title="Save SingleTake model",SuggestedFileName=suggestedName,ShowOverwritePrompt=true}));
        if(file is null)return new SavedFile(false);
        using(file)
        {
            var local=file.TryGetLocalPath();
            if(local is not null)
            {
                var temporary=Path.Combine(Path.GetDirectoryName(local)!,".singletake-"+Guid.NewGuid().ToString("N")+".tmp");
                try{await File.WriteAllBytesAsync(temporary,bytes,ct);ct.ThrowIfCancellationRequested();File.Move(temporary,local,true);}finally{if(File.Exists(temporary))File.Delete(temporary);}
            }
            else{await using var output=await file.OpenWriteAsync();if(output.CanSeek)output.SetLength(0);await output.WriteAsync(bytes,ct);await output.FlushAsync(ct);}
            return new SavedFile(true,file.Name);
        }
    }
    public static async Task<string> InflateAsync(string data,int expected,CancellationToken ct)
    {
        if(expected<0||expected>256*1024*1024)throw new InvalidDataException("Invalid expanded entry length.");
        var compressed=SceneStore.Decode(data,MaximumFileBytes);using var input=new MemoryStream(compressed,false);using var stream=new DeflateStream(input,CompressionMode.Decompress);var output=new byte[expected];int at=0;
        while(at<expected){var read=await stream.ReadAsync(output.AsMemory(at),ct);if(read==0)throw new InvalidDataException("Truncated compressed entry.");at+=read;}
        var extra=new byte[1];if(await stream.ReadAsync(extra,ct)!=0)throw new InvalidDataException("Expanded entry exceeds its declared size.");
        return Convert.ToBase64String(output);
    }
    public static Task<bool> ConfirmDiscardAsync(Window owner)=>UiThread.Run(async()=>
    {
        var dialog=new Window{Title="Unsaved model",Width=430,Height=205,CanResize=false,WindowStartupLocation=WindowStartupLocation.CenterOwner};
        var keep=new Button{Content="Keep editing"};var discard=new Button{Content="Discard changes"};
        keep.Click+=(_,_)=>dialog.Close(false);discard.Click+=(_,_)=>dialog.Close(true);
        dialog.Content=new StackPanel{Margin=new Thickness(22),Spacing=15,Children={new TextBlock{Text="The model has unsaved changes.\nSave it before continuing to keep your edits."},new StackPanel{Orientation=Orientation.Horizontal,Spacing=12,Children={keep,discard}}}};
        return await dialog.ShowDialog<bool>(owner);
    });
}
