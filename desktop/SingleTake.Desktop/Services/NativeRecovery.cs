using System.Text;
using System.Text.Json;

namespace SingleTake.Desktop.Services;

/// <summary>App-owned recovery file. No path from JavaScript can select an arbitrary file.</summary>
internal static class NativeRecovery
{
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static readonly string Folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SingleTake");
    private static readonly string FilePath = Path.Combine(Folder, "workspace-recovery.json");
    private const int MaxBytes = 128 * 1024 * 1024;
    public static async Task<string?> LoadAsync(CancellationToken ct)
    {
        await Gate.WaitAsync(ct);
        try {
            if (!File.Exists(FilePath)) return null;
            if (new FileInfo(FilePath).Length > MaxBytes) throw new InvalidDataException("Recovery file exceeds the size limit.");
            return await File.ReadAllTextAsync(FilePath, ct);
        } finally { Gate.Release(); }
    }
    public static async Task SaveAsync(string data, CancellationToken ct)
    {
        if (Encoding.UTF8.GetByteCount(data) > MaxBytes) throw new InvalidDataException("Recovery data exceeds 128 MiB.");
        using (var json = JsonDocument.Parse(data)) {
            if (json.RootElement.GetProperty("schema").GetInt32() != 1 || json.RootElement.GetProperty("project").ValueKind != JsonValueKind.String)
                throw new InvalidDataException("Invalid recovery envelope.");
        }
        await Gate.WaitAsync(ct);
        var temp = FilePath + ".tmp";
        try { Directory.CreateDirectory(Folder); await File.WriteAllTextAsync(temp, data, ct); ct.ThrowIfCancellationRequested(); File.Move(temp, FilePath, true); }
        finally { try { if (File.Exists(temp)) File.Delete(temp); } finally { Gate.Release(); } }
    }
    public static async Task ClearAsync(CancellationToken ct)
    {
        await Gate.WaitAsync(ct); try { if (File.Exists(FilePath)) File.Delete(FilePath); } finally { Gate.Release(); }
    }
}
