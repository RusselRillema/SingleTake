using Avalonia.Threading;
namespace SingleTake.Desktop.Services;
internal static class UiThread
{
    public static Task<T> Run<T>(Func<Task<T>> operation)
    {
        var completion=new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        Dispatcher.UIThread.Post(async()=>{try{completion.TrySetResult(await operation());}catch(OperationCanceledException){completion.TrySetCanceled();}catch(Exception ex){completion.TrySetException(ex);}});
        return completion.Task;
    }
}
