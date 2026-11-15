//  AppState.cs — connection, loaded data, "done" ticks and settings (persisted to LocalAppData).

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;

namespace Lumen;

public record SchoolDef(string Id, string Name, string Host, double Hue)
{
    public static readonly SchoolDef[] Catalog = {
        new("carleton", "Carleton University", "https://brightspace.carleton.ca", 25),
        new("uwaterloo", "University of Waterloo", "https://learn.uwaterloo.ca", 85),
    };
}

public class AppState
{
    private class Persisted { public string? Host { get; set; } public string? SchoolName { get; set; } public string? Cookie { get; set; } public string Theme { get; set; } = "system"; public Dictionary<string, bool> Done { get; set; } = new(); public List<int> Hidden { get; set; } = new(); }

    private static readonly string Dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Lumen");
    private static readonly string File = Path.Combine(Dir, "state.json");
    private Persisted _p = new();

    public BrightspaceApi? Api { get; private set; }
    public Me? Me;
    public List<Course> Courses = new();
    public List<WorkItem> Work = new();

    public string? Host => _p.Host;
    public string SchoolName => _p.SchoolName ?? "";
    public bool Connected => _p.Host != null;
    public string Theme { get => _p.Theme; set { _p.Theme = value; Save(); } }

    public AppState()
    {
        try { if (System.IO.File.Exists(File)) _p = JsonSerializer.Deserialize<Persisted>(System.IO.File.ReadAllText(File)) ?? new(); } catch { }
        if (_p.Host != null) Api = new BrightspaceApi(_p.Host, _ => Task.FromResult(_p.Cookie ?? ""));
    }

    private void Save() { try { Directory.CreateDirectory(Dir); System.IO.File.WriteAllText(File, JsonSerializer.Serialize(_p)); } catch { } }

    public void Connect(string host, string schoolName, string cookieHeader)
    {
        _p.Host = host; _p.SchoolName = schoolName; _p.Cookie = cookieHeader; Save();
        Api = new BrightspaceApi(host, _ => Task.FromResult(_p.Cookie ?? ""));
    }
    public void SignOut() { _p.Host = null; _p.Cookie = null; Api = null; Me = null; Courses.Clear(); Work.Clear(); Save(); }

    public async Task Load(bool force = false)
    {
        if (Api is not { } api) return;
        if (force) api.ClearCache();
        try { Me = await api.Whoami(); } catch { Me = null; }
        Courses = await api.Courses();
        var ids = CurrentCourses.Select(c => c.Id).ToList();
        Work = Dedupe(await api.WorkItems(ids));
    }

    private static List<WorkItem> Dedupe(List<WorkItem> items)
    {
        var seen = new HashSet<string>(); var outl = new List<WorkItem>();
        foreach (var w in items) if (seen.Add($"{w.CourseId}:{w.Kind}:{w.Title}:{w.Due?.Ticks ?? 0}")) outl.Add(w);
        return outl;
    }

    public IEnumerable<Course> VisibleCourses => Courses.Where(c => !_p.Hidden.Contains(c.Id));
    public IEnumerable<Course> CurrentCourses => VisibleCourses.Where(c => c.IsCurrent);
    public Course? Course(int id) => Courses.FirstOrDefault(c => c.Id == id);
    public IEnumerable<WorkItem> WorkFor(int id) => Work.Where(w => w.CourseId == id);

    public WorkStatus Status(WorkItem w) => w.Status(_p.Done.TryGetValue(w.Id, out var o) ? o : (bool?)null);
    public void ToggleDone(WorkItem w)
    {
        bool now = Status(w) != WorkStatus.Done;
        if (now == w.Completed) _p.Done.Remove(w.Id); else _p.Done[w.Id] = now;
        Save();
    }
    public bool IsHidden(int id) => _p.Hidden.Contains(id);
    public void SetHidden(int id, bool v) { if (v) { if (!_p.Hidden.Contains(id)) _p.Hidden.Add(id); } else _p.Hidden.Remove(id); Save(); }
}
