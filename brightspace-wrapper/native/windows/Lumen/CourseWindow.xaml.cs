//  CourseWindow.xaml.cs — native course detail: Stream, Classwork, Work, Grades.
using System;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace Lumen;

public partial class CourseWindow : Window
{
    private readonly AppState _state;
    private readonly int _courseId;
    private readonly int _initialTab;

    public CourseWindow(AppState state, int courseId, int tab = 0)
    {
        InitializeComponent();
        _state = state; _courseId = courseId; _initialTab = tab;
        Loaded += (_, _) => Build();
    }

    private void Build()
    {
        var c = _state.Course(_courseId);
        if (c == null) { Root.Children.Add(Ui.Text("Class not found", 16)); return; }
        Title = c.Name;

        var grid = new Grid();
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        var banner = new Border { Height = 120, Background = Palette.Banner(c.Hue, false),
            Child = new StackPanel { Margin = new Thickness(20), VerticalAlignment = VerticalAlignment.Bottom, Children = {
                new TextBlock { Text = c.Name, Foreground = Brushes.White, FontSize = 24, FontWeight = FontWeights.Bold },
                new TextBlock { Text = string.Join(" · ", new[] { c.Code, c.TermLabel }.Where(s => !string.IsNullOrEmpty(s))), Foreground = Brushes.White } } } };
        Grid.SetRow(banner, 0);
        grid.Children.Add(banner);

        var tabs = new TabControl { BorderThickness = new Thickness(0), Background = Brushes.Transparent, Margin = new Thickness(16) };
        tabs.Items.Add(new TabItem { Header = "Stream", Content = Lazy(LoadStream) });
        tabs.Items.Add(new TabItem { Header = "Classwork", Content = Lazy(LoadClasswork) });
        tabs.Items.Add(new TabItem { Header = "Work", Content = WorkTab() });
        tabs.Items.Add(new TabItem { Header = "Grades", Content = Lazy(LoadGrades) });
        tabs.SelectedIndex = _initialTab;
        Grid.SetRow(tabs, 1);
        grid.Children.Add(tabs);

        Root.Children.Add(grid);
    }

    private ScrollViewer Lazy(Func<Panel, Task> load)
    {
        var host = new StackPanel { Margin = new Thickness(4) };
        host.Children.Add(new TextBlock { Text = "Loading…", Foreground = (Brush)Resources["Muted"], Margin = new Thickness(8) });
        _ = LoadInto(host, load);
        return new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Content = host };
    }
    private async Task LoadInto(Panel host, Func<Panel, Task> load)
    {
        try { host.Children.Clear(); await load(host); }
        catch (ApiException e) { host.Children.Clear(); host.Children.Add(Ui.Text(e.IsSignedOut ? "Signed out of Brightspace." : "Couldn’t load.", 14, color: Brushes.IndianRed)); }
        catch (Exception e) { host.Children.Clear(); host.Children.Add(Ui.Text(e.Message, 13, color: Brushes.IndianRed)); }
    }

    private async Task LoadStream(Panel host)
    {
        var news = await _state.Api!.News(_courseId);
        if (news.Count == 0) { host.Children.Add(Ui.Text("No announcements yet.", 14, color: (Brush)Resources["Muted"])); return; }
        foreach (var n in news)
        {
            var sp = new StackPanel();
            sp.Children.Add(Ui.Text(n.Title, 15, FontWeights.SemiBold));
            if (n.Date is DateTime d) sp.Children.Add(Ui.Text(Fmt.Day(d), 12, color: (Brush)Resources["Muted"]));
            sp.Children.Add(new TextBlock { Text = Fmt.PlainHtml(n.Html), TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 6, 0, 0) });
            foreach (var a in n.Attachments)
            {
                var link = new TextBlock { Margin = new Thickness(0, 6, 0, 0), Cursor = System.Windows.Input.Cursors.Hand };
                link.Inlines.Add(new System.Windows.Documents.Run("📎 " + a.Name) { Foreground = (Brush)Resources["Accent"] });
                link.MouseLeftButtonUp += (_, _) => MainWindow.OpenUrl(a.Url);
                sp.Children.Add(link);
            }
            host.Children.Add(Ui.Card(sp));
        }
    }

    private async Task LoadClasswork(Panel host)
    {
        var modules = await _state.Api!.Toc(_courseId);
        if (modules.Count == 0) { host.Children.Add(Ui.Text("No content yet.", 14, color: (Brush)Resources["Muted"])); return; }
        foreach (var m in modules) host.Children.Add(ModuleExpander(m, 0));
    }

    private UIElement ModuleExpander(Module m, int depth)
    {
        var inner = new StackPanel { Margin = new Thickness(depth == 0 ? 8 : 16, 0, 0, 0) };
        foreach (var t in m.Topics)
        {
            var row = new TextBlock { Margin = new Thickness(0, 4, 0, 4), Cursor = System.Windows.Input.Cursors.Hand, TextWrapping = TextWrapping.Wrap };
            row.Inlines.Add(new System.Windows.Documents.Run((t.Unread ? "● " : "") + t.Title) { FontWeight = t.Unread ? FontWeights.SemiBold : FontWeights.Normal });
            row.Inlines.Add(new System.Windows.Documents.Run($"   {t.Kind.Label()}" + (t.Due is DateTime d ? $" · {Fmt.Due(d)}" : "")) { Foreground = (Brush)Resources["Muted"], FontSize = 11 });
            row.MouseLeftButtonUp += (_, _) => MainWindow.OpenUrl(t.Url);
            inner.Children.Add(row);
        }
        foreach (var s in m.Submodules) inner.Children.Add(ModuleExpander(s, depth + 1));
        var exp = new Expander { Header = $"{m.Title}  ({m.TotalCount})" + (m.UnreadCount > 0 ? $"  · {m.UnreadCount} new" : ""), Content = inner, IsExpanded = depth == 0, Margin = new Thickness(0, 2, 0, 2) };
        return depth == 0 ? Ui.Card(exp) : exp;
    }

    private UIElement WorkTab()
    {
        var root = new StackPanel { Margin = new Thickness(4) };
        var items = _state.WorkFor(_courseId).ToList();
        if (items.Count == 0) { root.Children.Add(Ui.Text("No assignments or quizzes.", 14, color: (Brush)Resources["Muted"])); return new ScrollViewer { Content = root }; }
        foreach (var (status, title) in new[] { (WorkStatus.Missing, "Missing"), (WorkStatus.Assigned, "Upcoming"), (WorkStatus.Done, "Done") })
        {
            var list = items.Where(w => _state.Status(w) == status).OrderBy(w => w.Due ?? DateTime.MaxValue).ToList();
            if (list.Count == 0) continue;
            root.Children.Add(Ui.Text($"{title} ({list.Count})", 14, FontWeights.SemiBold));
            var card = new StackPanel();
            foreach (var w in list)
            {
                var row = new TextBlock { Margin = new Thickness(0, 4, 0, 4), Cursor = w.Url != null ? System.Windows.Input.Cursors.Hand : null, TextWrapping = TextWrapping.Wrap };
                row.Inlines.Add(new System.Windows.Documents.Run(w.Title) { FontWeight = FontWeights.Medium });
                row.Inlines.Add(new System.Windows.Documents.Run($"   {Fmt.Due(w.Due)}") { Foreground = (Brush)Resources["Muted"], FontSize = 11 });
                if (w.Url != null) row.MouseLeftButtonUp += (_, _) => MainWindow.OpenUrl(w.Url!);
                card.Children.Add(row);
            }
            root.Children.Add(Ui.Card(card));
        }
        return new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Content = root };
    }

    private async Task LoadGrades(Panel host)
    {
        var g = await _state.Api!.Grades(_courseId);
        if (g.Items.Count == 0 && g.FinalDisplay == null) { host.Children.Add(Ui.Text("No grades released yet.", 14, color: (Brush)Resources["Muted"])); return; }
        var summary = new StackPanel();
        var cur = g.Current;
        summary.Children.Add(Ui.Text(g.FinalDisplay ?? (cur is { } v ? $"{v.value:0.0}%" : "—"), 28, FontWeights.Bold));
        summary.Children.Add(Ui.Text(g.FinalDisplay != null ? "Final grade" : (cur?.weighted == true ? "Current weighted grade" : "Average of released grades"), 13, color: (Brush)Resources["Muted"]));
        host.Children.Add(Ui.Card(summary));
        foreach (var it in g.Items)
        {
            var sp = new StackPanel();
            var dock = new DockPanel();
            var score = Ui.Text(it.Numerator is double n && it.Denominator is double d ? $"{Trim(n)}/{Trim(d)}" : it.Displayed ?? "—", 14, FontWeights.SemiBold);
            DockPanel.SetDock(score, Dock.Right);
            dock.Children.Add(score);
            dock.Children.Add(Ui.Text(it.Name, 14, FontWeights.Medium));
            sp.Children.Add(dock);
            if (it.Weight is double w && w > 0) sp.Children.Add(Ui.Text($"Worth {w:0}%", 12, color: (Brush)Resources["Muted"]));
            if (it.Percent is double p)
            {
                var bar = new Border { Height = 6, CornerRadius = new CornerRadius(3), Background = (Brush)Resources["Surface2"], Margin = new Thickness(0, 4, 0, 0),
                    Child = new Border { HorizontalAlignment = HorizontalAlignment.Left, Width = Math.Min(1, p / 100) * 500, Background = Palette.AccentBrush(_state.Course(_courseId)?.Hue ?? Palette.Seed, false), CornerRadius = new CornerRadius(3) } };
                sp.Children.Add(bar);
            }
            if (it.Comment is string cmt) sp.Children.Add(Ui.Text(cmt, 12, color: (Brush)Resources["Muted"], wrap: 700));
            host.Children.Add(Ui.Card(sp, radius: 12));
        }
    }
    private static string Trim(double v) => v == Math.Floor(v) ? ((int)v).ToString() : v.ToString("0.0");
}
