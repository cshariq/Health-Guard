//  MainWindow.xaml.cs — native WPF UI (Connect + Classes + To-do + Grades + Settings).
//  The only WebView2 in the app is LoginWindow (the Brightspace sign-in page).

using System;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;
using System.Windows.Navigation;

namespace Lumen;

public partial class MainWindow : Window
{
    private readonly AppState _state = new();

    public MainWindow()
    {
        InitializeComponent();
        if (_state.Connected) { Loaded += async (_, _) => { await Reload(); ShowMain(); }; }
        else ShowConnect();
    }

    private async System.Threading.Tasks.Task Reload()
    {
        try { await _state.Load(force: true); }
        catch (ApiException e) when (e.IsSignedOut) { _state.SignOut(); ShowConnect(); }
        catch { /* leave as-is */ }
    }

    // ---------------- Connect ----------------
    private void ShowConnect()
    {
        var panel = new StackPanel { Margin = new Thickness(40), MaxWidth = 560, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        panel.Children.Add(Ui.Text("Lumen", 32, FontWeights.SemiBold));
        panel.Children.Add(Ui.Text("Brightspace, organized.", 26, FontWeights.Bold));
        panel.Children.Add(new TextBlock { Text = "Sign in on the official Brightspace page. Lumen only reads your data and your login stays on this device.", TextWrapping = TextWrapping.Wrap, Foreground = (Brush)Resources["Muted"], Margin = new Thickness(0, 6, 0, 16) });
        panel.Children.Add(Ui.Text("Choose your school", 15, FontWeights.SemiBold));

        SchoolDef selected = SchoolDef.Catalog[0];
        var list = new StackPanel { Margin = new Thickness(0, 8, 0, 16) };
        foreach (var s in SchoolDef.Catalog)
        {
            var b = SchoolButton(s, s.Id == selected.Id);
            b.Click += (_, _) => { selected = s; foreach (var child in list.Children.OfType<Button>()) child.BorderBrush = Brushes.Transparent; ((Button)b).BorderBrush = (Brush)Resources["Accent"]; };
            list.Children.Add(b);
        }
        panel.Children.Add(list);

        var signIn = new Button { Content = "Sign in with Brightspace", Padding = new Thickness(16, 10, 16, 10), HorizontalAlignment = HorizontalAlignment.Stretch, Background = (Brush)Resources["Accent"], Foreground = Brushes.White, BorderThickness = new Thickness(0), FontWeight = FontWeights.Medium };
        signIn.Click += (_, _) =>
        {
            var login = new LoginWindow(selected.Host) { Owner = this };
            if (login.ShowDialog() == true && login.CookieHeader != null)
            {
                _state.Connect(selected.Host, selected.Name, login.CookieHeader);
                Loaded -= null; _ = ReloadThenShow();
            }
        };
        panel.Children.Add(signIn);
        panel.Children.Add(new TextBlock { Text = "Read-only. Nothing leaves your device.", Foreground = (Brush)Resources["Muted"], FontSize = 12, Margin = new Thickness(0, 10, 0, 0) });

        Root.Children.Clear();
        Root.Children.Add(panel);
    }

    private async System.Threading.Tasks.Task ReloadThenShow() { await Reload(); ShowMain(); }

    private Button SchoolButton(SchoolDef s, bool selected)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal };
        row.Children.Add(new Border { Width = 40, Height = 40, CornerRadius = new CornerRadius(12), Background = Palette.AccentBrush(s.Hue, false), Margin = new Thickness(0, 0, 14, 0),
            Child = new TextBlock { Text = s.Name.Substring(0, 1), Foreground = Brushes.White, FontWeight = FontWeights.SemiBold, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center } });
        var col = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        col.Children.Add(Ui.Text(s.Name, 14, FontWeights.Medium));
        col.Children.Add(Ui.Text(s.Host.Replace("https://", ""), 12, color: (Brush)Resources["Muted"]));
        row.Children.Add(col);
        return new Button { Content = row, HorizontalContentAlignment = HorizontalAlignment.Left, Padding = new Thickness(12), Margin = new Thickness(0, 0, 0, 8),
            Background = (Brush)Resources["Surface2"], BorderBrush = selected ? (Brush)Resources["Accent"] : Brushes.Transparent, BorderThickness = new Thickness(2) };
    }

    // ---------------- Main ----------------
    private void ShowMain()
    {
        var tabs = new TabControl { Background = Brushes.Transparent, BorderThickness = new Thickness(0), Margin = new Thickness(0) };
        tabs.Items.Add(new TabItem { Header = "Classes", Content = Scroll(ClassesView()) });
        tabs.Items.Add(new TabItem { Header = "To-do", Content = Scroll(ToDoView()) });
        tabs.Items.Add(new TabItem { Header = "Grades", Content = Scroll(GradesView()) });
        tabs.Items.Add(new TabItem { Header = "Settings", Content = Scroll(SettingsView()) });

        var top = new DockPanel { Margin = new Thickness(20, 16, 20, 0) };
        var refresh = new Button { Content = "⟳ Refresh", Padding = new Thickness(12, 6, 12, 6) };
        refresh.Click += async (_, _) => { await Reload(); ShowMain(); };
        DockPanel.SetDock(refresh, Dock.Right);
        top.Children.Add(refresh);
        top.Children.Add(Ui.Text(_state.Me is { } m ? $"Hi, {m.FirstName}" : "Lumen", 22, FontWeights.Bold));

        var grid = new Grid();
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        Grid.SetRow(top, 0); Grid.SetRow(tabs, 1);
        grid.Children.Add(top); grid.Children.Add(tabs);

        Root.Children.Clear();
        Root.Children.Add(grid);
    }

    private static ScrollViewer Scroll(UIElement child) => new() { VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Content = new Border { Padding = new Thickness(20), Child = child }, Background = Brushes.Transparent };

    private UIElement ClassesView()
    {
        var wrap = new WrapPanel();
        var shown = _state.CurrentCourses.OrderBy(c => c.Pinned ? 0 : 1).ThenBy(c => c.Name).ToList();
        if (shown.Count == 0) return Ui.Text("No current classes.", 14, color: (Brush)Resources["Muted"]);
        foreach (var c in shown) wrap.Children.Add(CourseCard(c));
        return wrap;
    }

    private UIElement CourseCard(Course c)
    {
        var body = new StackPanel();
        var banner = new Border { Height = 92, CornerRadius = new CornerRadius(16, 16, 0, 0), Background = Palette.Banner(c.Hue, false),
            Child = new StackPanel { Margin = new Thickness(14), VerticalAlignment = VerticalAlignment.Center, Children = {
                new TextBlock { Text = c.Name, Foreground = Brushes.White, FontSize = 16, FontWeight = FontWeights.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis },
                new TextBlock { Text = string.Join(" · ", new[] { c.Code, c.TermLabel }.Where(s => !string.IsNullOrEmpty(s))), Foreground = new SolidColorBrush(Color.FromArgb(230,255,255,255)), FontSize = 12 } } } };
        body.Children.Add(banner);

        var inner = new StackPanel { Margin = new Thickness(14) };
        var due = _state.WorkFor(c.Id).Where(w => _state.Status(w) == WorkStatus.Assigned && w.Due is DateTime d && Fmt.DaysFromToday(d) <= 14).OrderBy(w => w.Due).Take(3).ToList();
        if (due.Count == 0) inner.Children.Add(Ui.Text("No work due soon", 12, color: (Brush)Resources["Muted"]));
        foreach (var w in due) inner.Children.Add(Ui.Text($"{(w.Due is DateTime dd ? (Fmt.DaysFromToday(dd) <= 0 ? "Today" : Fmt.Short(dd)) : "")}  —  {w.Title}", 12, wrap: 230));
        int missing = _state.WorkFor(c.Id).Count(w => _state.Status(w) == WorkStatus.Missing);
        if (missing > 0) inner.Children.Add(Ui.Text($"⚠ {missing} missing", 12, color: Brushes.IndianRed));
        body.Children.Add(inner);

        var card = new Border { Width = 300, Margin = new Thickness(0, 0, 16, 16), CornerRadius = new CornerRadius(16), BorderBrush = (Brush)Resources["Outline"], BorderThickness = new Thickness(1), Child = body, Cursor = System.Windows.Input.Cursors.Hand };
        card.MouseLeftButtonUp += (_, _) => { var w = new CourseWindow(_state, c.Id) { Owner = this }; w.Show(); };
        return card;
    }

    private UIElement ToDoView()
    {
        var root = new StackPanel();
        foreach (var (status, title) in new[] { (WorkStatus.Missing, "Missing"), (WorkStatus.Assigned, "Upcoming"), (WorkStatus.Done, "Done") })
        {
            var items = _state.Work.Where(w => _state.Status(w) == status)
                .OrderBy(w => status == WorkStatus.Missing ? -(w.Due?.Ticks ?? 0) : (w.Due?.Ticks ?? long.MaxValue)).ToList();
            if (items.Count == 0) continue;
            root.Children.Add(Ui.Text($"{title} ({items.Count})", 15, FontWeights.SemiBold));
            var card = new StackPanel();
            foreach (var w in items) card.Children.Add(WorkRow(w, showCourse: true));
            root.Children.Add(Ui.Card(card));
        }
        if (root.Children.Count == 0) return Ui.Text("No work yet.", 14, color: (Brush)Resources["Muted"]);
        return root;
    }

    private UIElement WorkRow(WorkItem w, bool showCourse)
    {
        var status = _state.Status(w);
        var c = _state.Course(w.CourseId); var hue = c?.Hue ?? Palette.Seed;
        var dock = new DockPanel { Margin = new Thickness(0, 4, 0, 4) };

        var check = new Button { Content = status == WorkStatus.Done ? "☑" : "☐", BorderThickness = new Thickness(0), Background = Brushes.Transparent, FontSize = 18, Foreground = status == WorkStatus.Done ? Brushes.SeaGreen : (Brush)Resources["Muted"], Cursor = System.Windows.Input.Cursors.Hand };
        check.Click += (_, _) => { _state.ToggleDone(w); ShowMain(); };
        DockPanel.SetDock(check, Dock.Right);
        dock.Children.Add(check);

        var dueText = Ui.Text(status == WorkStatus.Missing ? Fmt.Due(w.Due, "Was due") : status == WorkStatus.Done ? "Done" : Fmt.Due(w.Due), 12, color: status == WorkStatus.Missing ? Brushes.IndianRed : (Brush)Resources["Muted"]);
        DockPanel.SetDock(dueText, Dock.Right);
        dueText.Margin = new Thickness(8, 0, 8, 0); dueText.VerticalAlignment = VerticalAlignment.Center;
        dock.Children.Add(dueText);

        var icon = new Border { Width = 36, Height = 36, CornerRadius = new CornerRadius(18), Background = status == WorkStatus.Done ? (Brush)Resources["Surface2"] : Palette.AccentBrush(hue, false), Margin = new Thickness(0, 0, 12, 0),
            Child = new TextBlock { Text = "•", Foreground = Brushes.White, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center } };
        DockPanel.SetDock(icon, Dock.Left);
        dock.Children.Add(icon);

        var col = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        col.Children.Add(Ui.Text(w.Title, 14, FontWeights.Medium));
        col.Children.Add(Ui.Text((showCourse && c != null ? $"{(string.IsNullOrEmpty(c.Code) ? c.Name : c.Code)} · " : "") + w.Kind.Label(), 12, color: (Brush)Resources["Muted"]));
        dock.Children.Add(col);

        if (w.Url != null) { dock.Cursor = System.Windows.Input.Cursors.Hand; dock.MouseLeftButtonUp += (_, e) => { if (e.OriginalSource is not Button) OpenUrl(w.Url); }; }
        return dock;
    }

    private UIElement GradesView()
    {
        var root = new StackPanel();
        root.Children.Add(Ui.Text("Released grades across your current classes.", 13, color: (Brush)Resources["Muted"]));
        foreach (var c in _state.CurrentCourses)
        {
            var card = Ui.Card(new StackPanel { Children = { Ui.Text(c.Name, 15, FontWeights.Medium), Ui.Text(c.Code, 12, color: (Brush)Resources["Muted"]), Ui.Text("Open the class for the full breakdown.", 12, color: (Brush)Resources["Muted"]) } });
            card.Cursor = System.Windows.Input.Cursors.Hand;
            card.MouseLeftButtonUp += (_, _) => { var w = new CourseWindow(_state, c.Id, tab: 3) { Owner = this }; w.Show(); };
            root.Children.Add(card);
        }
        return root;
    }

    private UIElement SettingsView()
    {
        var root = new StackPanel();
        root.Children.Add(Ui.Text("Account", 16, FontWeights.SemiBold));
        if (_state.Me is { } m) root.Children.Add(Ui.Text($"{m.FirstName} {m.LastName}", 14));
        root.Children.Add(Ui.Text(_state.SchoolName, 13, color: (Brush)Resources["Muted"]));
        var signOut = new Button { Content = "Disconnect", Padding = new Thickness(12, 6, 12, 6), Margin = new Thickness(0, 8, 0, 16), HorizontalAlignment = HorizontalAlignment.Left };
        signOut.Click += (_, _) => { _state.SignOut(); ShowConnect(); };
        root.Children.Add(signOut);
        root.Children.Add(new TextBlock { Text = "Lumen reads your classes from Brightspace using the login on this device. It only reads — it never submits or changes anything.", TextWrapping = TextWrapping.Wrap, FontSize = 12, Foreground = (Brush)Resources["Muted"], MaxWidth = 520, HorizontalAlignment = HorizontalAlignment.Left });
        return root;
    }

    internal static void OpenUrl(string url)
    {
        try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
    }
}
