# Contributing to RateIt

Thanks for helping out. This guide covers everything from first run to release.

- [Ground rules](#ground-rules)
- [Dev setup](#dev-setup)
- [How the app fits together](#how-the-app-fits-together)
- [Project layout](#project-layout)
- [Making changes](#making-changes)
- [Database changes](#database-changes)
- [Testing](#testing)
- [Branches, commits, PRs](#branches-commits-prs)
- [Building and releasing](#building-and-releasing)
- [Reporting bugs and ideas](#reporting-bugs-and-ideas)

## Ground rules

| Rule | Why |
|---|---|
| **Local only.** No network calls except the Spotify Web API. No analytics, telemetry, or cloud sync. | It's the core promise of the app. |
| **No frontend frameworks or build step.** Plain HTML, CSS, and JS. | Keeps the app small and the code easy to read. |
| **Never break an existing database.** | Users keep their `ratings.db` across updates. See [Database changes](#database-changes). |
| **Open an issue first for big changes.** | Saves you from building something that won't be merged. |

## Dev setup

**Needs:** macOS, Node.js 18+, npm, and a Spotify Client ID / Secret ([how to get one](README.md#setup)).

```sh
git clone https://github.com/sjcsoftware/rateit.git && cd rateit
npm install
npm run rebuild   # recompile better-sqlite3 for Electron's Node version
npm start         # launch the app
```

> [!TIP]
> Run `npm run rebuild` again whenever you reinstall `node_modules` or change the Electron version. A `NODE_MODULE_VERSION` mismatch error means you forgot.

There is no hot reload. Restart `npm start` after editing `electron/` or `backend/`. For frontend-only changes, reload the window with <kbd>⌘</kbd> <kbd>R</kbd>.

<details>
<summary><b>Running the backend without Electron</b></summary>

<br>

Useful for poking at the API with `curl`.

```sh
cd backend
npm install
cp .env.example .env   # optional, sets PORT (default 3001)
npm run dev            # node --watch server.js
```

Then open `http://localhost:3001`. Without Electron, the database is `backend/ratings.db` (gitignored).

</details>

## How the app fits together

```
Electron (electron/main.js)
  ├─ sets DB_PATH and CONFIG_PATH under ~/Library/Application Support/rateit/
  ├─ starts the Express server in-process on a random free port (PORT=0)
  └─ opens a BrowserWindow at http://localhost:<port>

Express (backend/server.js)
  ├─ serves frontend/ as static files
  ├─ /api/*  → SQLite via better-sqlite3
  └─ /api/search, /api/album/:id/tracks → Spotify Web API (user's own keys)

Frontend (frontend/app.js)
  └─ one class per view, talks to the backend with fetch('/api/...')
```

| File | Purpose |
|---|---|
| `ratings.db` | SQLite database: users, albums, tracks, criteria, history |
| `rateit_session.json` | Remembers the logged-in user |
| `rateit_config.json` | App settings |

All three live in `~/Library/Application Support/rateit/` in the packaged and dev app.

## Project layout

```
rateit/
├── electron/main.js        # Electron entry: paths, server start, window
├── backend/
│   ├── server.js           # Express API, schema, migrations, Spotify calls
│   └── .env.example        # PORT for standalone backend runs
├── frontend/
│   ├── index.html          # Shell and nav
│   ├── app.js              # All views and the app controller
│   └── style.css
├── assets/                 # App icon (.icns + iconset)
├── screenshots/            # README images
├── scripts/
│   └── rename-x64-to-x86-64.js   # Post-build DMG rename
└── package.json            # Scripts and electron-builder config
```

### Finding your way in `frontend/app.js`

Sections are marked with `// ── Name ──` comment headers.

| Section | What it does |
|---|---|
| API Layer | Every `fetch` to the backend |
| Star Rating Component, Rating Controller | Rating screen for one album |
| `AuthView`, `AccountDetailsView` | Sign up, login, account and Spotify keys |
| `SearchView` | Main screen, search, Surprise Me |
| `LibraryView` | Rated Albums, sort/group, export |
| `GalleryView` | Card grid and flip cards |
| `CustomCriteriaView` | Criteria editor |
| `ProfileView` | Stats, Hall of Fame |
| `WrappedView` | Year in Review |
| App Controller, Bootstrap | Navigation and startup |

## Making changes

| Change | Where |
|---|---|
| New API endpoint | `backend/server.js`, then a method in the API Layer of `frontend/app.js` |
| New screen | A new view class in `app.js`, a nav entry in `index.html`, routing in the App Controller |
| Styling | `frontend/style.css`. Reuse existing CSS variables and classes before adding new ones. |
| Window or startup behaviour | `electron/main.js` |
| Packaging | `build` section of `package.json` |

Keep the style of the surrounding code: 2-space indent, single quotes, semicolons, `// ── Section ──` headers for new sections.

## Database changes

Users upgrade by replacing the app while keeping their database, so every schema change has to work on old databases.

| Do | Don't |
|---|---|
| Add tables with `CREATE TABLE IF NOT EXISTS` | Drop or rename tables or columns |
| Add columns by appending an `ALTER TABLE ... ADD COLUMN` to the `migrations` array in `server.js` | Edit or reorder existing migrations |
| Make new columns nullable or give them a default | Assume a new column has data for old rows |

Before opening a PR that touches the schema, test it against a database created by the latest release (see [Testing](#testing)).

## Testing

There is no automated test suite yet. Test by hand before opening a PR:

| Check | |
|---|---|
| Fresh install | Move `~/Library/Application Support/rateit/` aside, run `npm start`, sign up, rate an album |
| Existing data | Run with a database from the latest release. Old ratings must still load. |
| Flows you touched | Plus a quick pass over Search, Rated Albums, Gallery, and Profile |
| Packaged build | For Electron or packaging changes, run `npm run build` and launch the DMG |

> [!WARNING]
> Back up `~/Library/Application Support/rateit/` before testing against your real library.

Tests are a welcome contribution in their own right.

## Branches, commits, PRs

**Branches** off `main`:

| Prefix | For |
|---|---|
| `feature/<name>` | New features |
| `hotfix/<name>` | Bug fixes |

**Commits:** short, imperative, capitalised. Examples from history:

```
Implement Intel Mac Support
Hotfix: Custom criteria bug fix
Update version to 1.0.6
```

**Pull requests:**

1. Fork, branch, and commit.
2. Open a PR against `main` with what changed, why, and how you tested it.
3. Add before/after screenshots for UI changes.
4. If a README screenshot is now out of date, update it in `screenshots/` (same filename).
5. Don't bump the version in `package.json`. The maintainer does that at release time.

## Building and releasing

Releases are cut by the maintainer.

```sh
npm run build
```

| Output | |
|---|---|
| `dist/RateIt-<version>-arm64.dmg` | Apple Silicon |
| `dist/RateIt-<version>-x86-64.dmg` | Intel (renamed from `x64` by `scripts/rename-x64-to-x86-64.js`) |

Release steps:

1. Bump `version` in `package.json` and commit (`Update version to X.Y.Z`).
2. `npm run build`.
3. Create a GitHub release tagged `X.Y.Z` and attach both DMGs.

## Reporting bugs and ideas

Open an [issue](https://github.com/sjcsoftware/rateit/issues) with:

- RateIt version and Mac type (Apple Silicon or Intel)
- macOS version
- Steps to reproduce, what you expected, what happened
- A screenshot if it's visual

Never paste your Spotify Client Secret or your `ratings.db` into an issue.

By contributing, you agree your work is licensed under the [MIT License](LICENSE).
