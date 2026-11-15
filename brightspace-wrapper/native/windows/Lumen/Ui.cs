//  Ui.cs — small helpers for building WPF controls in code-behind, plus date formatting.
using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace Lumen;

public static class Fmt
{
    public static int DaysFromToday(DateTime d) => (int)Math.Round((d.Date - DateTime.Now.Date).TotalDays);
    public static string Time(DateTime d) => d.ToString("h:mm tt");
    public static string Day(DateTime d) => d.ToString("ddd, MMM d");
    public static string Short(DateTime d) => d.ToString("MMM d");
    public static string Due(DateTime? due, string prefix = "Due")
    {
        if (due is not DateTime d) return "No due date";
        int n = DaysFromToday(d);
        return n switch {
            0 => $"{prefix} today, {Time(d)}",
            1 => $"{prefix} tomorrow, {Time(d)}",
            -1 => $"{prefix} yesterday, {Time(d)}",
            _ when n is > 1 and < 7 => $"{prefix} {d:dddd}, {Time(d)}",
            _ => $"{prefix} {Day(d)}"
        };
    }
    public static string PlainHtml(string html)
    {
        var s = System.Text.RegularExpressions.Regex.Replace(html, "(?i)<br\\s*/?>", "\n");
        s = System.Text.RegularExpressions.Regex.Replace(s, "(?i)</p>|</li>|</div>|</h[1-6]>", "\n");
        s = System.Text.RegularExpressions.Regex.Replace(s, "(?i)<li[^>]*>", "• ");
        s = System.Text.RegularExpressions.Regex.Replace(s, "<[^>]+>", "");
        s = s.Replace("&nbsp;", " ").Replace("&amp;", "&").Replace("&lt;", "<").Replace("&gt;", ">").Replace("&#39;", "'").Replace("&quot;", "\"");
        return System.Text.RegularExpressions.Regex.Replace(s, "\n{3,}", "\n\n").Trim();
    }
}

public static class Ui
{
    public static TextBlock Text(string s, double size = 14, FontWeight? weight = null, Brush? color = null, double wrap = 0) => new()
    {
        Text = s, FontSize = size, FontWeight = weight ?? FontWeights.Normal,
        Foreground = color ?? (Brush)Application.Current.Resources["Fg"], TextWrapping = wrap > 0 ? TextWrapping.Wrap : TextWrapping.NoWrap,
        MaxWidth = wrap > 0 ? wrap : double.PositiveInfinity, TextTrimming = TextTrimming.CharacterEllipsis
    };

    public static Border Card(UIElement child, double radius = 16, Brush? bg = null) => new()
    {
        CornerRadius = new CornerRadius(radius), Padding = new Thickness(16), Child = child,
        Background = bg ?? (Brush)Application.Current.Resources["Surface2"], Margin = new Thickness(0, 0, 0, 12)
    };

    public static StackPanel VStack(double gap = 8) => new() { Orientation = Orientation.Vertical, Margin = new Thickness(0) };
    public static StackPanel HStack(double gap = 8) => new() { Orientation = Orientation.Horizontal };
}
