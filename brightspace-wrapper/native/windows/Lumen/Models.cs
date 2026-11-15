//  Models.cs — plain models + the native, read-only Valence API client (HttpClient).
//  Auth is the Brightspace session cookie captured by LoginWindow's WebView2. Native
//  HTTP isn't bound by the browser's CORS rules, so this works where a website can't.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;

namespace Lumen;

public enum WorkKind { Assignment, Quiz, Discussion, Survey, Content, Pdf, Slides, Sheet, Image, Video, Meeting, Link, Doc }
public enum WorkStatus { Assigned, Missing, Done }

public static class KindLabels
{
    public static string Label(this WorkKind k) => k switch {
        WorkKind.Assignment => "Assignment", WorkKind.Quiz => "Quiz", WorkKind.Discussion => "Discussion",
        WorkKind.Survey => "Survey", WorkKind.Pdf => "PDF", WorkKind.Slides => "Slides", WorkKind.Sheet => "Spreadsheet",
        WorkKind.Image => "Image", WorkKind.Video => "Video", WorkKind.Meeting => "Meeting", WorkKind.Link => "Link",
        WorkKind.Content => "Material", _ => "Document"
    };
}

public record Me(string FirstName, string LastName, string UniqueName);

public class Course
{
    public int Id; public string Name = ""; public string Code = "";
    public DateTime? Start; public DateTime? End; public bool Pinned; public bool HasImage;

    public double Hue => Palette.Hue(string.IsNullOrEmpty(Code) ? Name : Code);
    public string TermLabel {
        get {
            if (Start is not DateTime d) return "Other";
            int y = d.Year, mo = d.Month;
            return mo >= 9 ? $"Fall {y}" : mo >= 5 ? $"Summer {y}" : $"Winter {y}";
        }
    }
    public int TermSort {
        get { if (Start is not DateTime d) return 0; return d.Year * 10 + (d.Month >= 9 ? 3 : d.Month >= 5 ? 2 : 1); }
    }
    public bool IsCurrent {
        get {
            var now = DateTime.UtcNow;
            if (Start is DateTime s && s > now.AddDays(21)) return false;
            if (End is DateTime e && e < now.AddDays(-7)) return false;
            return true;
        }
    }
}

public class WorkItem
{
    public string Id = ""; public int CourseId; public WorkKind Kind; public string Title = "";
    public DateTime? Due; public string? Url; public bool Completed;
    public WorkStatus Status(bool? doneOverride)
    {
        if (doneOverride ?? Completed) return WorkStatus.Done;
        if (Due is DateTime d && d < DateTime.Now) return WorkStatus.Missing;
        return WorkStatus.Assigned;
    }
}

public record Attachment(string Name, string Url);
public class Announcement { public int Id; public string Title = ""; public string Html = ""; public DateTime? Date; public List<Attachment> Attachments = new(); }
public class Topic { public int Id; public string Title = ""; public WorkKind Kind; public string Url = ""; public bool Unread; public DateTime? Due; public bool Locked; }
public class Module { public int Id; public string Title = ""; public string DescriptionHtml = ""; public List<Module> Submodules = new(); public List<Topic> Topics = new();
    public int TotalCount => Topics.Count + Submodules.Sum(s => s.TotalCount);
    public int UnreadCount => Topics.Count(t => t.Unread) + Submodules.Sum(s => s.UnreadCount);
}
public class GradeItem { public string Id = ""; public string Name = ""; public string? Displayed; public double? Numerator; public double? Denominator; public double? Weight; public double? WeightedAchieved; public string? Comment;
    public double? Percent => Numerator is double n && Denominator is double d && d > 0 ? n / d * 100 : null;
}
public class Grades {
    public List<GradeItem> Items = new(); public string? FinalDisplay; public double? FinalPercent;
    public (double value, bool weighted)? Current {
        get {
            var graded = Items.Where(i => i.Percent != null).ToList();
            if (graded.Count == 0) return null;
            var w = graded.Where(i => (i.Weight ?? 0) > 0 && i.WeightedAchieved != null).ToList();
            if (w.Count == graded.Count) { var t = w.Sum(i => i.Weight ?? 0); return t > 0 ? (w.Sum(i => i.WeightedAchieved ?? 0) / t * 100, true) : null; }
            return (graded.Average(i => i.Percent ?? 0), false);
        }
    }
}

public class ApiException : Exception
{
    public enum K { SignedOut, Http, Network }
    public K Kind; public int Code;
    public ApiException(K kind, int code = 0, string msg = "") : base(msg) { Kind = kind; Code = code; }
    public bool IsSignedOut => Kind == K.SignedOut;
}

public class BrightspaceApi
{
    private readonly string _host;
    private readonly Func<string, Task<string>> _cookieProvider;   // host -> "Cookie" header
    private static readonly HttpClient Http = new(new HttpClientHandler { UseCookies = false, AllowAutoRedirect = false });
    private readonly Dictionary<string, string> _versions = new();
    private readonly Dictionary<string, (DateTime, JsonElement)> _cache = new();

    public BrightspaceApi(string host, Func<string, Task<string>> cookieProvider)
    { _host = host.TrimEnd('/'); _cookieProvider = cookieProvider; }

    public void ClearCache() => _cache.Clear();

    private async Task<JsonElement> GetJson(string path, bool useCache = true)
    {
        if (useCache && _cache.TryGetValue(path, out var hit) && (DateTime.Now - hit.Item1).TotalSeconds < 300) return hit.Item2;
        using var req = new HttpRequestMessage(HttpMethod.Get, _host + path);
        req.Headers.TryAddWithoutValidation("Accept", "application/json");
        var cookie = await _cookieProvider(_host);
        if (!string.IsNullOrEmpty(cookie)) req.Headers.TryAddWithoutValidation("Cookie", cookie);
        HttpResponseMessage res;
        try { res = await Http.SendAsync(req); }
        catch (Exception e) { throw new ApiException(ApiException.K.Network, 0, e.Message); }
        var type = res.Content.Headers.ContentType?.ToString() ?? "";
        int code = (int)res.StatusCode;
        if (code is 401 or 403) throw new ApiException(ApiException.K.SignedOut);
        if (code is >= 300 and < 400 || type.Contains("text/html")) throw new ApiException(ApiException.K.SignedOut);
        if (code is < 200 or >= 300) throw new ApiException(ApiException.K.Http, code);
        var text = await res.Content.ReadAsStringAsync();
        var el = JsonDocument.Parse(text).RootElement.Clone();
        if (useCache) _cache[path] = (DateTime.Now, el);
        return el;
    }

    private async Task<string> Version(string product)
    {
        if (_versions.TryGetValue(product, out var v)) return v;
        try {
            var list = await GetJson("/d2l/api/versions/");
            foreach (var e in list.EnumerateArray())
                _versions[e.GetProperty("ProductCode").GetString()!] = e.GetProperty("LatestVersion").GetString()!;
        } catch { /* ignore */ }
        return _versions.TryGetValue(product, out var vv) ? vv : (product == "lp" ? "1.35" : "1.60");
    }
    private async Task<string> Lp(string p) => $"/d2l/api/lp/{await Version("lp")}{p}";
    private async Task<string> Le(string p) => $"/d2l/api/le/{await Version("le")}{p}";

    public async Task<Me> Whoami()
    {
        var d = await GetJson(await Lp("/users/whoami"));
        return new Me(Str(d, "FirstName"), Str(d, "LastName"), Str(d, "UniqueName"));
    }

    public async Task<List<Course>> Courses()
    {
        string? path = await Lp("/enrollments/myenrollments/?orgUnitTypeId=3&sortBy=-StartDate");
        var items = new List<JsonElement>(); int guard = 0;
        while (path != null && guard++ < 15)
        {
            var page = await GetJson(path);
            if (page.TryGetProperty("Items", out var arr)) items.AddRange(arr.EnumerateArray());
            if (page.TryGetProperty("PagingInfo", out var pi) && pi.TryGetProperty("HasMoreItems", out var more) && more.GetBoolean()
                && pi.TryGetProperty("Bookmark", out var bm) && !string.IsNullOrEmpty(bm.GetString()))
                path = await Lp($"/enrollments/myenrollments/?orgUnitTypeId=3&sortBy=-StartDate&bookmark={Uri.EscapeDataString(bm.GetString()!)}");
            else path = null;
        }
        var list = new List<Course>();
        foreach (var e in items)
        {
            if (!e.TryGetProperty("OrgUnit", out var ou)) continue;
            var access = e.TryGetProperty("Access", out var a) ? a : default;
            if (access.ValueKind == JsonValueKind.Object && access.TryGetProperty("CanAccess", out var can) && can.ValueKind == JsonValueKind.False) continue;
            list.Add(new Course {
                Id = Int(ou, "Id"), Name = Str(ou, "Name", "Course"), Code = Str(ou, "Code"),
                Start = Date(access, "StartDate"), End = Date(access, "EndDate"),
                Pinned = e.TryGetProperty("PinSettings", out var ps) && ps.TryGetProperty("IsPinned", out var ip) && ip.ValueKind == JsonValueKind.True,
                HasImage = ou.TryGetProperty("ImageUrl", out var im) && im.ValueKind != JsonValueKind.Null,
            });
        }
        return list;
    }

    public async Task<List<Announcement>> News(int ou)
    {
        var list = await GetJson(await Le($"/{ou}/news/"));
        var res = new List<Announcement>();
        foreach (var n in list.EnumerateArray())
        {
            if (Bool(n, "IsHidden")) continue;
            var atts = new List<Attachment>();
            if (n.TryGetProperty("Attachments", out var aa))
                foreach (var a in aa.EnumerateArray())
                    atts.Add(new Attachment(Str(a, "FileName", "file"), $"{_host}/d2l/le/news/{ou}/{Int(n, "Id")}/attachment/{(a.TryGetProperty("FileId", out var fid) ? fid.ToString() : "")}"));
            res.Add(new Announcement { Id = Int(n, "Id"), Title = Str(n, "Title"), Html = Rich(n, "Body"),
                Date = Date(n, "StartDate") ?? Date(n, "CreatedDate"), Attachments = atts });
        }
        return res.OrderByDescending(a => a.Date ?? DateTime.MinValue).ToList();
    }

    public async Task<List<Module>> Toc(int ou)
    {
        var data = await GetJson(await Le($"/{ou}/content/toc"));
        Module Map(JsonElement m)
        {
            var mod = new Module { Id = Int(m, "ModuleId"), Title = Str(m, "Title"), DescriptionHtml = Rich(m, "Description") };
            if (m.TryGetProperty("Modules", out var subs)) foreach (var s in subs.EnumerateArray()) if (!Bool(s, "IsHidden")) mod.Submodules.Add(Map(s));
            if (m.TryGetProperty("Topics", out var tops)) foreach (var t in tops.EnumerateArray()) {
                if (Bool(t, "IsHidden")) continue;
                mod.Topics.Add(new Topic { Id = Int(t, "TopicId"), Title = Str(t, "Title"),
                    Kind = Classify.Topic(Str(t, "Url"), Str(t, "TypeIdentifier")),
                    Url = $"{_host}/d2l/le/content/{ou}/viewContent/{Int(t, "TopicId")}/View",
                    Unread = Bool(t, "Unread"), Due = Date(t, "DueDateTime"), Locked = Bool(t, "IsLocked") });
            }
            return mod;
        }
        var list = new List<Module>();
        if (data.TryGetProperty("Modules", out var ms)) foreach (var m in ms.EnumerateArray()) if (!Bool(m, "IsHidden")) list.Add(Map(m));
        return list;
    }

    public async Task<Grades> Grades(int ou)
    {
        JsonElement? values = null, final = null;
        try { values = await GetJson(await Le($"/{ou}/grades/values/myGradeValues/")); } catch { }
        try { final = await GetJson(await Le($"/{ou}/grades/final/values/myGradeValue")); } catch { }
        var g = new Grades();
        if (values is JsonElement v && v.ValueKind == JsonValueKind.Array)
            foreach (var x in v.EnumerateArray())
                g.Items.Add(new GradeItem {
                    Id = Str(x, "GradeObjectIdentifier", Guid.NewGuid().ToString()), Name = Str(x, "GradeObjectName"),
                    Displayed = NullIfEmpty(Str(x, "DisplayedGrade")),
                    Numerator = Num(x, "PointsNumerator"), Denominator = Num(x, "PointsDenominator"),
                    Weight = Num(x, "WeightedDenominator"), WeightedAchieved = Num(x, "WeightedNumerator"),
                    Comment = NullIfEmpty(Rich(x, "Comments"))
                });
        if (final is JsonElement f && f.ValueKind == JsonValueKind.Object)
        {
            g.FinalDisplay = NullIfEmpty(Str(f, "DisplayedGrade"));
            if (Num(f, "PointsNumerator") is double n && Num(f, "PointsDenominator") is double d && d > 0) g.FinalPercent = n / d * 100;
        }
        return g;
    }

    public async Task<List<WorkItem>> WorkItems(List<int> courseIds)
    {
        if (courseIds.Count == 0) return new();
        string start = DateTime.UtcNow.AddDays(-45).ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture);
        string end = DateTime.UtcNow.AddDays(120).ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture);
        var path = await Le($"/content/myItems/?orgUnitIdsCSV={string.Join(",", courseIds)}&startDateTime={start}&endDateTime={end}");
        try {
            var objs = await GetJson(path);
            var outList = new List<WorkItem>();
            if (objs.TryGetProperty("Objects", out var arr))
                foreach (var it in arr.EnumerateArray()) {
                    var kind = Classify.Scheduled(Str(it, "ItemUrl"));
                    int oid = Int(it, "OrgUnitId");
                    bool completed = (it.TryGetProperty("DateCompleted", out var dc) && dc.ValueKind != JsonValueKind.Null) || Bool(it, "IsExempt");
                    outList.Add(new WorkItem { Id = $"s:{oid}:{Int(it, "ItemId")}:{kind}", CourseId = oid, Kind = kind, Title = Str(it, "ItemName"),
                        Due = Date(it, "DueDate") ?? Date(it, "EndDate"),
                        Url = NullIfEmpty(Str(it, "ItemUrl")) is string u ? _host + u : null, Completed = completed });
                }
            return outList;
        } catch (ApiException) { throw; } catch { }
        // Fallback: assignments + quizzes.
        var res = new List<WorkItem>();
        foreach (var ou in courseIds)
        {
            try { var folders = await GetJson(await Le($"/{ou}/dropbox/folders/"));
                foreach (var ff in folders.EnumerateArray()) { if (Bool(ff, "IsHidden")) continue;
                    res.Add(new WorkItem { Id = $"a:{ou}:{Int(ff, "Id")}", CourseId = ou, Kind = WorkKind.Assignment, Title = Str(ff, "Name"),
                        Due = Date(ff, "DueDate"), Url = $"{_host}/d2l/lms/dropbox/user/folder_submit_files.d2l?db={Int(ff, "Id")}&ou={ou}" }); }
            } catch { }
            try { var q = await GetJson(await Le($"/{ou}/quizzes/"));
                if (q.TryGetProperty("Objects", out var arr)) foreach (var quiz in arr.EnumerateArray())
                    res.Add(new WorkItem { Id = $"q:{ou}:{Int(quiz, "QuizId")}", CourseId = ou, Kind = WorkKind.Quiz, Title = Str(quiz, "Name"),
                        Due = Date(quiz, "DueDate") ?? Date(quiz, "EndDate"), Url = $"{_host}/d2l/lms/quizzing/user/quiz_summary.d2l?qi={Int(quiz, "QuizId")}&ou={ou}" });
            } catch { }
        }
        return res;
    }

    // ---- JSON helpers ----
    private static string Str(JsonElement e, string k, string def = "") => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? def : def;
    private static int Int(JsonElement e, string k) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(k, out var v) && v.TryGetInt32(out var i) ? i : 0;
    private static bool Bool(JsonElement e, string k) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.True;
    private static double? Num(JsonElement e, string k) { if (e.ValueKind == JsonValueKind.Object && e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out var d)) return d; return null; }
    private static DateTime? Date(JsonElement e, string k) { var s = Str(e, k); return DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var d) ? d.ToLocalTime() : null; }
    private static string Rich(JsonElement e, string k) { if (e.ValueKind == JsonValueKind.Object && e.TryGetProperty(k, out var o) && o.ValueKind == JsonValueKind.Object) { var h = Str(o, "Html"); return string.IsNullOrEmpty(h) ? Str(o, "Text") : h; } return ""; }
    private static string? NullIfEmpty(string s) => string.IsNullOrEmpty(s) ? null : s;
}

public static class Classify
{
    public static WorkKind Topic(string url, string typeId)
    {
        var u = url.ToLowerInvariant();
        if (u.Contains("quiz")) return WorkKind.Quiz;
        if (u.Contains("dropbox")) return WorkKind.Assignment;
        if (u.Contains("discussion")) return WorkKind.Discussion;
        if (System.Text.RegularExpressions.Regex.IsMatch(u, @"\.pdf($|\?)")) return WorkKind.Pdf;
        if (System.Text.RegularExpressions.Regex.IsMatch(u, @"\.(pptx?|key)($|\?)")) return WorkKind.Slides;
        if (System.Text.RegularExpressions.Regex.IsMatch(u, @"\.(xlsx?|csv)($|\?)")) return WorkKind.Sheet;
        if (System.Text.RegularExpressions.Regex.IsMatch(u, @"\.(png|jpe?g|gif|svg|webp)($|\?)")) return WorkKind.Image;
        if (System.Text.RegularExpressions.Regex.IsMatch(u, @"\.(mp4|mov|webm|m4v)($|\?)|youtube|youtu\.be|vimeo|kaltura|mediaspace")) return WorkKind.Video;
        if (u.Contains("zoom.us") || u.Contains("teams.microsoft")) return WorkKind.Meeting;
        if (typeId.ToLowerInvariant() == "link" || u.StartsWith("http")) return WorkKind.Link;
        return WorkKind.Doc;
    }
    public static WorkKind Scheduled(string url)
    {
        var u = url.ToLowerInvariant();
        if (u.Contains("dropbox") || u.Contains("assignment")) return WorkKind.Assignment;
        if (u.Contains("quiz")) return WorkKind.Quiz;
        if (u.Contains("discussion")) return WorkKind.Discussion;
        if (u.Contains("survey")) return WorkKind.Survey;
        return WorkKind.Content;
    }
}
