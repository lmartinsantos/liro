# AGENTS.md

High-signal context for AI agents. Prefer this file over rediscovering the tree.

## What this is

**Liro** — self-hosted collaborative whiteboard. One Go binary serves REST + WebSocket + static SPA + MCP. Module path: `liro`. License: **GPL-2.0** ([`LICENSE`](LICENSE)). Version source of truth: [`VERSIONS`](VERSIONS).

## Stack

| Layer | Tech |
|-------|------|
| API / WS / MCP | Go 1.25, chi, coder/websocket, MCP go-sdk |
| UI | React 19, TypeScript, Vite 8, Konva/react-konva, Tailwind 4, oxlint |
| Persist | On-disk under `LIRO_DATA` (default `data/`) — not a SQL DB |
| CI | GitLab (`.gitlab-ci.yml`): build + Kaniko image; GitHub Actions: test + multi-arch release binaries |
| Container | Multi-stage `Dockerfile` → image `liro`, port `8080`, volume `/data` (SPA embedded in binary) |

Toolchain pins in `VERSIONS` must match `go.mod`, `Dockerfile`, and CI.

## Layout (edit here)

```
cmd/server/main.go     process entry; env LIRO_ADDR / LIRO_DATA / LIRO_STATIC
internal/api/          HTTP routes, WS upgrade, SPA fallback
internal/static/       embedded SPA (go:embed dist/; synced from web/dist on build)
internal/hub/          per-board realtime: ops, presence, chat apply
internal/store/        board files, snapshots, archive, import/export, assets
internal/model/        Meta, Document, Object, Op, chat types
internal/draw/         SVG / connector geometry
internal/layout/       align / distribute / patches
internal/mcp/          MCP tools + skill.md (agent drawing workflow)
internal/auth/         unlock tokens / passwords
web/src/pages/         HomePage, JoinPage, BoardPage, ViewPage
web/src/canvas/        Konva board rendering
web/src/components/    Toolbar, Palette, format bars, chat, …
web/src/lib/           api.ts, types.ts, ops, connectors, session hooks
```

Do not put app logic in `web/README.md` (Vite template leftover). Ignore `data/`, `web/dist/`, `bin/`, `node_modules/`.

## Commands

```bash
make deps          # go mod download + npm install (web/)
make dev           # API :8080 + Vite :5173 (HMR)
make run           # build SPA, serve from Go (disk web/dist)
make build         # web/dist → embed → bin/liro (self-contained)
make test          # go test ./…
make lint          # oxlint in web/
make docker-run    # build + run with volume liro-data
```

Env: `LIRO_ADDR` (default `:8080`), `LIRO_DATA` (`data`). Static UI resolution: `LIRO_STATIC` (if set) → `web/dist` on disk (if present) → embedded SPA. Makefile `ADDR`/`DATA` export the `LIRO_*` vars.

## Runtime map

- REST: `/api/boards`, `/api/boards/{id}`, `/document` (read-only view), password/archive/export/import/assets/users/snapshots
- WS: `/ws/boards/{id}` — op stream + presence + chat
- MCP: `/mcp` — tools mirror board mutations; read [`internal/mcp/skill.md`](internal/mcp/skill.md) before changing agent UX
- UI routes: `/` home · `/b/:id` join · `/b/:id/board` canvas · `/b/:id/view` read-only share/embed (`?embed=1` hides chrome)
- CORS: localhost / 127.0.0.1 only (dev Vite → API)

## Object / domain cheat sheet

- Document is a map of objects (`type`: rect, roundrect, ellipse, triangle, diamond, arrow, hexagon, parallelogram, cylinder, postit, text, sticker, line, spline, frame, lane, group, connector, …)
- Canvas origin top-left; +x right, +y down; layer order is `z` string
- Connectors: orthogonal, side ports (`top|right|bottom|left`)
- Board meta can have password hash + `archivedAt`; never send `passwordHash` to clients (`PublicMeta`)
- MCP mutating tools need `join_board` → `userId`; prefer batch `create_objects` then `view_board`

## Working conventions

- Match existing style; small diffs; no drive-by refactors or unsolicited markdown.
- Go packages under `internal/`; shared TS types in `web/src/lib/types.ts` — keep server `model` and client types aligned when changing shapes/ops.
- Tests live next to code (`*_test.go`). Run `make test` after Go changes; `make lint` after non-trivial UI changes.
- User-facing changes: optionally note under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md) when asked — do **not** bump `VERSIONS` unless releasing.
- Remote is GitLab (`origin`); tags `vX.Y.Z` trigger image publish in GitLab CI.
- GitHub mirror: pushes to `main` publish/replace GitHub Release `vX.Y.Z` from `VERSIONS` `liro=` (multi-arch binaries with embedded SPA). Same version on a later commit replaces that release’s assets and retargets the tag.

## Releases (mandatory)

When the user asks to **create a release**, **cut a release**, **ship a version**, **bump the version for release**, or similar, you **must** follow full release engineering. Do not only retag or only edit one file.

### Required steps (in order)

1. **Decide the version** using [Semantic Versioning](https://semver.org/):
   - `MAJOR` — breaking changes
   - `MINOR` — new features, backward compatible
   - `PATCH` — bug fixes / small non-breaking changes  
   Ask if the bump type is unclear. Never invent a version that skips SemVer meaning.

2. **Update [`VERSIONS`](VERSIONS)**  
   - Set `liro=X.Y.Z` to the new release version.  
   - If Go/Node (or CI/Docker) requirements changed, update `go=` / `node=` and align `.gitlab-ci.yml`, `Dockerfile`, and `go.mod` in the same change.

3. **Update [`CHANGELOG.md`](CHANGELOG.md)**  
   - Move everything under `## [Unreleased]` into a new `## [X.Y.Z] — YYYY-MM-DD` section (use today’s date).  
   - Leave an empty `## [Unreleased]` section at the top.  
   - Group notes under `### Added` / `### Changed` / `### Fixed` / `### Removed` / `### Security` as appropriate.  
   - Derive entries from commits and user-facing changes since the previous release — do not invent features.  
   - Keep the Keep a Changelog style already used in the file.

4. **Keep docs consistent**  
   - [`README.md`](README.md) must still point at `VERSIONS` / `CHANGELOG.md` / `LICENSE`.  
   - If the README hard-codes a version or toolchain requirement, update it to match `VERSIONS`.  
   - Sync `web/package.json` `"version"` to the same `X.Y.Z` when releasing.

5. **Verify before finishing**  
   - `VERSIONS` `liro=` matches the new changelog section and (if tagged) the git tag name `vX.Y.Z`.  
   - No leftover release notes stuck only under Unreleased.  
   - License remains GPL-2.0 (`LICENSE`); do not relicense as part of a routine release.

6. **Git**  
   - Commit release metadata only when the user asks to commit.  
   - Create annotated tag `vX.Y.Z` only when the user asks to tag (or explicitly asks you to finish/publish the release including the tag).  
   - Do not force-push tags or rewrite release history unless the user explicitly requests it.  
   - Push (branch and/or tags) only when the user asks.  
   - After the GitHub mirror’s `main` includes the bumped `VERSIONS`, Actions creates/replaces GitHub Release `vX.Y.Z` automatically — do not hand-craft that release in routine cuts.

### Hard rules

- **Never** cut a release by only creating a git tag.  
- **Never** bump the version in code/docs without updating both `VERSIONS` and `CHANGELOG.md`.  
- **Never** clear Unreleased without writing the dated `X.Y.Z` section.  
- **Never** mark a release “done” if `VERSIONS`, `CHANGELOG.md`, and the intended `vX.Y.Z` tag disagree.

### Suggested commit message

```
Release vX.Y.Z

Bump VERSIONS and CHANGELOG for the X.Y.Z release.
```

## Normal development

Outside of an explicit release request, do not bump `VERSIONS` or add a dated changelog section. Prefer adding notes under `## [Unreleased]` when the user asks to record user-facing changes.
