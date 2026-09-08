namespace SingleTake.Protocol;

public sealed record NativeInput
{
    public string Kind { get; init; } = "";
    public double X { get; init; }
    public double Y { get; init; }
    public double Width { get; init; }
    public double Height { get; init; }
    public double DeltaY { get; init; }
    public int Button { get; init; }
    public int Buttons { get; init; }
    public string Key { get; init; } = "";
    public bool ShiftKey { get; init; }
    public bool CtrlKey { get; init; }
    public bool AltKey { get; init; }
    public bool MetaKey { get; init; }
    public bool Repeat { get; init; }
    public string Action { get; init; } = "";
}
/// <summary>Coalesce adjacent motion only; never drop a down/up/key boundary.</summary>
public sealed class InputQueue
{
    readonly List<NativeInput> items=[];
    public int Count=>items.Count;
    public void Add(NativeInput input)
    {
        if(items.Count>0 && (input.Kind is "move" or "resize") && items[^1].Kind==input.Kind){items[^1]=input;return;}
        if(items.Count>=512)throw new InvalidOperationException("Native input queue overflow. Reset input state before continuing.");
        items.Add(input);
    }
    public NativeInput[] Drain(){var batch=items.ToArray();items.Clear();return batch;}
    public void Clear()=>items.Clear();
}
