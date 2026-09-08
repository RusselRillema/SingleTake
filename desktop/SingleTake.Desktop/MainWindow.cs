using System.Text.Json;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using SingleTake.Desktop.Rendering;
using SingleTake.Desktop.Services;
using SingleTake.Protocol;
using WebScene.Sdk;
using WebScene.Sdk.Avalonia;

namespace SingleTake.Desktop;
public sealed class MainWindow : Window
{
    readonly WebSceneComponentHost component;
    readonly NativeViewport viewport=new();
    readonly OverlayCanvas overlay=new();
    readonly TextBlock status=new(){Text="Starting native engine…",Margin=new Thickness(12,5)};
    readonly TextBlock gpuStatus=new(){Margin=new Thickness(12,5)};
    readonly TextBlock errorText=new(){TextWrapping=TextWrapping.Wrap,Foreground=Brushes.OrangeRed,Margin=new Thickness(22),IsVisible=false};
    readonly SceneStore store=new();
    readonly InputQueue input=new();
    readonly CancellationTokenSource lifetime=new();
    readonly bool smoke=Environment.GetCommandLineArgs().Contains("--native-smoke");
    bool mounted,sending,closing,allowClose,smokeCompleted;
    long smokeSerial;
    DispatcherTimer? smokeTimeout;

    public MainWindow()
    {
        Title="SingleTake · Native desktop preview";Width=1450;Height=940;MinWidth=900;MinHeight=600;
        component=new WebSceneComponentHost{PackagePath=Path.Combine("Components","Modeler"),AutoMount=false};
        component.RegisterHostCapability(new WebSceneDelegateCapabilityHandler(WebSceneComponentCapabilities.Commands,HandleCommandAsync));
        var root=new Grid{ColumnDefinitions=new ColumnDefinitions("370,*"),RowDefinitions=new RowDefinitions("*,Auto")};
        root.Children.Add(component);Grid.SetColumn(component,0);
        var surface=new Grid();surface.Children.Add(viewport);surface.Children.Add(overlay);surface.Children.Add(errorText);root.Children.Add(surface);Grid.SetColumn(surface,1);
        var footer=new StackPanel{Orientation=Orientation.Horizontal};footer.Children.Add(status);footer.Children.Add(gpuStatus);root.Children.Add(footer);Grid.SetRow(footer,1);Grid.SetColumnSpan(footer,2);Content=root;
        viewport.CaptureAcceptancePixels=smoke;
        viewport.Input+=Queue;viewport.Failed+=Report;
        viewport.Presented+=e=>{gpuStatus.Text=e.Diagnostics;if(smoke&&smokeSerial>0&&e.Serial==smokeSerial&&e.Placements>0&&e.DrawCalls>0&&e.ChangedPixels>0)CompleteSmoke(0,e.Diagnostics+"; native non-background center pixels: "+e.ChangedPixels);};
        Opened+=async(_,_)=>await StartAsync();Closing+=OnClosing;Closed+=async(_,_)=>{lifetime.Cancel();smokeTimeout?.Stop();try{await component.DisposeAsync();}catch(Exception ex){System.Diagnostics.Trace.WriteLine(ex);}lifetime.Dispose();};
    }
    async Task StartAsync()
    {
        try
        {
            ValidateRuntimeFiles();
            if(smoke){smokeTimeout=new DispatcherTimer{Interval=TimeSpan.FromSeconds(45)};smokeTimeout.Tick+=(_,_)=>CompleteSmoke(1,"Native smoke test timed out without a presented model.");smokeTimeout.Start();}
            await component.MountAsync(lifetime.Token);mounted=true;
            Queue(new NativeInput{Kind="resize",Width=Math.Max(1,viewport.Bounds.Width),Height=Math.Max(1,viewport.Bounds.Height)});
            status.Text="Local files · native V8 / Avalonia / OpenGL";viewport.Focus();
            if(smoke)await component.View.EvaluateTextAsync("globalThis.SingleTakeDesktop.startSmoke()");
        }
        catch(Exception ex){Report("Cannot start the native component. "+ex.Message+"\nCheck NuGet availability for the configured version and native runtime files. No browser fallback is used.");}
    }
    static void ValidateRuntimeFiles()
    {
        var library=OperatingSystem.IsWindows()?"webscene_native_engine.dll":OperatingSystem.IsMacOS()?"libwebscene_native_engine.dylib":"libwebscene_native_engine.so";
        foreach(var name in new[]{library,"icudtl.dat","webscene_bootstrap_snapshot.bin","webscene_bootstrap_snapshot.meta","webscene-native-runtime.json","Components/Modeler/main.js","Components/Modeler/webscene-component.json"})
            if(!File.Exists(Path.Combine(AppContext.BaseDirectory,name)))throw new FileNotFoundException("Required packaged asset is missing: "+name);
    }
    async ValueTask<JsonElement?> HandleCommandAsync(string method,JsonElement arguments,CancellationToken ct)
    {
        lifetime.Token.ThrowIfCancellationRequested();ct.ThrowIfCancellationRequested();
        object? result;
        switch(method)
        {
            case "frame":
                var snapshot=store.Accept(arguments);
                await UiThread.Run(()=>{viewport.SetScene(snapshot);overlay.SetScene(snapshot.Frame);Title=snapshot.Frame.Name+" · SingleTake";if(snapshot.Frame.Name=="Native acceptance"&&snapshot.Frame.Nodes.Length>0)smokeSerial=snapshot.Frame.Serial;return Task.FromResult(true);});
                result=new{accepted=snapshot.Frame.Serial};break;
            case "open":result=await NativeFiles.OpenAsync(this,ct);break;
            case "save":result=await NativeFiles.SaveAsync(this,arguments.GetProperty("name").GetString()??"model.take",arguments.GetProperty("data").GetString()??"",ct);break;
            case "inflate":result=new{data=await NativeFiles.InflateAsync(arguments.GetProperty("data").GetString()??"",arguments.GetProperty("expected").GetInt32(),ct)};break;
            case "confirmDiscard":result=new{discard=await NativeFiles.ConfirmDiscardAsync(this)};break;
            case "focusViewport":Dispatcher.UIThread.Post(()=>viewport.Focus());result=new{accepted=true};break;
            case "focusPanel":Dispatcher.UIThread.Post(()=>component.Focus());result=new{accepted=true};break;
            case "status":
                var text=arguments.GetProperty("text").GetString()??"";if(text.Length>400)text=text[..400];Dispatcher.UIThread.Post(()=>status.Text=text);result=new{accepted=true};break;
            case "ready":result=new{native=true,schema=1};break;
            default:throw new InvalidOperationException("Host capability method is not allowed: "+method);
        }
        return JsonSerializer.SerializeToElement(result,SceneStore.JsonOptions);
    }
    void Queue(NativeInput item)
    {
        if(closing)return;
        try{input.Add(item);}catch(InvalidOperationException){input.Clear();input.Add(new NativeInput{Kind="blur"});status.Text="Input queue was reset; repeat the interrupted gesture.";}
        if(mounted&&!sending)Dispatcher.UIThread.Post(async()=>await PumpAsync(),DispatcherPriority.Input);
    }
    async Task PumpAsync()
    {
        if(sending||!mounted||closing)return;sending=true;
        try
        {
            while(input.Count>0&&!closing)
            {
                var batch=input.Drain();var json=JsonSerializer.Serialize(batch,SceneStore.JsonOptions);
                // Only serializer-produced literals cross evaluation. The called dispatcher queues JS work in order.
                await component.View.EvaluateTextAsync("globalThis.SingleTakeDesktop.enqueue("+json+")");
            }
        }
        catch(Exception ex){input.Clear();Report("Native input delivery failed: "+ex.Message);}
        finally{sending=false;}
    }
    async void OnClosing(object? sender,WindowClosingEventArgs e)
    {
        if(allowClose)return;e.Cancel=true;if(closing)return;closing=true;
        try
        {
            var dirty=mounted?await component.View.EvaluateTextAsync("String(!!globalThis.SingleTakeDesktop?.isDirty())"):"false";
            if(dirty.Trim('"',' ','\r','\n')=="true"&&!await NativeFiles.ConfirmDiscardAsync(this))return;
            allowClose=true;Close();
        }
        catch(Exception ex){status.Text="Could not verify unsaved state: "+ex.Message;if(await NativeFiles.ConfirmDiscardAsync(this)){allowClose=true;Close();}}
        finally{closing=false;}
    }
    void Report(string message){errorText.Text=message;errorText.IsVisible=true;status.Text="Native host error";System.Diagnostics.Trace.WriteLine(message);if(smoke)CompleteSmoke(1,message);}
    void CompleteSmoke(int code,string message)
    {
        if(smokeCompleted)return;smokeCompleted=true;
        smokeTimeout?.Stop();smokeTimeout=null;Console.WriteLine(JsonSerializer.Serialize(new{nativeSmoke=code==0?"PASS":"FAIL",message,geometry=store.Current?.Frame.Nodes.Length??0,renderer="native-opengl",browser=false}));allowClose=true;
        if(Application.Current?.ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)desktop.Shutdown(code);
    }
}
