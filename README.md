# @suifei/dsh-ai-team

AI Team mode for DeepSeek Harness: **projects, owned tasks, threads, inbox and an append-only team ledger** — one Human sentence, a team of named persistent agents keeps going, and only direction / trust / irreversible steps come back.

> M1 status: the package mounts a **three-pane workbench** (left projects + agents, center `主对话 / 看板 / 态势`, right thread). The app ledger, task/thread/inbox domain and `TeamService` are implemented and covered by `node --test` (38 tests); `bootstrap`, `POST .../commands`, `GET .../board` and `GET .../quadrants` are wired to a real default-project ledger; bootstrap also carries both projections. The real member runtime (Agent sessions) and SSE land later. The UI is a contract spike, not the final client; see `docs/05-项目启动与执行计划.md` and `docs/reports/M1-验收矩阵.md`.

## Install (dedicated profile)

```sh
dsh --profile ai-team --from-default-profile web --dump-config   # create the profile from the web template
dsh plugin --profile ai-team add E:/works/dsh-ai-team            # install this package
dsh --profile ai-team --no-open --port 0                         # boot the test server
```

The plugin is **not** installed in the normal `desktop`/`web` profiles; ordinary sessions keep their preset roster (R-01/R-02).

## Layout

- `index.js` — Host entry: same-origin `/ai-team/api/health`, `/ai-team/api/bootstrap`, and `POST /ai-team/api/projects/:id/commands` backed by the default-project ledger.
- `client.js` — Client entry: `sidebar.panellist` icon + `main` key `ai-team` three-pane workbench.
- `cordis.patch.yml` — bundle row.
- `lib/` — append-only ledger (`ledger/*`), task/thread/inbox domain (`domain/*`) and the host `TeamService` (`host/service.js`).
- `test/` — `node --test`: bundle smoke, ledger/fold/checkpoint, domain rules, and a real-ledger service integration.

## Rules

- Only `--dsw-alias-*` tokens for UI chrome; the Loop Mark is the only artwork with its own color.
- No timer / no background wake; M1 will add event-driven wake.
- A′ (native session + tool view) is only the fallback when the workbench is unavailable.

## Docs

The phase-1 research, PRD, architecture, UX and execution plan live in the repository's `docs/` directory (index: `docs/README.md`).
