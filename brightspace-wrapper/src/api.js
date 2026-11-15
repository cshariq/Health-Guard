/*
 * Thin client for the Brightspace (D2L Valence) REST API.
 * Runs on the Brightspace origin, so requests reuse the student's existing
 * login session — no API keys, no passwords, nothing leaves the browser.
 * Read-only: Lumen never writes to Brightspace.
 */
(function () {
  const L = (window.Lumen = window.Lumen || {});

  class ApiError extends Error {
    constructor(status, path) {
      super(`Brightspace returned ${status} for ${path}`);
      this.status = status;
      this.path = path;
    }
  }
  L.ApiError = ApiError;

  const DEFAULT_VERSIONS = { lp: '1.35', le: '1.60' };
  const TTL = 5 * 60 * 1000;

  L.createApi = function (opts = {}) {
    const base = opts.base || '';
    // Where course banner images load from: Brightspace itself (extension), a proxy (website), or nowhere.
    const imageBase = opts.imageBase === undefined ? base : opts.imageBase;
    const fetchImpl = opts.fetch || ((url, init) => fetch(url, init));
    const mem = new Map();
    let versions = null;

    const storeKey = (p) => 'lumen:cache:' + p;
    function readCache(path) {
      try {
        const raw = sessionStorage.getItem(storeKey(path));
        if (!raw) return null;
        const { t, v } = JSON.parse(raw);
        return { fresh: Date.now() - t < TTL, value: v };
      } catch { return null; }
    }
    function writeCache(path, value) {
      try { sessionStorage.setItem(storeKey(path), JSON.stringify({ t: Date.now(), v: value })); } catch { /* quota */ }
    }

    async function raw(path) {
      const res = await fetchImpl(base + path, { credentials: 'include', headers: { Accept: 'application/json' } });
      if (!res.ok) throw new ApiError(res.status, path);
      const type = (res.headers.get && res.headers.get('content-type')) || '';
      return type.includes('json') ? res.json() : res.text();
    }

    /** GET with in-memory de-duplication and a short session cache. */
    function get(path, { force = false, cache = true } = {}) {
      if (!force && mem.has(path)) return mem.get(path);
      if (!force && cache) {
        const c = readCache(path);
        if (c && c.fresh) { const p = Promise.resolve(c.value); mem.set(path, p); return p; }
      }
      const p = raw(path).then((v) => { if (cache) writeCache(path, v); return v; });
      p.catch(() => mem.delete(path));
      mem.set(path, p);
      return p;
    }

    async function ver(product) {
      if (!versions) {
        versions = (async () => {
          try {
            const list = await get('/d2l/api/versions/');
            return Object.fromEntries(list.map((x) => [x.ProductCode, x.LatestVersion]));
          } catch { return {}; }
        })();
      }
      return (await versions)[product] || DEFAULT_VERSIONS[product];
    }
    const lp = async (p) => `/d2l/api/lp/${await ver('lp')}${p}`;
    const le = async (p) => `/d2l/api/le/${await ver('le')}${p}`;

    async function paged(firstPath, itemsKey, nextKey) {
      const out = [];
      let path = firstPath;
      for (let guard = 0; path && guard < 20; guard++) {
        const page = await get(path);
        out.push(...(page[itemsKey] || []));
        path = nextKey(page, path);
      }
      return out;
    }

    const api = {
      base,
      clearCache() {
        mem.clear();
        try {
          Object.keys(sessionStorage).filter((k) => k.startsWith('lumen:cache:')).forEach((k) => sessionStorage.removeItem(k));
        } catch { /* ignore */ }
      },

      async whoami() {
        return get(await lp('/users/whoami'));
      },

      async courses() {
        const first = await lp('/enrollments/myenrollments/?orgUnitTypeId=3&sortBy=-StartDate');
        const items = await paged(first, 'Items', (page, prev) => {
          const pi = page.PagingInfo;
          if (!pi || !pi.HasMoreItems || !pi.Bookmark) return null;
          const u = new URL(prev, location.origin);
          u.searchParams.set('bookmark', pi.Bookmark);
          return u.pathname + u.search;
        });
        const lpv = await ver('lp');
        return items
          .filter((e) => e.OrgUnit && e.Access && e.Access.CanAccess !== false)
          .map((e) => ({
            id: e.OrgUnit.Id,
            name: e.OrgUnit.Name,
            code: e.OrgUnit.Code || '',
            homeUrl: e.OrgUnit.HomeUrl || `/d2l/home/${e.OrgUnit.Id}`,
            image: `${imageBase}/d2l/api/lp/${lpv}/courses/${e.OrgUnit.Id}/image?height=320&width=800`,
            hasImage: imageBase !== null && e.OrgUnit.ImageUrl !== null,
            active: e.Access.IsActive !== false,
            start: e.Access.StartDate || null,
            end: e.Access.EndDate || null,
            lastAccessed: e.Access.LastAccessed || null,
            pinned: !!(e.PinSettings && e.PinSettings.IsPinned),
          }));
      },

      async news(ou) {
        const list = await get(await le(`/${ou}/news/`));
        return (list || [])
          .filter((n) => !n.IsHidden)
          .map((n) => ({
            id: n.Id,
            title: n.Title,
            html: (n.Body && (n.Body.Html || n.Body.Text)) || '',
            date: n.StartDate || n.CreatedDate || null,
            attachments: (n.Attachments || []).map((a) => ({
              name: a.FileName,
              url: `${base}/d2l/le/news/${ou}/${n.Id}/attachment/${a.FileId}`,
            })),
          }))
          .sort((a, b) => new Date(b.date) - new Date(a.date));
      },

      async toc(ou) {
        const data = await get(await le(`/${ou}/content/toc`));
        const mapModule = (m) => ({
          id: m.ModuleId,
          title: m.Title,
          description: (m.Description && (m.Description.Html || m.Description.Text)) || '',
          modules: (m.Modules || []).map(mapModule),
          topics: (m.Topics || [])
            .filter((t) => !t.IsHidden)
            .map((t) => ({
              id: t.TopicId,
              title: t.Title,
              type: topicKind(t),
              url: t.Url,
              unread: !!t.Unread,
              due: t.DueDateTime || null,
              locked: !!t.IsLocked,
              viewUrl: `${base}/d2l/le/content/${ou}/viewContent/${t.TopicId}/View`,
            })),
        });
        return (data.Modules || []).filter((m) => !m.IsHidden).map(mapModule);
      },

      async assignments(ou) {
        const folders = await get(await le(`/${ou}/dropbox/folders/`));
        return (folders || [])
          .filter((f) => !f.IsHidden)
          .map((f) => ({
            key: `a:${ou}:${f.Id}`,
            id: f.Id,
            courseId: ou,
            type: 'assignment',
            title: f.Name,
            due: f.DueDate || (f.Availability && f.Availability.EndDate) || null,
            instructions: (f.CustomInstructions && (f.CustomInstructions.Html || f.CustomInstructions.Text)) || '',
            points: f.Assessment && f.Assessment.ScoreDenominator,
            url: `${base}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${f.Id}&ou=${ou}`,
            done: null,
          }));
      },

      async quizzes(ou) {
        const first = await le(`/${ou}/quizzes/`);
        const items = await paged(first, 'Objects', (page) => (page.Next ? new URL(page.Next, location.origin).pathname + new URL(page.Next, location.origin).search : null));
        return items
          .filter((q) => q.IsActive !== false)
          .map((q) => ({
            key: `q:${ou}:${q.QuizId}`,
            id: q.QuizId,
            courseId: ou,
            type: 'quiz',
            title: q.Name,
            due: q.DueDate || q.EndDate || null,
            url: `${base}/d2l/lms/quizzing/user/quiz_summary.d2l?qi=${q.QuizId}&ou=${ou}`,
            done: null,
          }));
      },

      async grades(ou) {
        const [items, final] = await Promise.all([
          get(await le(`/${ou}/grades/values/myGradeValues/`)).catch(() => []),
          get(await le(`/${ou}/grades/final/values/myGradeValue`)).catch(() => null),
        ]);
        const pct = (g) =>
          g && g.PointsDenominator ? (g.PointsNumerator / g.PointsDenominator) * 100 : null;
        return {
          final: final && (final.DisplayedGrade || final.PointsDenominator)
            ? { display: final.DisplayedGrade, percent: pct(final) }
            : null,
          items: (items || []).map((g) => ({
            id: g.GradeObjectIdentifier,
            name: g.GradeObjectName,
            display: g.DisplayedGrade,
            numerator: g.PointsNumerator,
            denominator: g.PointsDenominator,
            weight: g.WeightedDenominator,
            weighted: g.WeightedNumerator,
            percent: pct(g),
            comment: g.Comments && (g.Comments.Html || g.Comments.Text),
          })),
        };
      },

      /**
       * Everything with a date across the given courses: assignments, quizzes,
       * discussions and content due dates. Uses Brightspace's "my items" feed
       * (which knows completion state) and falls back to per-course lookups.
       */
      async workItems(courseIds) {
        if (!courseIds.length) return [];
        const start = new Date(Date.now() - 45 * 864e5).toISOString();
        const end = new Date(Date.now() + 120 * 864e5).toISOString();
        try {
          const first = await le(
            `/content/myItems/?orgUnitIdsCSV=${courseIds.join(',')}&startDateTime=${start}&endDateTime=${end}`
          );
          const items = await paged(first, 'Objects', (page) => {
            if (!page.Next) return null;
            const u = new URL(page.Next, location.origin);
            return u.pathname + u.search;
          });
          return items.map((it) => {
            const type = scheduledKind(it);
            return {
              key: `s:${it.OrgUnitId}:${it.ItemId}:${type}`,
              id: it.ItemId,
              courseId: it.OrgUnitId,
              type,
              title: it.ItemName,
              due: it.DueDate || it.EndDate || null,
              url: it.ItemUrl ? new URL(it.ItemUrl, location.origin).href : null,
              done: it.DateCompleted ? true : it.IsExempt ? true : false,
            };
          });
        } catch (e) {
          const per = await Promise.all(
            courseIds.map(async (ou) => {
              const [a, q] = await Promise.all([
                api.assignments(ou).catch(() => []),
                api.quizzes(ou).catch(() => []),
              ]);
              return [...a, ...q];
            })
          );
          return per.flat();
        }
      },
    };
    return api;
  };

  function topicKind(t) {
    const url = (t.Url || '').toLowerCase();
    const ti = (t.TypeIdentifier || '').toLowerCase();
    if (/quiz/.test(url)) return 'quiz';
    if (/dropbox/.test(url)) return 'assignment';
    if (/discussions/.test(url)) return 'discussion';
    if (/\.pdf($|\?)/.test(url)) return 'pdf';
    if (/\.(pptx?|key)($|\?)/.test(url)) return 'slides';
    if (/\.(xlsx?|csv)($|\?)/.test(url)) return 'sheet';
    if (/\.(png|jpe?g|gif|svg|webp)($|\?)/.test(url)) return 'image';
    if (/\.(mp4|mov|webm|m4v)($|\?)|youtube|youtu\.be|vimeo|kaltura|mediaspace/.test(url)) return 'video';
    if (/zoom\.us|teams\.microsoft/.test(url)) return 'meeting';
    if (ti === 'link' || /^https?:/.test(url)) return 'link';
    return 'doc';
  }
  L.topicKind = topicKind;

  function scheduledKind(it) {
    const url = (it.ItemUrl || '').toLowerCase();
    if (/dropbox|assignment/.test(url)) return 'assignment';
    if (/quiz/.test(url)) return 'quiz';
    if (/discussion/.test(url)) return 'discussion';
    if (/survey/.test(url)) return 'survey';
    return 'content';
  }
})();
