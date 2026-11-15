/*
 * A fake Brightspace for the demo page and for testing. It answers the same
 * Valence API paths the extension calls, with realistic sample data, so the
 * real api.js mapping code runs unchanged.
 */
(function () {
  const now = Date.now();
  const D = 864e5;
  const at = (days, hour = 23, min = 59) => { const d = new Date(now + days * D); d.setHours(hour, min, 0, 0); return d.toISOString(); };
  const termStart = (() => { const d = new Date(); const m = d.getMonth(); const s = new Date(d.getFullYear(), m >= 8 ? 8 : m >= 4 ? 4 : 0, 4); return s.toISOString(); })();
  const termEnd = new Date(new Date(termStart).getTime() + 115 * D).toISOString();

  const courses = [
    { Id: 101, Name: 'Abstract Data Types and Algorithms', Code: 'COMP 2402' },
    { Id: 102, Name: 'Linear Algebra for Engineering or Science', Code: 'MATH 1104' },
    { Id: 103, Name: 'Object-Oriented Software Development', Code: 'CS 246' },
    { Id: 104, Name: 'Introduction to Psychology I', Code: 'PSYC 1001' },
    { Id: 105, Name: 'Probability', Code: 'STAT 230' },
    { Id: 106, Name: 'Writing and Rhetoric', Code: 'ENGL 1100' },
    { Id: 90, Name: 'Introduction to Computer Science I', Code: 'COMP 1405', past: true },
    { Id: 91, Name: 'Calculus I', Code: 'MATH 1007', past: true },
  ];

  const enrollments = courses.map((c) => ({
    OrgUnit: { Id: c.Id, Type: { Id: 3, Code: 'Course Offering', Name: 'Course Offering' }, Name: c.Name, Code: c.Code, HomeUrl: `/d2l/home/${c.Id}`, ImageUrl: null },
    Access: {
      IsActive: !c.past, CanAccess: true,
      StartDate: c.past ? new Date(new Date(termStart).getTime() - 240 * D).toISOString() : termStart,
      EndDate: c.past ? new Date(new Date(termStart).getTime() - 120 * D).toISOString() : termEnd,
      LastAccessed: at(-1),
    },
    PinSettings: { IsPinned: c.Id === 101 },
  }));

  const work = [
    [101, 'Assignment 3: Skip lists and hashing', 'dropbox', 2, 23, 59],
    [101, 'Quiz 4 – Priority queues', 'quiz', 0, 18, 0],
    [101, 'Lab 7 checkoff', 'content', 6, 17, 0],
    [101, 'Assignment 2: Linked structures', 'dropbox', -9, 23, 59, true],
    [102, 'WeBWorK Set 6: Determinants', 'quiz', 1, 23, 0],
    [102, 'Written Assignment 3', 'dropbox', 8, 23, 59],
    [102, 'WeBWorK Set 5: Matrix inverses', 'quiz', -3, 23, 0],
    [103, 'A3: Chess engine (Part 1)', 'dropbox', 4, 17, 0],
    [103, 'A2: Test harness', 'dropbox', -12, 17, 0, true],
    [104, 'Reading quiz: Memory (Ch. 7)', 'quiz', 3, 9, 0],
    [104, 'Research participation credit', 'content', 30, 23, 59],
    [104, 'Discussion: Sleep and learning', 'discussion', -1, 23, 59],
    [105, 'Problem Set 5', 'dropbox', 5, 23, 59],
    [105, 'Midterm 2 (in person)', 'content', 13, 19, 0],
    [106, 'Rhetorical analysis essay – draft', 'dropbox', 9, 12, 0],
    [106, 'Peer review reflection', 'discussion', 0, 23, 59, true],
  ];
  const scheduled = work.map(([ou, name, kind, days, h, m, done], i) => ({
    OrgUnitId: ou, ItemId: 500 + i, ItemName: name, ItemType: 1,
    ItemUrl: kind === 'dropbox' ? `/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${500 + i}&ou=${ou}`
      : kind === 'quiz' ? `/d2l/lms/quizzing/user/quiz_summary.d2l?qi=${500 + i}&ou=${ou}`
        : kind === 'discussion' ? `/d2l/le/${ou}/discussions/topics/${500 + i}/View`
          : `/d2l/le/content/${ou}/viewContent/${500 + i}/View`,
    StartDate: null, EndDate: null, DueDate: at(days, h, m), CompletionType: 1,
    DateCompleted: done ? at(days - 1, 15) : null, ActivityType: 1, IsExempt: false,
  }));

  const news = {
    101: [
      { Id: 1, Title: 'Assignment 3 is posted', StartDate: at(-1, 10, 12), Body: { Html: '<p>Hi everyone,</p><p>Assignment 3 on <strong>skip lists and hashing</strong> is now available under <em>Classwork → Assignments</em>. Starter code is attached in the module. Remember that the autograder runs on the server JDK, so test with <code>javac --release 17</code>.</p><p>Office hours this week are moved to <strong>Thursday 2–4 pm</strong> in HP 5336.</p><ul><li>Due: Friday 11:59 pm</li><li>Late penalty: 10%/day up to 2 days</li></ul>' }, Attachments: [{ FileId: 1, FileName: 'a3-starter.zip' }] },
      { Id: 2, Title: 'Midterm grades released', StartDate: at(-6, 16, 40), Body: { Html: '<p>Midterm grades are now visible in the gradebook. The class average was 71%. If you’d like to review your paper, come to any office hour in the next two weeks.</p>' }, Attachments: [] },
      { Id: 3, Title: 'Welcome to COMP 2402!', StartDate: at(-60, 9, 0), Body: { Html: '<p>Welcome! Please read the course outline carefully. All lecture recordings will be posted to the <a href="#">Lecture recordings</a> module within 24 hours.</p>' }, Attachments: [{ FileId: 2, FileName: 'Course outline.pdf' }] },
    ],
  };
  const genericNews = (ou) => [
    { Id: 10, Title: 'Reminder about this week', StartDate: at(-2, 13, 5), Body: { Html: '<p>Just a reminder that tutorials run as normal this week. Slides from Tuesday’s lecture are up in Classwork.</p>' }, Attachments: [] },
    { Id: 11, Title: 'Welcome to the course', StartDate: at(-58, 9, 30), Body: { Html: '<p>Welcome! The syllabus and schedule are in the <strong>Start here</strong> module.</p>' }, Attachments: [] },
  ];

  const topic = (id, title, url, extra = {}) => ({ TopicId: id, Identifier: String(id), TypeIdentifier: /^https?:/.test(url) ? 'Link' : 'File', Title: title, Url: url, Unread: false, IsHidden: false, IsLocked: false, ...extra });
  const toc = {
    Modules: [
      { ModuleId: 1, Title: 'Start here', Description: { Html: '<p>Course outline, schedule and how to get help.</p>' }, Modules: [], Topics: [
        topic(11, 'Course outline', '/content/enforced/101/outline.pdf'),
        topic(12, 'Weekly schedule', '/content/enforced/101/schedule.xlsx'),
        topic(13, 'Discord / Ed discussion board', 'https://edstem.org/'),
      ] },
      { ModuleId: 2, Title: 'Week 9 – Hashing', Description: { Html: '' }, Modules: [
        { ModuleId: 21, Title: 'Lecture materials', Modules: [], Topics: [
          topic(211, 'Lecture 17 slides: Hash tables', '/content/enforced/101/l17.pptx', { Unread: true }),
          topic(212, 'Lecture 17 recording', 'https://mediaspace.carleton.ca/media/l17', { Unread: true }),
          topic(213, 'Lecture 18 notes: Linear probing', '/content/enforced/101/l18.pdf'),
        ] },
      ], Topics: [
        topic(22, 'Assignment 3: Skip lists and hashing', '/d2l/lms/dropbox/user/folder_submit_files.d2l?db=500', { DueDateTime: at(2) }),
        topic(23, 'Lab 7 handout', '/content/enforced/101/lab7.pdf', { Unread: true }),
      ] },
      { ModuleId: 3, Title: 'Week 8 – Priority queues and heaps', Modules: [], Topics: [
        topic(31, 'Lecture 15 slides', '/content/enforced/101/l15.pdf'),
        topic(32, 'Lecture 16 slides', '/content/enforced/101/l16.pdf'),
        topic(33, 'Heap visualizer', 'https://visualgo.net/en/heap'),
        topic(34, 'Quiz 4 – Priority queues', '/d2l/lms/quizzing/user/quiz_summary.d2l?qi=501'),
      ] },
      { ModuleId: 4, Title: 'Week 7 – Midterm', Modules: [], Topics: [
        topic(41, 'Midterm practice questions', '/content/enforced/101/practice.pdf'),
        topic(42, 'Midterm solutions', '/content/enforced/101/mt-sol.pdf', { IsLocked: true }),
      ] },
      { ModuleId: 5, Title: 'Lecture recordings', Modules: [], Topics: Array.from({ length: 6 }, (_, i) => topic(60 + i, `Lecture ${16 - i} recording`, `https://mediaspace.carleton.ca/media/l${16 - i}`)) },
    ],
  };

  const grades = {
    101: { items: [
      ['Assignment 1', 18.5, 20, 10], ['Assignment 2', 17, 20, 10], ['Quiz 1', 9, 10, 2.5], ['Quiz 2', 7, 10, 2.5], ['Quiz 3', 10, 10, 2.5], ['Midterm', 41, 55, 25],
    ], final: null },
    102: { items: [['WeBWorK 1–4', 38, 40, 10], ['Written assignment 1', 14, 15, 5], ['Written assignment 2', 12, 15, 5], ['Midterm', 31, 40, 30]] },
    103: { items: [['A0', 1, 1, 1], ['A1', 46, 50, 8], ['A2', 39, 50, 8]] },
    105: { items: [['Problem Set 1', 9, 10, 4], ['Problem Set 2', 8, 10, 4], ['Midterm 1', 33, 45, 20]] },
  };

  function json(body, status = 200) {
    return Promise.resolve({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: () => Promise.resolve(JSON.parse(JSON.stringify(body))), text: () => Promise.resolve(JSON.stringify(body)) });
  }

  window.mockBrightspaceFetch = function (url) {
    const u = new URL(url, location.href);
    const p = u.pathname;
    let m;
    if (p === '/d2l/api/versions/') return json([{ ProductCode: 'lp', LatestVersion: '1.47' }, { ProductCode: 'le', LatestVersion: '1.79' }]);
    if (/\/users\/whoami$/.test(p)) return json({ Identifier: '1', FirstName: 'Alex', LastName: 'Rivera', UniqueName: 'alexrivera', ProfileIdentifier: 'x' });
    if (/\/enrollments\/myenrollments\/$/.test(p)) return json({ PagingInfo: { Bookmark: '', HasMoreItems: false }, Items: enrollments });
    if (/\/content\/myItems\/$/.test(p)) return json({ Next: null, Objects: scheduled });
    if ((m = p.match(/\/le\/[\d.]+\/(\d+)\/news\/$/))) return json(news[m[1]] || genericNews(m[1]));
    if ((m = p.match(/\/le\/[\d.]+\/(\d+)\/content\/toc$/))) return json(toc);
    if ((m = p.match(/\/le\/[\d.]+\/(\d+)\/dropbox\/folders\/$/))) return json([]);
    if ((m = p.match(/\/le\/[\d.]+\/(\d+)\/quizzes\/$/))) return json({ Next: null, Objects: [] });
    if ((m = p.match(/\/le\/[\d.]+\/(\d+)\/grades\/values\/myGradeValues\/$/))) {
      const g = grades[m[1]];
      return json(g ? g.items.map(([n, a, b, w], i) => ({ GradeObjectIdentifier: String(i), GradeObjectName: n, PointsNumerator: a, PointsDenominator: b, DisplayedGrade: `${((a / b) * 100).toFixed(1)} %`, WeightedDenominator: w, WeightedNumerator: (a / b) * w })) : []);
    }
    if (/\/grades\/final\/values\/myGradeValue$/.test(p)) return json(null, 404);
    return json({ Message: 'Not found' }, 404);
  };
})();
