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
import { MemberRuntime, validatePermissionProfile } from './lib/runtime/member-runtime.js';
import { ensureHostAgent } from './lib/runtime/host-agent.js';
import { classifyLlmFailure, retryDecision } from './lib/runtime/failure-policy.js';
import { memberIdentity } from './lib/domain/member-profile.js';
import { loadSkillContext } from './lib/runtime/skill-loader.js';
import { createTeamTool } from './lib/host/member-tools.js';
import { describeWake, planWakes } from './lib/host/waker.js';

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
		const access = validatePermissionProfile({
			permissionPresets: ctx.get('permissionPresets'),
			sandboxPolicy: ctx.get('sandboxPolicy'),
		});
		const ready = access.ok
			? boot()
				.then((value) => { booted = value; return value; })
				.catch((error) => {
					bootError = error;
					console.error('[ai-team] ledger boot failed:', error?.message ?? error);
					return null;
				})
			: Promise.resolve(null);
		if (!access.ok) {
			bootError = Object.assign(new Error(access.reason), { code: access.code, status: 503 });
			console.error('[ai-team] refused to start:', access.code, access.reason);
		}

		const sseClients = new Set();
		const activations = new Map();
		// DSH exposes a model-request failure waterfall. We classify the failure,
		// record it, and only own recovery for retryable categories. No timers:
		// a retry is the DSH loop's own decision; our fallback config applies next wake.
		const offRequestError = typeof ctx.on === 'function'
			? ctx.on('agent/request-error', async (payload, next) => {
				if (booted === null) return next();
				const member = Object.values(booted.service.state.members ?? {})
					.find((candidate) => candidate.sessionId === payload?.agent?.id);
				if (member === undefined) return next();
				const failure = classifyLlmFailure(payload.failure);
				let recorded;
				try {
					recorded = await booted.service.recordMemberFailure(member.id, {
						...failure,
						provider: payload.provider ?? null,
						model: member.config?.model ?? null,
					});
				} catch {
					return next();
				}
				if (!failure.retryable) return next();
				const decision = retryDecision(failure, member.config ?? {}, recorded.member.attempts ?? 1);
				if (decision.action === 'fallback' && decision.patch !== undefined) {
					try {
						await booted.service.applySystemFallback(member.id, decision.patch, 'llm-fallback');
					} catch { /* policy/rollback failure must not turn into a retry storm */ }
				}
				if (decision.action === 'fail') return next();
				return { kind: 'retry' };
			})
			: () => {};
		const offSessionEvent = typeof ctx.on === 'function'
			? ctx.on('session/event', async (session, event) => {
				if (booted === null || event?.type !== 'turn/end') return;
				const member = Object.values(booted.service.state.members ?? {})
					.find((candidate) => candidate.sessionId === session?.id);
				if (member === undefined) return;
				// The child Agent owns a persisted session, but its live events are
				// buffered by the JSONL writer until a session/flush checkpoint. Flush
				// every member turn boundary so restart/memory can replay the history.
				const sessions = ctx.get('sessions');
				try {
					await sessions?.flush?.(session);
				} catch (error) {
					console.warn('[ai-team] member session flush failed:', error?.message ?? error);
				}
				if (event?.data?.reason?.kind !== 'completed') return;
				if (member.lastFailure === undefined || member.lastFailure === null) return;
				try {
					await booted.service.recordMemberRecovery(member.id, member.attempts ?? 0, member.config ?? null);
					broadcast(undefined);
				} catch { /* recovery is best-effort; the ledger still has the failure */ }
			})
			: () => {};
		let host = null;
		let hostPromise = null;
		const wakeKeys = new Set();
		const wakeFromResult = async (result, actor = {}) => {
			if (booted === null) return;
			const plans = planWakes(booted.service.state, result, actor);
			if (plans.length === 0) return;
			const subagents = ctx.get('subagents');
			const sessions = ctx.get('sessions');
			const permissionPresets = ctx.get('permissionPresets');
			const sandboxPolicy = ctx.get('sandboxPolicy');
			if (subagents === undefined || sessions === undefined || permissionPresets === undefined || sandboxPolicy === undefined) return;
			const providers = typeof subagents.list === 'function' ? subagents.list() : [];
			if (providers.length === 0) return;
			const parentInfo = await ensureParent();
			for (const plan of plans) {
				if (wakeKeys.has(plan.key)) continue;
				const member = booted.service.state.members?.[plan.memberId];
				if (member?.sessionId === undefined || member.sessionId === null) continue;
				// Reserve before the async delivery: the HTTP result and the ledger
				// event both schedule the same plan, and only one may deliver it.
				wakeKeys.add(plan.key);
				const runtime = new MemberRuntime({
					subagents, sessions, permissionPresets, sandboxPolicy,
					agents: ctx.get('agents'),
					direct: true,
					parent: parentInfo.agent,
					provider: providers[0],
					cwd: member.workspace ?? booted.dataDir,
				});
				try {
					const delivered = await runtime.wake(member, {
						prompt: describeWake(plan, booted.service.state) + await loadSkillContext(member, booted.dataDir),
					});
					await booted.service.recordWake(plan.memberId, {
						ok: true, taskId: plan.taskId, reason: plan.reason, messageId: delivered.messageId,
					});
				} catch (error) {
					wakeKeys.delete(plan.key);
					console.warn('[ai-team] wake failed:', plan.memberId, error?.code ?? error?.message ?? error);
					try {
						await booted.service.recordWake(plan.memberId, {
							ok: false, taskId: plan.taskId, reason: plan.reason, error: error?.code ?? error?.message ?? String(error),
						});
					} catch { /* ledger may be closed */ }
				}
			}
		};
		const distillMemberWithModel = async (payload) => {
			const member = booted?.service.state.members?.[payload.memberId];
			if (member === undefined || member.kind !== 'agent') {
				return { error: { code: 'E_NOT_FOUND', message: 'agent not found' }, status: 404 };
			}
			const llm = ctx.get('llm');
			if (llm?.stream === undefined) {
				return { error: { code: 'E_RUNTIME_UNAVAILABLE', message: 'llm service is unavailable' }, status: 503 };
			}
			const selection = member.config?.provider && member.config?.model
				? { provider: member.config.provider, model: member.config.model }
				: ctx.get('agentDefaultModel')?.currentSelection?.();
			if (!selection?.provider || !selection?.model) {
				return { error: { code: 'E_RUNTIME_UNAVAILABLE', message: 'no provider/model configured' }, status: 503 };
			}
			const tasks = Object.values(booted.service.state.tasks ?? {})
				.filter((task) => task.ownerId === member.id || task.assigneeId === member.id)
				.slice(-8)
				.map((task) => `#${task.number ?? '?'} ${task.title} [${task.status}]`)
				.join('\n');
			const prompt = [
				`成员：${member.name}`,
				`角色：${member.role || 'Team member'}`,
				`现有个性：${member.personality || '（空）'}`,
				`备忘：${(member.notes ?? []).slice(-8).join('；') || '（空）'}`,
				`技能：${(member.skills ?? []).join('、') || '（空）'}`,
				`最近任务：\n${tasks || '（无）'}`,
				'',
				'请基于以上材料，把这个成员的工作个性重新蒸馏成一段简洁、可执行、可验证的中文描述。',
				'只输出 JSON：{"personality":"..."}；不要输出 Markdown、解释或代码块。',
			].join('\n');
			let text = '';
			try {
				const stream = llm.stream({
					provider: selection.provider,
					model: selection.model,
					system: '你是团队的人格蒸馏器。只输出要求的 JSON，不调用工具。',
					messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
					maxTokens: 400,
				});
				for await (const chunk of stream) {
					if (chunk.type === 'text-delta') text += chunk.text;
					if (chunk.type === 'finish' && chunk.reason?.kind === 'error') {
						throw Object.assign(new Error(chunk.reason.failure?.message ?? 'model failed'), { code: chunk.reason.failure?.code ?? 'LLM_ERROR' });
					}
				}
			} catch (error) {
				return { error: { code: error?.code ?? 'E_DISTILL', message: error?.message ?? String(error) }, status: 502 };
			}
			const match = text.match(/\{[\s\S]*\}/);
			let personality = text.trim();
			if (match) {
				try { personality = JSON.parse(match[0]).personality ?? personality; } catch { /* keep text */ }
			}
			if (typeof personality !== 'string' || personality.trim() === '') {
				return { error: { code: 'E_DISTILL', message: 'model returned no personality' }, status: 502 };
			}
			const result = await booted.service.dispatch({
				type: 'member.distill',
				payload: { memberId: member.id, personality: personality.trim(), reason: payload.reason ?? 'model re-distill' },
				actor: { kind: 'human', memberId: HUMAN_ID },
				projectId: PROJECT_ID,
			});
			return { ok: true, member: result.member, distilled: { provider: selection.provider, model: selection.model } };
		};

		const tools = ctx.get('tools');
		const disposeTool = tools?.register
			? tools.register(createTeamTool({
				getState: () => booted?.service.state ?? { projects: {}, members: {}, tasks: {}, threads: {}, inbox: {} },
				dispatch: (command) => booted.service.dispatch(command),
			}), {
				when: (activation) => booted !== null && Object.values(booted.service.state.members ?? {})
					.some((member) => member.sessionId === activation?.agent?.id),
			})
			: () => {};

		const ensureParent = async () => {
			if (host !== null) return host;
			if (hostPromise === null) {
				const existingHost = booted?.service.state.hostSessionId;
				hostPromise = ensureHostAgent({
					agents: ctx.get('agents'),
					agentDefaultModel: ctx.get('agentDefaultModel'),
					workspaceRegistry: ctx.get('workspaceRegistry'),
					cwd: booted?.dataDir ?? process.cwd(),
					resumeSessionId: existingHost,
				}).then(async (value) => {
					if (value.created === true && existingHost === undefined) {
						await booted.service.bindHostSession(value.sessionId);
					}
					host = value;
					return value;
				}).catch((error) => {
					hostPromise = null;
					throw error;
				});
			}
			return hostPromise;
		};
		const activateMember = async (body) => {
			const member = booted.service.state.members?.[body.payload?.memberId];
			if (member === undefined) return { error: { code: 'E_NOT_FOUND', message: 'member not found' }, status: 404 };
			if (member.status === 'retired') return { error: { code: 'E_INVALID_STATE', message: 'member is retired' }, status: 409 };
			if (member.status === 'running') return { error: { code: 'E_INVALID_STATE', message: 'member is already running' }, status: 409 };
			const subagents = ctx.get('subagents');
			const sessions = ctx.get('sessions');
			const permissionPresets = ctx.get('permissionPresets');
			const sandboxPolicy = ctx.get('sandboxPolicy');
			if (subagents === undefined || sessions === undefined || permissionPresets === undefined || sandboxPolicy === undefined) {
				return { error: { code: 'E_RUNTIME_UNAVAILABLE', message: 'member runtime services are unavailable' }, status: 503 };
			}
			const providers = typeof subagents.list === 'function' ? subagents.list() : [];
			if (providers.length === 0) {
				return { error: { code: 'E_RUNTIME_UNAVAILABLE', message: 'no subagent provider is registered' }, status: 503 };
			}
			try {
				const selection = ctx.get('agentDefaultModel')?.currentSelection?.();
				const activationMember = member.config?.provider && member.config?.model
					? member
					: {
						...member,
						config: {
							...member.config,
							...(selection?.provider ? { provider: selection.provider } : {}),
							...(selection?.model ? { model: selection.model } : {}),
						},
					};
				if (!activationMember.config?.provider || !activationMember.config?.model) {
					return { error: { code: 'E_RUNTIME_UNAVAILABLE', message: 'no member or default provider/model is configured' }, status: 503 };
				}
				const parentInfo = await ensureParent();
				const runtime = new MemberRuntime({
					subagents,
					sessions,
					permissionPresets,
					sandboxPolicy,
					agents: ctx.get('agents'),
					direct: true,
					parent: parentInfo.agent,
					provider: providers[0],
					cwd: member.workspace ?? booted.dataDir,
				});
				const result = await runtime.activate(activationMember, {
					prompt: `${memberIdentity(activationMember)}\n\n${typeof body.payload?.prompt === 'string'
						? body.payload.prompt
						: '你被加入 AI Team。先读取项目简报与收件箱，再处理分配给你的任务。'}${await loadSkillContext(activationMember, booted.dataDir)}`,
				});
				let bound;
				try {
					bound = await booted.service.bindMemberSession(
						{ actor: { kind: 'human', memberId: HUMAN_ID }, projectId: PROJECT_ID },
						{ memberId: member.id, sessionId: result.childId },
					);
				} catch (error) {
					try { await result.activation.dispose?.(); } catch { /* already gone */ }
					throw error;
				}
				activations.set(result.childId, result.activation);
				return {
					ok: true,
					member: bound.member,
					sessionId: result.childId,
					messageId: result.messageId,
					debug: result.debug ?? null,
				};
			} catch (error) {
				try {
					await booted.service.failMember(
						{ actor: { kind: 'human', memberId: HUMAN_ID }, projectId: PROJECT_ID },
						{ memberId: member.id, reason: `${error.code ?? 'E_RUNTIME'}: ${error.message ?? error}` },
					);
				} catch { /* member may already be gone */ }
				return { error: { code: error.code ?? 'E_RUNTIME', message: error.message ?? String(error) }, status: 409 };
			}
		};
		const snapshot = () => ({
			rev: booted.ledger.head.seq,
			generatedAt: Date.now(),
			board: booted.service.board(PROJECT_ID),
			quadrants: booted.service.quadrants(PROJECT_ID),
		});
		ready.then((value) => {
			if (value !== null && value !== undefined) {
				value.ledger.onEvent = (event) => {
					broadcast(event);
					const actorId = event?.actor?.kind === 'agent' ? event.actor.memberId : undefined;
					void wakeFromResult({ event }, actorId === undefined ? {} : { agentId: actorId }).catch((error) => {
						console.warn('[ai-team] event wake planner failed:', error?.message ?? error);
					});
				};
				// A restart is an explicit lifecycle event: resume unfinished Tasks
				// once, without timers or periodic polling.
				void wakeFromResult({ event: { type: 'team/startup' } }, {}).catch((error) => {
					console.warn('[ai-team] startup wake planner failed:', error?.message ?? error);
				});
			}
		}).catch(() => {});
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
							runtime: {
								roots: ctx.get('agents')?.roots?.().length ?? null,
								defaultModel: ctx.get('agentDefaultModel')?.currentSelection?.() ?? null,
								llmProviders: ctx.get('llm')?.listProviders?.() ?? [],
								providers: ctx.get('subagents')?.list?.() ?? [],
								providerCaps: (ctx.get('subagents')?.list?.() ?? []).map((providerName) => {
									const provider = ctx.get('subagents')?.getProvider?.(providerName);
									return {
										name: providerName,
										capabilities: provider?.capabilities ?? null,
										inheritsParentContext: provider?.inheritsParentContext ?? null,
										continuable: typeof provider?.prepareContinuable === 'function',
										start: typeof provider?.start === 'function',
									};
								}),
								teamTool: ctx.get('tools')?.definitions?.().some((definition) => definition.name === 'team') ?? null,
								members: Object.values(booted.service.state.members ?? {})
									.filter((member) => member.kind === 'agent')
									.map((member) => {
										const agent = ctx.get('agents')?.get?.(member.sessionId);
										let lastEvent = null;
										let seq = null;
										try {
											const events = agent?.session?.snapshotEvents?.() ?? [];
											lastEvent = events.at(-1)?.type ?? null;
											seq = events.at(-1)?.seq ?? null;
										} catch { /* diagnostic only */ }
										let tail = [];
										try {
											tail = (agent?.session?.snapshotEvents?.() ?? []).slice(-20).map((entry) => ({
												seq: entry.seq,
												type: entry.type,
												tool: entry.type === 'tool/call' ? entry.data?.name ?? null : undefined,
												reason: entry.type === 'turn/end' ? entry.data?.reason ?? null : undefined,
												inbox: entry.type === 'agent/inbox/spliced'
													? {
														target: entry.data?.target ?? null,
														inserted: Array.isArray(entry.data?.inserted) ? entry.data.inserted.length : null,
													}
													: undefined,
											}));
										} catch { /* diagnostic only */ }
										return { id: member.id, status: agent?.status ?? null, lastEvent, seq, tail };
									}),
							},
						});
					}
					if (req.method === 'GET' && url.pathname === '/ai-team/api/bootstrap') {
						return send(res, {
							...booted.service.bootstrap(PROJECT_ID),
							runtime: {
								defaultModel: ctx.get('agentDefaultModel')?.currentSelection?.() ?? null,
								providers: ctx.get('subagents')?.list?.() ?? [],
							},
						});
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
						if (body.type === 'member.distill' && body.payload?.mode === 'model') {
							const distilled = await distillMemberWithModel(body.payload ?? {});
							if (distilled.error !== undefined) return send(res, { error: distilled.error }, distilled.status ?? 502);
							return send(res, distilled);
						}
						if (body.type === 'member.activate') {
							const activated = await activateMember(body);
							if (activated.error !== undefined) return send(res, { error: activated.error }, activated.status ?? 409);
							broadcast(undefined);
							return send(res, activated);
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
							void wakeFromResult(result, { agentId: HUMAN_ID }).catch((error) => {
								console.warn('[ai-team] wake planner failed:', error?.message ?? error);
							});
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
			for (const activation of activations.values()) {
				try { activation.dispose?.().catch?.(() => {}); } catch { /* already gone */ }
			}
			activations.clear();
			if (host !== null) void host.dispose?.();
			offRequestError();
			offSessionEvent();
			disposeTool();
			dispose();
			if (booted !== null) booted.ledger.close();
		};
	}, 'ai-team: workbench routes');
}
