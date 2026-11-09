# @suifei/dsh-ai-team

AI Team mode for DeepSeek Harness: **projects, owned tasks, threads, inbox and an append-only team ledger** — one Human sentence, a team of named persistent agents keeps going, and only direction / trust / irreversible steps come back.

> M1/M2 status: the package mounts a **three-pane workbench** (left projects + agents, center `主对话 / 看板 / 态势`, right thread). The app ledger, task/thread/inbox domain and `TeamService` are implemented and covered by `node --test` (61 tests); `bootstrap`, `POST .../commands`, `GET .../board`, `GET .../quadrants` and the event-driven `GET .../events` SSE are wired to a real default-project ledger. The profile patch enforces `danger-full-access`, and the Host refuses to boot a weaker profile; `member.activate` now creates a real continuable child through the Team Host Agent, binds the session, sets/verifies `danger-full-access`, and records it in the ledger. Real activation and `member.config.update` were verified on the ai-team profile; the Host subscribes to `agent/request-error` for classification/retry/fallback (auth/billing fail closed) and to `session/event` for recovery/reset; the member row shows effective model/context/version/last failure. A member-only `team` tool exposes tasks/inbox/claim/submit/thread/reply/review through `TeamService`; the Waker delivers wake messages and records `wake/delivered`/`wake/failed`. The direct `agents.create + followup` path starts a real turn (`agentStatus=running`, `seq=6`), but its tail is `turn/start → inbox/spliced → turn/end` with no `step/start` or tool call: `preStep` ends the turn early. The one-sentence team loop is still not closed. Real provider-failure injection and the config-edit UI are still M2/M3. The UI is a contract spike, not the final client; see `docs/05-项目启动与执行计划.md`, `docs/08-异常恢复与模型治理.md` and `docs/reports/M1-验收矩阵.md`.

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
