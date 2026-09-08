using System.Text.Json;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Media;
using Avalonia.Threading;
using SingleTake.Desktop.Rendering;
using SingleTake.Desktop.Services;
using SingleTake.Protocol;
using WebScene.Sdk;
using WebScene.Sdk.Avalonia;

namespace SingleTake.Desktop;

/// <summary>The full WebScene UI is the web application. Only GPU pixels are composited underneath its DOM canvas.</summary>
public sealed class MainWindow : Window
{
    private readonly WebSceneComponentHost component;
    private readonly NativeViewport viewport = new() { IsHitTestVisible = false, Focusable = false };
    private readonly Canvas nativeLayer = new() { IsHitTestVisible = false, ClipToBounds = true };
    private readonly TextBlock error = new() { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(24) };
    private readonly Border errorPanel;
    private readonly CancellationTokenSource lifetime = new();
    private readonly SemaphoreSlim frameGate = new(1, 1);
    private SceneStore store = new();
    private readonly bool smoke = Environment.GetCommandLineArgs().Contains("--native-smoke");
    private bool mounted, closing, allowClose, smokeCompleted, sharedReady;
    private long smokeSerial;
    private DispatcherTimer? smokeTimeout;

    public MainWindow()
    {
        Title = "SingleTake"; Width = 1450; Height = 940; MinWidth = 1000; MinHeight = 650;
        Background = Brushes.Transparent;
        component = new WebSceneComponentHost {
            PackagePath = Path.Combine("Components", "Modeler"), AutoMount = false
        };
        component.View.Background = Brushes.Transparent;
        component.RegisterHostCapability(new WebSceneDelegateCapabilityHandler(
            WebSceneComponentCapabilities.Commands, HandleCommandAsync));

        // No sidebar, status strip, duplicate toolbar or second input surface in C#.
        nativeLayer.Children.Add(viewport);
        var root = new Grid { ClipToBounds = true };
        root.Children.Add(nativeLayer);
        root.Children.Add(component);
        errorPanel = new Border { Background = Brushes.White, Child = error, IsVisible = false };
        root.Children.Add(errorPanel);
        Content = root;

        viewport.CaptureAcceptancePixels = smoke;
        viewport.Failed += Report;
        viewport.Reset += async () => await NotifyAsync("globalThis.SingleTakeDesktop?.reset()");
        viewport.Presented += async evidence => {
            var json = JsonSerializer.Serialize(new {
                serial = evidence.Serial, placements = evidence.Placements, draws = evidence.DrawCalls,
                triangles = evidence.Triangles, cpuMs = evidence.CpuMs
            }, SceneStore.JsonOptions);
            await NotifyAsync("globalThis.SingleTakeDesktop?.presented(" + json + ")");
            if (smoke && sharedReady && smokeSerial > 0 && evidence.Serial >= smokeSerial &&
                evidence.Placements > 0 && evidence.DrawCalls > 0 && evidence.ChangedPixels > 0)
                CompleteSmoke(0, evidence.Diagnostics + "; shared dialog submitted; native framebuffer verified");
        };
        Deactivated += async (_, _) => await NotifyAsync("globalThis.SingleTakeDesktop?.blurred()");
        Opened += async (_, _) => await StartAsync();
        Closing += OnClosing;
        Closed += async (_, _) => {
            mounted = false; lifetime.Cancel(); smokeTimeout?.Stop();
            try { await component.DisposeAsync(); }
            catch (Exception ex) { System.Diagnostics.Trace.WriteLine(ex); }
            lifetime.Dispose();
        };
    }

    private async Task StartAsync()
    {
        try {
            ValidateRuntimeFiles();
            if (smoke) {
                smokeTimeout = new DispatcherTimer { Interval = TimeSpan.FromSeconds(60) };
                smokeTimeout.Tick += (_, _) => CompleteSmoke(1, "Shared native UI acceptance timed out.");
                smokeTimeout.Start();
            }
            await component.MountAsync(lifetime.Token);
            mounted = true;
            if (!sharedReady) throw new InvalidOperationException("The shared application did not finish mounting.");
            if (component.View.Content is Control inputSurface) inputSurface.Focus();
            if (smoke) await component.View.EvaluateTextAsync("globalThis.SingleTakeDesktop.startSmoke()");
        }
        catch (Exception ex) { Report("Native startup failed: " + ex.Message); }
    }

    private static void ValidateRuntimeFiles()
    {
        var library = OperatingSystem.IsWindows() ? "webscene_native_engine.dll" :
            OperatingSystem.IsMacOS() ? "libwebscene_native_engine.dylib" : "libwebscene_native_engine.so";
        foreach (var name in new[] { library, "icudtl.dat", "webscene_bootstrap_snapshot.bin",
            "webscene_bootstrap_snapshot.meta", "webscene-native-runtime.json", "Components/Modeler/main.js",
            "Components/Modeler/webscene-component.json", "Components/Modeler/ui/index.html",
            "Components/Modeler/ui/style.css", "Components/Modeler/ui-source.json" })
            if (!File.Exists(Path.Combine(AppContext.BaseDirectory, name)))
                throw new FileNotFoundException("Required packaged asset is missing: " + name);
    }

    private async ValueTask<JsonElement?> HandleCommandAsync(string method, JsonElement args, CancellationToken ct)
    {
        lifetime.Token.ThrowIfCancellationRequested(); ct.ThrowIfCancellationRequested();
        object? result;
        switch (method) {
            case "frame":
                await frameGate.WaitAsync(ct);
                try {
                    var snapshot = store.Accept(args);
                    var r = snapshot.Frame.Viewport ?? throw new InvalidDataException("The DOM canvas rectangle is required.");
                    await UiThread.Run(() => {
                        Canvas.SetLeft(viewport, r.Left); Canvas.SetTop(viewport, r.Top);
                        viewport.Width = r.Width; viewport.Height = r.Height;
                        viewport.SetScene(snapshot);
                        Title = snapshot.Frame.Name + " · SingleTake";
                        if (snapshot.Frame.Name == "Native acceptance" && snapshot.Frame.Nodes.Length > 0)
                            smokeSerial = snapshot.Frame.Serial;
                        return Task.FromResult(true);
                    });
                    result = new { accepted = snapshot.Frame.Serial };
                } finally { frameGate.Release(); }
                break;
            case "open":
                result = await NativeFiles.OpenAsync(this, ct, args.TryGetProperty("kind", out var kind) ? kind.GetString() ?? "model" : "model");
                break;
            case "save":
                result = await NativeFiles.SaveAsync(this, args.GetProperty("name").GetString() ?? "model.take",
                    args.GetProperty("data").GetString() ?? "", ct); break;
            case "inflate":
                result = new { data = await NativeFiles.InflateAsync(args.GetProperty("data").GetString() ?? "",
                    args.GetProperty("expected").GetInt32(), ct) }; break;
            case "recovery.load": result = new { data = await NativeRecovery.LoadAsync(ct) }; break;
            case "recovery.save":
                await NativeRecovery.SaveAsync(args.GetProperty("data").GetString() ?? "", ct);
                result = new { saved = true }; break;
            case "recovery.clear": await NativeRecovery.ClearAsync(ct); result = new { cleared = true }; break;
            case "screenshot":
                var png = await UiThread.Run(() => viewport.RequestScreenshotAsync().WaitAsync(TimeSpan.FromSeconds(15), ct));
                result = new { data = Convert.ToBase64String(png) }; break;
            case "reload":
                // Return the bridge reply before unmounting the caller's engine context.
                Dispatcher.UIThread.Post(async () => {
                    try { mounted = false; sharedReady = false; store = new SceneStore(); await component.ReloadAsync(lifetime.Token); mounted = true; errorPanel.IsVisible = false; }
                    catch (Exception ex) { Report("Reload failed: " + ex.Message); }
                }, DispatcherPriority.Background);
                result = new { requested = true }; break;
            case "ready":
                if (args.GetProperty("ui").GetString() != "shared") throw new InvalidDataException("A separate desktop UI is not supported.");
                sharedReady = true; result = new { native = true, ui = "shared", schema = 1 }; break;
            default: throw new InvalidOperationException("Host method is not allowed: " + method);
        }
        return JsonSerializer.SerializeToElement(result, SceneStore.JsonOptions);
    }

    private async Task NotifyAsync(string expression)
    {
        if (!mounted || closing || lifetime.IsCancellationRequested) return;
        try { await component.View.EvaluateTextAsync(expression); }
        catch (Exception ex) { System.Diagnostics.Trace.WriteLine("Native UI notification: " + ex.Message); }
    }

    private async void OnClosing(object? sender, WindowClosingEventArgs e)
    {
        if (allowClose) return;
        e.Cancel = true; if (closing) return; closing = true;
        try {
            var dirty = mounted ? await component.View.EvaluateTextAsync("String(!!globalThis.SingleTakeDesktop?.isDirty())") : "false";
            if (dirty.Trim('"', ' ', '\r', '\n') == "true" && !await NativeFiles.ConfirmDiscardAsync(this)) return;
            allowClose = true; Close();
        }
        catch { if (await NativeFiles.ConfirmDiscardAsync(this)) { allowClose = true; Close(); } }
        finally { closing = false; }
    }

    private void Report(string message)
    {
        error.Text = message; errorPanel.IsVisible = true; System.Diagnostics.Trace.WriteLine(message);
        if (smoke) CompleteSmoke(1, message);
    }
    private void CompleteSmoke(int code, string message)
    {
        if (smokeCompleted) return; smokeCompleted = true; smokeTimeout?.Stop();
        Console.WriteLine(JsonSerializer.Serialize(new { nativeSmoke = code == 0 ? "PASS" : "FAIL", ui = "shared",
            message, geometry = store.Current?.Frame.Nodes.Length ?? 0, renderer = "native-opengl", browser = false }));
        allowClose = true;
        if (Application.Current?.ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop) desktop.Shutdown(code);
    }
}
