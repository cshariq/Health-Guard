# Lumen Classes

A small, self-hosted learning platform — the part of Lumen that **replaces** Brightspace instead of
wrapping it. No dependencies: one Node server, one SQLite file.

```bash
cd brightspace-wrapper
npm run classes          # node classes/server.mjs → http://localhost:8200
```

Needs Node 22.5+ (it uses Node's built-in SQLite).

| Teacher: Classwork | Teacher: grading |
|---|---|
| ![](../docs/classes-classwork.png) | ![](../docs/classes-grading.png) |
| **Teacher: gradebook** | **Student: quiz result** |
| ![](../docs/classes-gradebook.png) | ![](../docs/classes-quiz.png) |

## What it does

**Anyone** can create an account (or sign in with the school's single sign-on). Whoever creates a
class is its teacher; everyone who joins with the class code is a student. One person can teach some
classes and be a student in others. The first account on a new server is its administrator.

| | Teachers | Students |
|---|---|---|
| **Classes** | Create, share/reset the join code, add co-teachers, remove students, archive | Join with a code, leave |
| **Stream** | Post, edit and delete announcements | Read them |
| **Classwork** | Modules, notes, links, file uploads; edit any of it | Browse and search |
| **Assignments** | Instructions, due date, points or a **rubric**; edit later | Hand in text and/or a file; change it until graded |
| **Grading** | See every hand-in; grade per rubric row or as one number, with feedback | See the grade, rubric breakdown and feedback |
| **Quizzes** | Multiple choice, checkboxes, short answer (auto-marked), written answer (you mark); **time limit**; **retakes** | Timer, answers saved as they go, best attempt counts |
| **Discussions** | Start threads, reply, delete anything | Start threads, reply, delete their own |
| **Grades** | Gradebook: students × items, overall %, **CSV export** | Their own grades and overall % |
| **To-do / Calendar** | Upcoming deadlines for classes they teach | What's assigned, missing and done |
| **Account** | Name, password, email notifications on/off, forgot-password | same |

**Administrators** get an Admin page: usage numbers; turn sign-ups on/off; restrict class creation to
approved teachers; approve teachers, make admins, turn accounts off, create password-reset links, delete
accounts; archive, restore or delete any class; and a log of every email sent.

| Timed quiz | Rubric grading | Admin |
|---|---|---|
| ![](../docs/classes-timed-quiz.png) | ![](../docs/classes-rubric.png) | ![](../docs/classes-admin.png) |

## How it's built

- `server.mjs` — the whole server: accounts, classes, authoring, hand-ins, grading, file storage.
- `public/classes.js` — everything that *writes* (sign-in, create/join, authoring, hand-ins, quizzes,
  grading). It plugs into the shared Lumen UI through `L.ext`.
- Reading reuses the **same Lumen UI as the Brightspace wrapper** (`../src`). The server exposes a
  read-only, Brightspace-shaped API (`/d2l/api/...`) next to its own (`/api/...`), so the Classes,
  Stream, Classwork, To-do, Calendar and Grades screens are the ones already built and tested.
- Because of that API (and a session cookie named like Brightspace's), the native apps in `../native`
  are designed to work against a Lumen Classes server too: choose *Another school* and enter its address.
  That path is by design and has not been run on a device yet.

Data lives in `classes/data/` (`lumen.db` + `files/`). Back up that folder; delete it to start over.

## Configuration

| Variable | Default | |
|---|---|---|
| `PORT` | `8200` | |
| `PUBLIC_URL` | `http://localhost:$PORT` | Used in emailed links and SSO. With `https://`, cookies are marked `Secure`. Put it behind HTTPS for real use. |
| `LUMEN_DATA` | `classes/data` | Where the database and uploads go |
| `LUMEN_ALLOW_SIGNUP` | `true` | Starting value; admins can change it in the Admin page |
| `LUMEN_ADMIN_EMAILS` | | Comma-separated emails that are always administrators |
| `LUMEN_MAX_UPLOAD_MB` | `25` | Per-file upload limit |
| `SMTP_URL` | | `smtps://user:pass@host:465` or `smtp://user:pass@host:587`. Without it, emails are only logged in Admin → Email, and admins hand out reset links. |
| `SMTP_FROM` | `Lumen Classes <no-reply@localhost>` | |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_NAME` | | Single sign-on with any OpenID Connect provider (Google, Microsoft Entra, a district IdP). Redirect URI: `PUBLIC_URL/auth/sso/callback`. `OIDC_NAME` is the button label. |

Emails go out for new announcements, new assignments and quizzes, grades, and password resets.

## Security

- Passwords are hashed with scrypt; sessions are random tokens stored hashed, in an `HttpOnly`,
  `SameSite=Lax` cookie. Login, sign-up and join attempts are rate-limited.
- Every write needs an `X-Lumen` header, which a cross-site form can't send (CSRF protection).
- Every route checks class membership; authoring and grading check for the teacher role. Students never
  see the join code, other students' emails, or each other's hand-ins.
- People type plain text; the server escapes it and only adds paragraphs and links, so no user HTML is
  ever stored or served. Uploaded files are served as downloads (PDFs and images inline) under a
  sandboxing CSP, so an uploaded HTML file can't run as the site.
- The quiz answer key is only sent to a student after they hand the quiz in.

## Tests

```bash
npm run test:classes     # 25 API tests: flows, permission rules, email (fake SMTP), SSO (fake provider)
# Browser tests (need Playwright), against a server with a fresh LUMEN_DATA folder:
node classes/server.mjs &
node classes/e2e.cjs && node classes/e2e-features.cjs
```

## Known limits

- One server instance (SQLite, in-memory rate limits). Fine for a school; not built to scale out.
- Email was tested against a plain local SMTP server; the TLS/STARTTLS and sign-in paths follow the
  standard but haven't been run against a real provider yet.
- SSO was tested against a fake OpenID Connect provider, not a real Google/Microsoft tenant.
- Quizzes: no question banks, randomised order or per-student time extensions. No plagiarism checking,
  no parent/guardian accounts, no SIS roster import.
