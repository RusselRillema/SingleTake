using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using SingleTake.Protocol;
using System.Globalization;
using System.Text.RegularExpressions;
namespace SingleTake.Desktop.Rendering;

/// <summary>Native inference, selection, guide and dimension visuals produced by the shared JS tools.</summary>
public sealed class OverlayCanvas : Control
{
    SceneFrame? frame;
    public OverlayCanvas(){IsHitTestVisible=false;ClipToBounds=true;}
    public void SetScene(SceneFrame value){frame=value;InvalidateVisual();}
    public override void Render(DrawingContext context)
    {
        base.Render(context);if(frame is null)return;
        foreach(var shape in frame.Overlay)
        {
            try
            {
                var a=shape.Attributes;double N(string key,double fallback=0)=>a.TryGetValue(key,out var text)&&double.TryParse(text,NumberStyles.Float,CultureInfo.InvariantCulture,out var n)&&double.IsFinite(n)?n:fallback;
                IBrush? B(string key,string fallback)=>Brush(a.GetValueOrDefault(key,fallback));
                var fill=B("fill","none");var stroke=B("stroke","none");Pen? pen=stroke is null?null:new Pen(stroke,Math.Clamp(N("stroke-width",1),.1,12));
                if(pen is not null&&a.TryGetValue("stroke-dasharray",out var dash)&&dash!="none")pen.DashStyle=new DashStyle(Numbers(dash),0);
                switch(shape.Type)
                {
                    case "line":if(pen is not null)context.DrawLine(pen,new Point(N("x1"),N("y1")),new Point(N("x2"),N("y2")));break;
                    case "rect":context.DrawRectangle(fill,pen,new Rect(N("x"),N("y"),Math.Max(0,N("width")),Math.Max(0,N("height"))),N("rx"),N("rx"));break;
                    case "circle":context.DrawEllipse(fill,pen,new Point(N("cx"),N("cy")),Math.Max(0,N("r")),Math.Max(0,N("r")));break;
                    case "polyline":case "polygon":
                        var points=Numbers(a.GetValueOrDefault("points",""));if(points.Length<4)break;var geometry=new StreamGeometry();
                        using(var path=geometry.Open()){path.BeginFigure(new Point(points[0],points[1]),shape.Type=="polygon");for(var i=2;i+1<points.Length;i+=2)path.LineTo(new Point(points[i],points[i+1]));path.EndFigure(shape.Type=="polygon");}
                        context.DrawGeometry(fill,pen,geometry);break;
                    case "path":if(a.TryGetValue("d",out var d))context.DrawGeometry(fill,pen,Geometry.Parse(d));break;
                    case "text":
                        var text=new FormattedText(shape.Text,CultureInfo.InvariantCulture,FlowDirection.LeftToRight,Typeface.Default,Math.Clamp(N("font-size",12),6,64),fill??Brushes.Black);var x=N("x");if(a.GetValueOrDefault("text-anchor")=="middle")x-=text.Width/2;context.DrawText(text,new Point(x,N("y")-text.Height*.8));break;
                }
            }
            catch(FormatException){}catch(ArgumentException){} // A malformed overlay must not bring down the native scene.
        }
        if(frame.Axes)
        {
            // Public drawing coordinates: X = world +X; Y = world -Z; Z = world +Y.
            var axes=new[]{new float[]{1,0,0},new float[]{0,0,-1},new float[]{0,1,0}};var colors=new IBrush[]{Brushes.IndianRed,Brushes.ForestGreen,Brushes.RoyalBlue};
            var center=new Point(Math.Max(48,Bounds.Width-66),64);var m=frame.ViewProjection;
            for(var i=0;i<3;i++){var d=axes[i];var dx=m[0]*d[0]+m[4]*d[1]+m[8]*d[2];var dy=m[1]*d[0]+m[5]*d[1]+m[9]*d[2];var len=Math.Sqrt(dx*dx+dy*dy);if(len<1e-6)len=1;var end=new Point(center.X+dx/len*27,center.Y-dy/len*27);context.DrawLine(new Pen(colors[i],2),center,end);context.DrawText(new FormattedText("XYZ"[i].ToString(),CultureInfo.InvariantCulture,FlowDirection.LeftToRight,Typeface.Default,12,colors[i]),end);}
        }
    }
    static double[] Numbers(string s)=>Regex.Split(s.Trim(),"[ ,]+").Where(x=>x.Length>0).Select(x=>double.Parse(x,CultureInfo.InvariantCulture)).Where(double.IsFinite).ToArray();
    static IBrush? Brush(string text)
    {
        if(text=="none"||text=="transparent")return null;
        if(text.StartsWith("rgba(",StringComparison.Ordinal)){var p=Numbers(text[5..^1]);if(p.Length==4)return new SolidColorBrush(Color.FromArgb((byte)Math.Clamp(p[3]*255,0,255),(byte)Math.Clamp(p[0],0,255),(byte)Math.Clamp(p[1],0,255),(byte)Math.Clamp(p[2],0,255)));}
        return Avalonia.Media.Brush.Parse(text);
    }
}
