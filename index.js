/**
 * dsh-ai-team — Host half.
 *
 * M1: one default Project backed by the plugin-owned append-only ledger.
 * The workbench reads `GET /ai-team/api/bootstrap`; writes go through
 * `POST /ai-team/api/projects/:id/commands` (Human actor for now).
 *
 * The member runtime (real Agent sessions) lands in M2. Until then the
 * ledger/domain service is the only writer and the Host never fakes work.
 */
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openLedger } from './lib/ledger/writer.js';
import { TeamService } from './lib/host/service.js';

export const name = 'ai-team';

/** The workbench only makes sense where the Web carrier exists. */
export const inject = ['webServer'];

const VERSION = '0.1.0';
const PROJECT_ID = 'prj_main';
const HUMAN_ID = 'mem_human';

function send(res, body, status = 200) {
	if (res.writableEnded) return;
	res.statusCode = status;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.setHeader('cache-control', 'no-store');
	res.end(JSON.stringify(body));
}

async function readJson(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > 1_000_000) throw Object.assign(new Error('body too large'), { code: 'E_INVALID_ARGUMENT', status: 413 });
		chunks.push(chunk);
	}
	if (chunks.length === 0) return {};
	return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function dshHome() {
	return process.env.DSH_HOME || join(homedir(), '.dsh');
}

function profileName() {
	// The web launcher does not export DSH_PROFILE; the selected profile is in
	// the process args. Prefer it over the ambient shell env so two profiles
	// never share a ledger namespace.
	const index = process.argv.indexOf('--profile');
	if (index >= 0 && typeof process.argv[index + 1] === 'string') return process.argv[index + 1];
	return process.env.DSH_PROFILE || 'default';
}

function errorResponse(res, error) {
	const code = typeof error?.code === 'string' ? error.code : 'INTERNAL';
	const status = typeof error?.status === 'number' ? error.status : (code === 'E_STORAGE' ? 503 : 409);
	send(res, { error: { code, message: error?.message ?? 'command failed', details: error?.details ?? null } }, status);
}

/**
 * Open the default Project ledger and seed the Human + Project skeleton once.
 * A torn tail is repaired by the writer; the repair is recorded as a system
 * event so the append-only history explains the gap.
 */
async function boot() {
	const dataDir = join(dshHome(), 'ai-team', profileName());
	const projectDir = join(dataDir, 'projects', PROJECT_ID);
	mkdirSync(projectDir, { recursive: true });
	const ledger = openLedger({ dir: projectDir, projectId: PROJECT_ID, fsync: true });
	const service = new TeamService({ ledger });

	const repairs = ledger.opened?.repairs ?? (ledger.opened?.repair ? [ledger.opened.repair] : []);
	if (repairs.length > 0) {
		await ledger.append({
			type: 'ledger/repaired',
			payload: { repairs },
			actor: { kind: 'system' },
			projectId: PROJECT_ID,
		});
	}

	const state = service.state;
	if (state.members?.[HUMAN_ID] === undefined) {
		await service.dispatch({
			type: 'member.add',
			actor: { kind: 'human', memberId: HUMAN_ID },
			payload: { id: HUMAN_ID, name: '你', kind: 'human', role: 'Human' },
		});
	}
	if (state.projects?.[PROJECT_ID] === undefined) {
		await service.dispatch({
			type: 'project.create',
			actor: { kind: 'human', memberId: HUMAN_ID },
			payload: { name: '我的项目', goal: '把事交给团队', ownerId: HUMAN_ID },
		});
	}
	return { ledger, service, dataDir };
}

export function apply(ctx) {
	ctx.effect(() => {
		const webServer = ctx.get('webServer');
		if (webServer === undefined) return () => {};

		let booted = null;
		let bootError = null;
		const ready = boot()
			.then((value) => { booted = value; return value; })
			.catch((error) => {
				bootError = error;
				console.error('[ai-team] ledger boot failed:', error?.message ?? error);
				return null;
			});

		const sseClients = new Set();
		const snapshot = () => ({
			rev: booted.ledger.head.seq,
			generatedAt: Date.now(),
			board: booted.service.board(PROJECT_ID),
			quadrants: booted.service.quadrants(PROJECT_ID),
		});
		const broadcast = (event) => {
			const payload = {
				...snapshot(),
				type: 'change',
				event: event === undefined ? null : { id: event.id, type: event.type, seq: event.seq },
			};
			const frame = `event: change\ndata: ${JSON.stringify(payload)}\n\n`;
			for (const client of sseClients) {
				if (client.writableEnded || client.destroyed) {
					sseClients.delete(client);
					continue;
				}
				try {
					client.write(frame);
				} catch {
					sseClients.delete(client);
				}
			}
		};

		const dispose = webServer.register({
			kind: 'prefix',
			path: '/ai-team',
			handler: async (req, res) => {
				try {
					const url = new URL(req.url, 'http://local');
					await ready;
					if (booted === null) {
						return send(res, {
							error: { code: 'BOOT_FAILED', message: 'team ledger is unavailable', details: bootError?.message ?? null },
						}, 503);
					}

					if (req.method === 'GET' && url.pathname === '/ai-team/api/health') {
						const head = booted.ledger.head;
						return send(res, {
							ok: true,
							plugin: name,
							version: VERSION,
							projectId: PROJECT_ID,
							ledger: { events: booted.ledger.events.length, head },
						});
					}
					if (req.method === 'GET' && url.pathname === '/ai-team/api/bootstrap') {
						return send(res, booted.service.bootstrap(PROJECT_ID));
					}

					const events = url.pathname.match(/^\/ai-team\/api\/projects\/([^/]+)\/events$/);
					if (req.method === 'GET' && events !== null) {
						const projectId = decodeURIComponent(events[1]);
						if (projectId !== PROJECT_ID) {
							return send(res, { error: { code: 'NOT_FOUND', message: 'project not found' } }, 404);
						}
						res.writeHead(200, {
							'content-type': 'text/event-stream; charset=utf-8',
							'cache-control': 'no-cache, no-transform',
							connection: 'keep-alive',
							'x-accel-buffering': 'no',
						});
						res.write(`event: ready\ndata: ${JSON.stringify({ ...snapshot(), type: 'ready' })}\n\n`);
						sseClients.add(res);
						const cleanup = () => sseClients.delete(res);
						req.on('close', cleanup);
						res.on('close', cleanup);
						return;
					}

					const board = url.pathname.match(/^\/ai-team\/api\/projects\/([^/]+)\/board$/);
					if (req.method === 'GET' && board !== null) {
						const projectId = decodeURIComponent(board[1]);
						if (projectId !== PROJECT_ID) {
							return send(res, { error: { code: 'NOT_FOUND', message: 'project not found' } }, 404);
						}
						try {
							const doneLimit = Number.parseInt(url.searchParams.get('doneLimit') ?? '', 10);
							return send(res, booted.service.board(PROJECT_ID, {
								doneLimit: Number.isSafeInteger(doneLimit) ? doneLimit : undefined,
							}));
						} catch (error) {
							return errorResponse(res, error);
						}
					}

					const quadrants = url.pathname.match(/^\/ai-team\/api\/projects\/([^/]+)\/quadrants$/);
					if (req.method === 'GET' && quadrants !== null) {
						const projectId = decodeURIComponent(quadrants[1]);
						if (projectId !== PROJECT_ID) {
							return send(res, { error: { code: 'NOT_FOUND', message: 'project not found' } }, 404);
						}
						try {
							const q4Limit = Number.parseInt(url.searchParams.get('q4Limit') ?? '', 10);
							const q4Days = Number.parseFloat(url.searchParams.get('q4Days') ?? '');
							return send(res, booted.service.quadrants(PROJECT_ID, {
								q4Limit: Number.isSafeInteger(q4Limit) ? q4Limit : undefined,
								q4Days: Number.isFinite(q4Days) ? q4Days : undefined,
							}));
						} catch (error) {
							return errorResponse(res, error);
						}
					}

					const commands = url.pathname.match(/^\/ai-team\/api\/projects\/([^/]+)\/commands$/);
					if (req.method === 'POST' && commands !== null) {
						const projectId = decodeURIComponent(commands[1]);
						if (projectId !== PROJECT_ID) {
							return send(res, { error: { code: 'NOT_FOUND', message: 'project not found' } }, 404);
						}
						let body;
						try {
							body = await readJson(req);
						} catch (error) {
							return errorResponse(res, error.code === 'E_INVALID_ARGUMENT' ? error : Object.assign(error, {
								code: 'E_INVALID_ARGUMENT',
								message: 'JSON body is required',
								status: 400,
							}));
						}
						if (typeof body?.type !== 'string' || body.type === '') {
							return send(res, { error: { code: 'E_INVALID_ARGUMENT', message: 'command type is required' } }, 400);
						}
						try {
							const result = await booted.service.dispatch({
								type: body.type,
								payload: body.payload ?? {},
								actor: { kind: 'human', memberId: HUMAN_ID },
								projectId: PROJECT_ID,
								correlationId: typeof body.correlationId === 'string' ? body.correlationId : undefined,
							});
							send(res, { ok: true, ...result });
							broadcast(result.event);
							return;
						} catch (error) {
							return errorResponse(res, error);
						}
					}

					return send(res, { error: { code: 'NOT_FOUND', message: 'not found' } }, 404);
				} catch (error) {
					return errorResponse(res, error);
				}
			},
		});

		return () => {
			for (const client of sseClients) {
				try { client.end(); } catch { /* socket already gone */ }
			}
			sseClients.clear();
			dispose();
			if (booted !== null) booted.ledger.close();
		};
	}, 'ai-team: workbench routes');
}
