import { existsSync, readFileSync, statSync } from 'node:fs';
import { ERRORS, fail } from '../domain/errors.js';
import { findReportPath, parseDecisionQuestions } from './decision-report.js';
import { ids } from '../domain/ids.js';
import { ackInboxItem, createInboxItem, isInformationalThreadMention } from '../domain/inbox.js';
import { chooseDecisionAnswers } from './pmo.js';
import {
	acceptTask,
	assignTask,
	cancelTask,
	claimTask,
	createTask,
	deleteTask,
	reassignTask,
	releaseTask,
	reopenTask,
	requestChangesTask,
	submitTask,
} from '../domain/task.js';
import { appendReply, createThread } from '../domain/thread.js';
import { boardView, quadrantsView, taskCard } from './views.js';
import { applyMemberConfigPatch, normalizeMemberConfig } from '../domain/member-config.js';
import { isQaMember, unfinishedTasksFor } from '../domain/member-profile.js';

function mentionsHuman(body) {
	return typeof body === 'string'
		&& /(^|[^A-Za-z])(human|@你|待你|需要你|请你|等你|你拍板)([^A-Za-z]|$)/i.test(body);
}

/**
 * Team domain service on top of a Project ledger.
 *
 * The ledger is the single writer and owns `state`; this service only:
 *   1. reads the current view from `ledger.state`,
 *   2. validates the command with the pure domain rules,
 *   3. appends one event and returns the committed result.
 *
 * `ledger.append` must update `ledger.state` before resolving (or provide a
 * synchronous state read after an awaited append).
 */
export class TeamService {
	/**
	 * @param {{ ledger: { state: any, append: (input: any) => Promise<any> }, now?: () => number, diag?: { append: (row: any) => any } }} options
	 */
	constructor(options) {
		this.ledger = options.ledger;
		this.now = options.now ?? (() => Date.now());
		this.memberConfigPolicy = options.memberConfigPolicy ?? {};
		/** Diagnostic sink ({ append(row) }); optional so tests run without it. */
		this.diag = options.diag ?? null;
	}

	get state() {
		return this.ledger.state;
	}

	/** The Human member id, derived once per call from the folded state. */
	humanId() {
		return this.state.humanMemberId
			?? Object.values(this.state.members ?? {}).find((member) => member.kind === 'human')?.id
			?? null;
	}

	/** Four-column board derived from the same ledger state. */
	board(projectId, options = {}) {
		if (projectId !== undefined && this.state.projects?.[projectId] === undefined) {
			fail(ERRORS.NOT_FOUND, `project ${String(projectId)} not found`);
		}
		return boardView(this.state, options);
	}

	/** Four-quadrant situation view; Human is the only attention target. */
	quadrants(projectId, options = {}) {
		if (projectId !== undefined && this.state.projects?.[projectId] === undefined) {
			fail(ERRORS.NOT_FOUND, `project ${String(projectId)} not found`);
		}
		const human = options.humanMemberId ?? this.humanId() ?? 'mem_human';
		return quadrantsView(this.state, { ...options, humanMemberId: human });
	}

	/** One page of workbench state; the UI reads this instead of the ledger. */
	bootstrap(projectId, threadTaskId) {
		const state = this.state;
		const projects = Object.values(state.projects ?? {}).map((p) => ({
			id: p.id, name: p.name, goal: p.goal ?? '', owner: p.ownerName ?? p.ownerMemberId ?? p.ownerId, workspacePath: p.workspacePath ?? '', pmoAuto: p.pmoAuto !== false, active: p.status !== 'archived',
		}));
		const members = Object.values(state.members ?? {}).map((m) => ({
			id: m.id,
			name: m.name,
			role: m.role ?? '',
			status: m.status ?? 'idle',
			kind: m.kind ?? 'agent',
			sessionId: m.sessionId ?? null,
			preset: m.config?.preset ?? m.preset ?? 'standard',
			personality: m.personality ?? '',
			notes: m.notes ?? [],
			skills: m.skills ?? [],
			profileVersion: m.profileVersion ?? 1,
			distillVersion: m.distillVersion ?? 0,
			distilledAt: m.distilledAt ?? null,
			talentPool: m.talentPool === true,
			leftTeamAt: m.leftTeamAt ?? null,
			qa: isQaMember(m),
			config: m.config ?? null,
			configVersion: m.configVersion ?? 0,
			lastFailure: m.lastFailure ?? null,
			attempts: m.attempts ?? 0,
			lastRecoveredAt: m.lastRecoveredAt ?? null,
		}));
		const agents = members.filter((m) => m.kind !== 'human');
		// One Task card shape for board, quadrants and bootstrap; bootstrap only
		// adds the submission bookkeeping the panel needs.
		const tasks = Object.values(state.tasks ?? {})
			.filter((task) => task.tombstone !== true && task.status !== 'deleted')
			.map((task) => ({ ...taskCard(state, task), qaChecks: task.qaChecks ?? [] }));
		const project = projectId === undefined ? projects[0] : projects.find((p) => p.id === projectId);
		// 大规模/长迭代裁剪：面板只需要最近的窗口，全史在账本里按需取。
		// stream 投影本身已封顶（≤500），bootstrap 再按窗口切尾。
		const stream = project === undefined
			? []
			: (state.stream ?? []).filter((entry) => entry.projectId === project.id).slice(-200);
		const selected = threadTaskId ?? tasks.find((task) => task.status === 'in_progress')?.id ?? tasks[0]?.id;
		const threadOf = (taskId) => {
			const full = taskId === undefined || taskId === null ? undefined : state.threads?.[taskId];
			if (full === undefined) return { taskId, headSeq: 0, entries: [], entryTotal: 0 };
			const entries = Array.isArray(full.entries) ? full.entries : [];
			return { ...full, entries: entries.slice(-50), entryTotal: full.headSeq ?? entries.length };
		};
		const thread = selected === undefined ? null : threadOf(selected);
		const threads = Object.fromEntries(tasks.map((task) => [task.id, threadOf(task.id)]));
		const inbox = Object.values(state.inbox ?? {}).filter((item) =>
			(item.memberId === this.humanId())
			&& !isInformationalThreadMention(item));
		return {
			project: project ?? null,
			projects,
			agents,
			members,
			tasks,
			stream,
			thread,
			threads,
			inbox,
			board: project === undefined ? null : this.board(project.id),
			quadrants: project === undefined ? null : this.quadrants(project.id),
		};
	}

	/**
	 * Create missing Human decision items for existing Agent Thread messages
	 * that explicitly asked Human to decide. Runs on Project open once; the
	 * per-entry dedupe makes it idempotent.
	 */
	async backfillHumanMentions(workspacePath = '') {
		const humanId = this.humanId();
		if (humanId === null) return 0;
		const projectId = Object.keys(this.state.projects ?? {})[0];
		let reportPath = null;
		for (const task of Object.values(this.state.tasks ?? {})) {
			for (const entry of this.state.threads?.[task.id]?.entries ?? []) {
				const found = findReportPath(entry.body);
				if (found !== null && existsSync(found)) { reportPath = found; break; }
			}
			if (reportPath !== null) break;
		}
		let reportQuestions = [];
		if (reportPath !== null) {
			try {
				// An agent-authored path drives a server-side read here; cap the
				// read so a giant or adversarial report cannot flood memory.
				if (statSync(reportPath).size > 256 * 1024) reportPath = null;
			} catch { reportPath = null; }
		}
		if (reportPath !== null) {
			try {
				reportQuestions = parseDecisionQuestions(readFileSync(reportPath, 'utf8'));
			} catch { /* report may be unavailable; keep the Thread fallback */ }
		}
		if (reportQuestions.length === 0) return 0;
		const candidates = [];
		for (const task of Object.values(this.state.tasks ?? {})) {
			if (task.tombstone === true) continue;
			for (const entry of this.state.threads?.[task.id]?.entries ?? []) {
				const author = this.state.members?.[entry.authorId];
				if (author?.kind !== 'agent' || !mentionsHuman(entry.body)) continue;
				candidates.push({ task, entry, key: `${task.id}:${entry.seq}` });
			}
		}
		if (candidates.length > 0) {
			const alreadyStructured = Object.values(this.state.inbox ?? {}).some((item) =>
				item.memberId === humanId
				&& item.ref?.source === reportPath
				&& Array.isArray(item.ref?.questions)
				&& item.ref.questions.length > 0);
			if (alreadyStructured) return 0;
			const chosen = candidates.find((candidate) => /§6|六问/.test(candidate.entry.body))
				?? candidates.sort((left, right) => (right.entry.seq ?? 0) - (left.entry.seq ?? 0))[0];
			const item = createInboxItem({
				memberId: humanId,
				type: 'decision_required',
				ref: {
					taskId: chosen.task.id,
					entrySeq: chosen.entry.seq,
					memberId: chosen.entry.authorId,
					memberName: this.state.members?.[chosen.entry.authorId]?.name ?? chosen.entry.authorId,
					category: 'thread_mention',
					title: `需 Human 决策 · ${reportQuestions.length} 问`,
					questions: reportQuestions,
					source: reportPath,
				},
				requiresDecision: true,
			}, { at: this.now() });
			await this.ledger.append({
				type: 'inbox/item-created',
				payload: { itemId: item.id, ...item },
				actor: { kind: 'system' },
				projectId,
				at: this.now(),
			});
			return 1;
		}
		return 0;
	}

	/**
	 * Dispatch one command. The caller is an exact Team member (or Human) and
	 * the ledger serializes commands per Project.
	 * @param {{ type: string, payload?: any, actor: { kind: string, memberId?: string }, correlationId?: string, projectId?: string }} command
	 */
	async dispatch(command) {
		const payload = command.payload ?? {};
		const actor = command.actor;
		// Diagnostic trail: one entry row per command, one failure row on throw,
		// one done row with the duration in every case. 前置校验失败也必须留痕
		// （errors 档只留 .fail 行，校验抛出必须发生在 try 内才能落行）。
		const startedAt = Date.now();
		const failRow = (code, message) => {
			this.diag?.append({
				ev: 'dispatch.fail',
				type: command.type,
				code,
				projectId: command.projectId ?? null,
				message,
				elapsedMs: Date.now() - startedAt,
			});
		};
		this.diag?.append({
			ev: 'dispatch.start',
			type: command.type,
			actor: actor?.kind ?? null,
			memberId: actor?.memberId ?? null,
			projectId: command.projectId ?? null,
		});
		try {
			if (actor === undefined || (actor.kind !== 'human' && actor.kind !== 'agent')) {
				failRow(ERRORS.UNAUTHORIZED, 'an exact Team member is required');
				fail(ERRORS.UNAUTHORIZED, 'an exact Team member is required');
			}
			// An agent actor must resolve to a live, non-retired member: otherwise a
			// forged or stale memberId would bypass owner/QA checks downstream.
			if (actor.kind === 'agent') {
				const actingMember = this.state.members?.[actor.memberId];
				if (actingMember === undefined || actingMember.kind !== 'agent') {
					failRow(ERRORS.UNAUTHORIZED, `agent actor ${String(actor.memberId ?? '?')} is not a Team member`);
					fail(ERRORS.UNAUTHORIZED, `agent actor ${String(actor.memberId ?? '?')} is not a Team member`);
				}
				if (actingMember.status === 'retired') {
					failRow(ERRORS.INVALID_STATE, `agent ${actingMember.name ?? actingMember.id} is retired`);
					fail(ERRORS.INVALID_STATE, `agent ${actingMember.name ?? actingMember.id} is retired`);
				}
			}
			switch (command.type) {
				case 'project.create': return await this.createProject(command, payload);
				case 'project.owner.update': return await this.changeProjectOwner(command, payload);
				case 'project.workspace.update': return await this.changeProjectWorkspace(command, payload);
				case 'project.pmo.update': return await this.setProjectPmo(command, payload);
				case 'stream.post': return await this.postStream(command, payload);
				case 'member.add': return await this.addMember(command, payload);
				case 'member.bind': return await this.bindMemberSession(command, payload);
				case 'member.fail': return await this.failMember(command, payload);
				case 'member.retire': return await this.retireMember(command, payload);
				case 'member.profile.update': return await this.updateMemberProfile(command, payload);
				case 'member.evolve': return await this.evolveMember(command, payload);
				case 'member.distill': return await this.distillMember(command, payload);
				case 'member.leave': return await this.leaveMember(command, payload);
				case 'member.rejoin': return await this.rejoinMember(command, payload);
				case 'member.takeover': return await this.takeoverMember(command, payload);
				case 'member.message': return await this.messageMember(command, payload);
				case 'member.note': return await this.addMemberNote(command, payload);
				case 'member.skill': return await this.addMemberSkill(command, payload);
				case 'member.config.update': return await this.updateMemberConfig(command, payload);
				case 'member.retry': return await this.retryMember(command, payload);
				case 'task.create': return await this.createTask(command, payload);
				case 'task.claim': return await this.taskCommand(command, 'claim');
				case 'task.release': return await this.taskCommand(command, 'release');
				case 'task.assign': return await this.taskCommand(command, 'assign');
				case 'task.submit': return await this.taskCommand(command, 'submit');
				case 'task.accept': return await this.taskCommand(command, 'accept');
				case 'task.request_changes': return await this.taskCommand(command, 'request_changes');
				case 'task.cancel': return await this.taskCommand(command, 'cancel');
				case 'task.reopen': return await this.taskCommand(command, 'reopen');
				case 'task.reassign': return await this.taskCommand(command, 'reassign');
				case 'task.delete': return await this.taskCommand(command, 'delete');
				case 'task.convert': return await this.convert(command, payload);
				case 'task.follow': return await this.follow(command, payload);
				case 'thread.post': return await this.postThread(command, payload);
				case 'inbox.ack': return await this.ack(command, payload);
				case 'decision.request': return await this.requestDecision(command, payload);
				case 'decision.answer': return await this.answerDecision(command, payload);
				default: fail(ERRORS.INVALID_ARGUMENT, `unknown command: ${String(command.type)}`);
			}
		} catch (error) {
			this.diag?.append({
				ev: 'dispatch.fail',
				type: command.type,
				code: error?.code ?? 'INTERNAL',
				projectId: command.projectId ?? null,
				message: error?.message ?? String(error),
				elapsedMs: Date.now() - startedAt,
			});
			throw error;
		} finally {
			this.diag?.append({
				ev: 'dispatch.done',
				type: command.type,
				projectId: command.projectId ?? null,
				elapsedMs: Date.now() - startedAt,
			});
		}
	}

	async append(command, type, payload) {
		const event = await this.ledger.append({
			type,
			payload,
			actor: command.actor,
			correlationId: command.correlationId,
			at: this.now(),
		});
		return { event, result: payload };
	}

	async createProject(command, payload) {
		if (command.actor.kind !== 'human') fail(ERRORS.UNAUTHORIZED, 'only Human may create a Project');
		if (typeof payload.name !== 'string' || payload.name.trim() === '') fail(ERRORS.INVALID_ARGUMENT, 'project name is required');
		const id = this.ledger.projectId ?? payload.id ?? ids.project();
		const ownerMemberId = payload.ownerId ?? command.actor.memberId ?? this.humanId();
		const project = {
			id,
			name: payload.name.trim(),
			goal: payload.goal ?? '',
			ownerMemberId,
			workspacePath: payload.workspacePath ?? '',
			status: 'active',
			createdAt: this.now(),
		};
		await this.append({ ...command, projectId: id }, 'project/created', {
			name: project.name,
			goal: project.goal,
			ownerMemberId,
			workspacePath: project.workspacePath,
			pmoAuto: payload.pmoAuto !== false,
			status: project.status,
		});
		return { project };
	}

	async changeProjectWorkspace(command, payload) {
		if (command.actor.kind !== 'human') fail(ERRORS.UNAUTHORIZED, 'only Human may change the Project workspace');
		const projectId = command.projectId;
		const project = this.state.projects?.[projectId];
		if (project === undefined) fail(ERRORS.NOT_FOUND, `project ${String(projectId)} not found`);
		if (typeof payload.workspacePath !== 'string' || payload.workspacePath.trim() === '') {
			fail(ERRORS.INVALID_ARGUMENT, 'workspacePath is required');
		}
		const workspacePath = payload.workspacePath.trim();
		await this.append(command, 'project/workspace-changed', {
			projectId,
			workspacePath,
			reason: payload.reason ?? '',
		});
		return { project: { ...project, workspacePath } };
	}

	async setProjectPmo(command, payload) {
		const projectId = command.projectId;
		const project = this.state.projects?.[projectId];
		if (project === undefined) fail(ERRORS.NOT_FOUND, `project ${String(projectId)} not found`);
		if (typeof payload.pmoAuto !== 'boolean') fail(ERRORS.INVALID_ARGUMENT, 'pmoAuto must be boolean');
		const isOwner = command.actor.kind === 'agent' && command.actor.memberId === project.ownerMemberId;
		if (command.actor.kind !== 'human' && !isOwner) fail(ERRORS.UNAUTHORIZED, 'only Human or the Project owner may change PMO mode');
		await this.append(command, 'project/pmo-updated', { projectId, pmoAuto: payload.pmoAuto, reason: payload.reason ?? '' });
		return { project: { ...project, pmoAuto: payload.pmoAuto } };
	}

	async changeProjectOwner(command, payload) {
		if (command.actor.kind !== 'human') fail(ERRORS.UNAUTHORIZED, 'only Human may change the Project owner');
		const projectId = command.projectId;
		const project = this.state.projects?.[projectId];
		if (project === undefined) fail(ERRORS.NOT_FOUND, `project ${String(projectId)} not found`);
		const ownerMemberId = payload.ownerMemberId;
		if (typeof ownerMemberId !== 'string' || this.state.members?.[ownerMemberId] === undefined) {
			fail(ERRORS.INVALID_ARGUMENT, 'ownerMemberId must name an existing member');
		}
		await this.append(command, 'project/owner-changed', { projectId, ownerMemberId, reason: payload.reason ?? '' });
		return { project: { ...project, ownerMemberId } };
	}

	async postStream(command, payload) {
		const body = typeof payload.body === 'string' ? payload.body.trim() : '';
		if (body === '') fail(ERRORS.INVALID_ARGUMENT, 'stream message body is required');
		const author = this.state.members?.[command.actor.memberId];
		if (author === undefined) fail(ERRORS.UNAUTHORIZED, 'actor must be a Team member');
		// seq 由账本事件定（fold 用 event.seq；payload 里的幻影计数会被忽略，
		// 并发下还会重复——曾造成 API 返回值与投影不一致）。
		const entry = {
			kind: 'human_message',
			authorId: author.id,
			body,
			at: this.now(),
		};
		const event = await this.ledger.append({
			type: 'stream/posted',
			payload: entry,
			actor: command.actor,
			projectId: command.projectId,
			at: this.now(),
		});
		return { entry: { ...entry, seq: event.seq }, event };
	}

	async addMember(command, payload) {
		if (command.actor.kind !== 'human') fail(ERRORS.UNAUTHORIZED, 'only Human may create a member');
		if (typeof payload.name !== 'string' || payload.name.trim() === '') fail(ERRORS.INVALID_ARGUMENT, 'member name is required');
		const member = {
			id: payload.id ?? ids.member(),
			name: payload.name.trim(),
			kind: payload.kind === 'human' ? 'human' : 'agent',
			role: payload.role ?? '',
			personality: typeof payload.personality === 'string' ? payload.personality : '',
			status: typeof payload.status === 'string' ? payload.status : 'idle',
			createdAt: this.now(),
		};
		await this.append(command, 'project/member-added', {
			memberId: member.id,
			name: member.name,
			kind: member.kind,
			role: member.role,
			personality: member.personality,
			status: member.status,
			projectId: payload.projectId,
		});
		return { member };
	}

	async recordWake(memberId, info, projectId = Object.keys(this.state.projects ?? {})[0]) {
		const event = {
			type: info.ok === true ? 'wake/delivered' : 'wake/failed',
			payload: { memberId, taskId: info.taskId ?? null, reason: info.reason ?? null, messageId: info.messageId ?? null, error: info.error ?? null },
			actor: { kind: 'system' },
			projectId,
			at: this.now(),
		};
		await this.ledger.append(event);
		return event;
	}

	async bindHostSession(sessionId, projectId = Object.keys(this.state.projects ?? {})[0]) {
		if (typeof sessionId !== 'string' || sessionId === '') fail(ERRORS.INVALID_ARGUMENT, 'host sessionId is required');
		await this.ledger.append({
			type: 'team/host-bound',
			payload: { sessionId },
			actor: { kind: 'system' },
			projectId,
			at: this.now(),
		});
		return { sessionId };
	}

	async bindMemberSession(command, payload) {
		if (command.actor.kind !== 'human') fail(ERRORS.UNAUTHORIZED, 'only Human may bind a member session');
		const member = this.state.members?.[payload.memberId];
		if (member === undefined) fail(ERRORS.NOT_FOUND, `member ${String(payload.memberId)} not found`);
		// 退役成员不得经 bind 复活；重新入队必须走 member.rejoin（清 talentPool）。
		if (member.status === 'retired') fail(ERRORS.INVALID_STATE, `member ${member.name ?? member.id} is retired`);
		if (typeof payload.sessionId !== 'string' || payload.sessionId === '') fail(ERRORS.INVALID_ARGUMENT, 'sessionId is required');
		await this.append(command, 'member/session-bound', {
			memberId: member.id,
			sessionId: payload.sessionId,
			status: 'running',
		});
		return { member: { ...member, sessionId: payload.sessionId, status: 'running' } };
	}

	async failMember(command, payload) {
		if (command.actor.kind !== 'human') fail(ERRORS.UNAUTHORIZED, 'only Human may mark a member failed');
		const member = this.state.members?.[payload.memberId];
		if (member === undefined) fail(ERRORS.NOT_FOUND, `member ${String(payload.memberId)} not found`);
		await this.append(command, 'member/failed', { memberId: member.id, reason: payload.reason ?? '' });
		return { member: { ...member, status: 'failed', failure: payload.reason ?? '' } };
	}

	async retireMember(command, payload) {
		if (command.actor.kind !== 'human') fail(ERRORS.UNAUTHORIZED, 'only Human may retire a member');
		const member = this.state.members?.[payload.memberId];
		if (member === undefined) fail(ERRORS.NOT_FOUND, `member ${String(payload.memberId)} not found`);
		await this.append(command, 'project/member-retired', { memberId: member.id });
		return { member: { ...member, status: 'retired' } };
	}

	async updateMemberProfile(command, payload) {
		if (command.actor.kind !== 'human') fail(ERRORS.UNAUTHORIZED, 'only Human may change name, role or personality');
		const member = this.state.members?.[payload.memberId];
		if (member === undefined || member.kind !== 'agent') fail(ERRORS.NOT_FOUND, `agent ${String(payload.memberId)} not found`);
		const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);
		const name = text(payload.name);
		const role = text(payload.role);
		// An empty personality means "leave it unchanged", not "clear it".
		const personality = text(payload.personality);
		if (name === undefined && role === undefined && personality === undefined) {
			fail(ERRORS.INVALID_ARGUMENT, 'name, role or personality is required');
		}
		await this.append(command, 'member/profile-updated', {
			memberId: member.id,
			...(name === undefined ? {} : { name }),
			...(role === undefined ? {} : { role }),
			...(personality === undefined ? {} : { personality }),
			updatedBy: command.actor.memberId,
			reason: payload.reason ?? '',
		});
		return { member: this.state.members[member.id] };
	}

	/** An Agent may evolve its own working personality, never its name/role. */
	async evolveMember(command, payload) {
		if (command.actor.kind !== 'agent') fail(ERRORS.UNAUTHORIZED, 'only an Agent may evolve its personality');
		const member = this.state.members?.[command.actor.memberId];
		if (member === undefined) fail(ERRORS.NOT_FOUND, 'actor member not found');
		if (payload.memberId !== undefined && payload.memberId !== member.id) {
			fail(ERRORS.UNAUTHORIZED, 'an Agent may only evolve itself');
		}
		const personality = typeof payload.personality === 'string' ? payload.personality.trim() : '';
		if (personality === '') fail(ERRORS.INVALID_ARGUMENT, 'personality is required');
		await this.append(command, 'member/distilled', {
			memberId: member.id,
			personality,
			updatedBy: member.id,
			reason: payload.reason ?? 'self-evolution',
		});
		return { member: this.state.members[member.id] };
	}

	/** Human/Lead-triggered distillation snapshot; model quality is a later step. */
	async distillMember(command, payload) {
		if (command.actor.kind !== 'human' && command.actor.kind !== 'agent') fail(ERRORS.UNAUTHORIZED, 'a member is required');
		const member = this.state.members?.[payload.memberId];
		if (member === undefined || member.kind !== 'agent') fail(ERRORS.NOT_FOUND, `agent ${String(payload.memberId)} not found`);
		const lead = this.state.projects?.[command.projectId]?.ownerMemberId === command.actor.memberId;
		if (command.actor.kind !== 'human' && !lead && command.actor.memberId !== member.id) {
			fail(ERRORS.UNAUTHORIZED, 'only Human, the Project owner or the member may distill');
		}
		const personality = typeof payload.personality === 'string' && payload.personality.trim() !== ''
			? payload.personality.trim()
			: member.personality ?? '';
		if (personality === '') fail(ERRORS.INVALID_ARGUMENT, 'personality is required for distillation');
		await this.append(command, 'member/distilled', {
			memberId: member.id,
			personality,
			updatedBy: command.actor.memberId,
			reason: payload.reason ?? 're-distill',
		});
		return { member: this.state.members[member.id] };
	}

	async messageMember(command, payload) {
		if (command.actor.kind !== 'human') fail(ERRORS.UNAUTHORIZED, 'only Human may message a member');
		const member = this.state.members?.[payload.memberId];
		if (member === undefined || member.kind !== 'agent') fail(ERRORS.NOT_FOUND, `agent ${String(payload.memberId)} not found`);
		const body = typeof payload.body === 'string' ? payload.body.trim() : '';
		if (body === '') fail(ERRORS.INVALID_ARGUMENT, 'message body is required');
		const event = await this.ledger.append({
			type: 'member/message',
			payload: { memberId: member.id, authorId: command.actor.memberId, body, at: this.now() },
			actor: command.actor,
			correlationId: command.correlationId,
			projectId: command.projectId,
			at: this.now(),
		});
		return { event, memberId: member.id };
	}

	async addMemberNote(command, payload) {
		const member = this.state.members?.[payload.memberId ?? command.actor.memberId];
		if (member === undefined || member.kind !== 'agent') fail(ERRORS.NOT_FOUND, `agent ${String(payload.memberId ?? command.actor.memberId)} not found`);
		if (command.actor.kind === 'agent' && command.actor.memberId !== member.id) {
			fail(ERRORS.UNAUTHORIZED, 'an Agent may only note itself');
		}
		const text = typeof payload.text === 'string' ? payload.text.trim() : '';
		if (text === '') fail(ERRORS.INVALID_ARGUMENT, 'note text is required');
		await this.append(command, 'member/note-added', {
			memberId: member.id,
			text,
			addedBy: command.actor.memberId,
		});
		return { member: this.state.members[member.id] };
	}

	async addMemberSkill(command, payload) {
		const member = this.state.members?.[payload.memberId ?? command.actor.memberId];
		if (member === undefined || member.kind !== 'agent') fail(ERRORS.NOT_FOUND, `agent ${String(payload.memberId ?? command.actor.memberId)} not found`);
		if (command.actor.kind === 'agent' && command.actor.memberId !== member.id) {
			fail(ERRORS.UNAUTHORIZED, 'an Agent may only add its own skill');
		}
		const name = typeof payload.name === 'string' ? payload.name.trim() : '';
		if (name === '') fail(ERRORS.INVALID_ARGUMENT, 'skill name is required');
		await this.append(command, 'member/skill-added', {
			memberId: member.id,
			name,
			addedBy: command.actor.memberId,
		});
		return { member: this.state.members[member.id] };
	}

	async leaveMember(command, payload) {
		if (command.actor.kind !== 'human') fail(ERRORS.UNAUTHORIZED, 'only Human may move a member to the talent pool');
		const member = this.state.members?.[payload.memberId];
		if (member === undefined || member.kind !== 'agent') fail(ERRORS.NOT_FOUND, `agent ${String(payload.memberId)} not found`);
		const unfinished = unfinishedTasksFor(this.state, member.id);
		await this.append(command, 'member/left-team', { memberId: member.id, reason: payload.reason ?? '' });
		return {
			member: this.state.members[member.id],
			unfinishedTasks: unfinished.map((task) => ({ id: task.id, number: task.number, title: task.title, status: task.status })),
		};
	}

	async rejoinMember(command, payload) {
		if (command.actor.kind !== 'human') fail(ERRORS.UNAUTHORIZED, 'only Human may recruit from the talent pool');
		const member = this.state.members?.[payload.memberId];
		if (member === undefined || member.kind !== 'agent') fail(ERRORS.NOT_FOUND, `agent ${String(payload.memberId)} not found`);
		if (member.status !== 'retired') fail(ERRORS.INVALID_STATE, 'member is already in the team');
		await this.append(command, 'member/rejoined', { memberId: member.id, reason: payload.reason ?? '' });
		return { member: this.state.members[member.id] };
	}

	async takeoverMember(command, payload) {
		if (command.actor.kind !== 'human') fail(ERRORS.UNAUTHORIZED, 'only Human may assign a successor');
		const from = this.state.members?.[payload.fromMemberId];
		const to = this.state.members?.[payload.toMemberId];
		if (from === undefined) fail(ERRORS.NOT_FOUND, `member ${String(payload.fromMemberId)} not found`);
		if (to === undefined || to.kind !== 'agent' || to.status === 'retired') {
			fail(ERRORS.INVALID_ARGUMENT, 'successor must be an active Agent');
		}
		const unfinished = unfinishedTasksFor(this.state, from.id);
		const taken = [];
		for (const task of unfinished) {
			await this.append(command, 'task/taken-over', {
				taskId: task.id,
				revision: task.revision + 1,
				fromMemberId: from.id,
				toMemberId: to.id,
				reason: payload.reason ?? `takeover from ${from.name}`,
			});
			taken.push(this.state.tasks[task.id]);
		}
		return { from: from.id, to: to.id, tasks: taken };
	}

	/** Lead (Project owner) or Human may update another member's config. */
	async updateMemberConfig(command, payload) {
		const member = this.state.members?.[payload.memberId];
		if (member === undefined) fail(ERRORS.NOT_FOUND, `member ${String(payload.memberId)} not found`);
		const project = this.state.projects?.[command.projectId];
		const isHuman = command.actor.kind === 'human';
		const isLead = project?.ownerMemberId === command.actor.memberId || project?.ownerId === command.actor.memberId;
		if (!isHuman && !isLead) fail(ERRORS.UNAUTHORIZED, 'only the Project owner or Human may update member config');
		if (command.actor.memberId === member.id) {
			fail(ERRORS.UNAUTHORIZED, 'a member cannot update its own config; Lead self-config is Human-only');
		}
		if (Number.isSafeInteger(payload.expectedConfigVersion) && payload.expectedConfigVersion !== (member.configVersion ?? 0)) {
			fail(ERRORS.REVISION, 'member config changed since you read it', {
				details: { expected: payload.expectedConfigVersion, current: member.configVersion ?? 0 },
			});
		}
		const current = normalizeMemberConfig(member.config ?? {});
		const result = applyMemberConfigPatch(current, payload.patch ?? {}, {
			policy: { ...this.memberConfigPolicy, ...(payload.policy ?? {}) },
			configVersion: member.configVersion ?? 0,
		});
		if (!result.changed) return { member, config: current, changed: false };
		const nextConfig = {
			...result.config,
			updatedBy: command.actor.memberId ?? command.actor.kind,
			updatedAt: this.now(),
			reason: typeof payload.reason === 'string' ? payload.reason : '',
		};
		await this.append(command, 'member/config-updated', {
			memberId: member.id,
			config: nextConfig,
			configVersion: nextConfig.configVersion,
			before: result.before,
			reason: nextConfig.reason,
		});
		return { member: { ...member, config: nextConfig, configVersion: nextConfig.configVersion }, config: nextConfig, changed: true };
	}

	async retryMember(command, payload) {
		const member = this.state.members?.[payload.memberId];
		if (member === undefined) fail(ERRORS.NOT_FOUND, `member ${String(payload.memberId)} not found`);
		// 退役成员的重启必须走 member.rejoin（清 talentPool/leftTeamAt）。
		if (member.status === 'retired') fail(ERRORS.INVALID_STATE, `member ${member.name ?? member.id} is retired; use member.rejoin`);
		const project = this.state.projects?.[command.projectId];
		const isHuman = command.actor.kind === 'human';
		const isLead = project?.ownerMemberId === command.actor.memberId || project?.ownerId === command.actor.memberId;
		if (!isHuman && !isLead) fail(ERRORS.UNAUTHORIZED, 'only the Project owner or Human may retry a member');
		await this.append(command, 'member/retry-requested', {
			memberId: member.id,
			reason: typeof payload.reason === 'string' ? payload.reason : '',
		});
		return { member: { ...member, status: 'provisioning' } };
	}

	/** Host/Waker calls these; actor is system, never a Human decision. */
	async recordMemberFailure(memberId, failure, projectId = Object.keys(this.state.projects ?? {})[0]) {
		const member = this.state.members?.[memberId];
		if (member === undefined) fail(ERRORS.NOT_FOUND, `member ${String(memberId)} not found`);
		const attempt = Number.isSafeInteger(failure.attempt) ? failure.attempt : (member.lastFailure?.attempt ?? 0) + 1;
		const fatal = failure.category === 'auth' || failure.category === 'billing' || failure.category === 'policy' || failure.category === 'unknown';
		const recorded = { ...failure, attempt };
		await this.ledger.append({
			type: 'member/llm-failed',
			payload: { ...recorded, memberId, fatal },
			actor: { kind: 'system' },
			projectId,
			at: this.now(),
		});
		this.diag?.append({
			ev: fatal ? 'member.fail' : 'member.llm-failed',
			memberId,
			category: recorded.category,
			attempt,
			provider: recorded.provider ?? null,
			model: recorded.model ?? null,
			projectId,
		});
		let inboxItem = null;
		if (fatal) {
			const humanId = this.humanId();
			const duplicate = humanId === null ? undefined : Object.values(this.state.inbox ?? {}).find((item) =>
				item.memberId === humanId
				&& item.requiresDecision === true
				&& item.ref?.memberId === memberId
				&& !['resolved', 'dismissed', 'superseded'].includes(item.state));
			if (humanId !== null && duplicate === undefined) {
				const activeTask = Object.values(this.state.tasks ?? {}).find((task) =>
					task.tombstone !== true
					&& ['pending', 'in_progress', 'pending_acceptance'].includes(task.status)
					&& (task.ownerId === memberId || task.assigneeId === memberId));
				const taskId = recorded.taskId ?? activeTask?.id ?? null;
				inboxItem = createInboxItem({
					memberId: humanId,
					type: 'decision_required',
					ref: { memberId, category: recorded.category, taskId },
					requiresDecision: true,
				}, { at: this.now() });
				await this.ledger.append({
					type: 'inbox/item-created',
					payload: { itemId: inboxItem.id, ...inboxItem },
					actor: { kind: 'system' },
					projectId,
					at: this.now(),
				});
			}
		}
		return {
			member: { ...member, lastFailure: recorded, attempts: attempt, status: fatal ? 'failed' : member.status },
			inboxItem,
		};
	}

	/** Fallback changes are system-authored config events, rollback-able by Human. */
	async applySystemFallback(memberId, patch, reason = 'llm-fallback', projectId = Object.keys(this.state.projects ?? {})[0]) {
		const member = this.state.members?.[memberId];
		if (member === undefined) fail(ERRORS.NOT_FOUND, `member ${String(memberId)} not found`);
		const current = normalizeMemberConfig(member.config ?? {});
		const result = applyMemberConfigPatch(current, patch, {
			policy: this.memberConfigPolicy,
			configVersion: member.configVersion ?? 0,
		});
		if (!result.changed) return { member, config: current, changed: false };
		this.diag?.append({
			ev: 'member.fallback',
			memberId,
			reason,
			patch,
			projectId,
		});
		const nextConfig = {
			...result.config,
			updatedBy: 'system',
			updatedAt: this.now(),
			reason,
		};
		await this.ledger.append({
			type: 'member/config-updated',
			payload: {
				memberId,
				config: nextConfig,
				configVersion: nextConfig.configVersion,
				before: result.before,
				reason,
			},
			actor: { kind: 'system' },
			projectId,
			at: this.now(),
		});
		return { member: { ...member, config: nextConfig, configVersion: nextConfig.configVersion }, config: nextConfig, changed: true };
	}

	async recordMemberRecovery(memberId, attempt, effectiveConfig, projectId = Object.keys(this.state.projects ?? {})[0]) {
		const member = this.state.members?.[memberId];
		if (member === undefined) fail(ERRORS.NOT_FOUND, `member ${String(memberId)} not found`);
		await this.ledger.append({
			type: 'member/recovered',
			payload: { memberId, attempt, effectiveConfig: effectiveConfig ?? member.config ?? null },
			actor: { kind: 'system' },
			projectId,
			at: this.now(),
		});
		this.diag?.append({ ev: 'member.recovered', memberId, attempt, projectId });
		return { member: { ...member, status: 'running', lastRecoveredAt: this.now() } };
	}

	async createTask(command, payload) {
		const state = this.state;
		const projectId = command.projectId;
		const project = state.projects?.[projectId];
		if (project === undefined) fail(ERRORS.NOT_FOUND, `project ${String(projectId)} not found`);
		const number = Math.max(0, ...Object.values(state.tasks ?? {}).map((task) => task.number ?? 0)) + 1;
		const ownerId = payload.ownerId ?? project.ownerMemberId ?? project.ownerId;
		const qaRequired = payload.qaRequired === true;
		const qaChecklist = Array.isArray(payload.qaChecklist) ? payload.qaChecklist.filter((item) => typeof item === 'string' && item.trim() !== '') : [];
		if (qaRequired && qaChecklist.length === 0) {
			fail(ERRORS.INVALID_ARGUMENT, 'qaRequired needs at least one qaChecklist item');
		}
		const title = typeof payload.title === 'string' ? payload.title.trim() : '';
		const resultDefinition = typeof payload.resultDefinition === 'string' ? payload.resultDefinition.trim() : '';
		const duplicate = Object.values(state.tasks ?? {}).find((candidate) =>
			candidate.tombstone !== true
			&& ['pending', 'in_progress', 'pending_acceptance'].includes(candidate.status)
			&& candidate.ownerId === ownerId
			&& candidate.title === title
			&& candidate.resultDefinition === resultDefinition);
		if (duplicate !== undefined && payload.allowDuplicate !== true) {
			fail(ERRORS.CONFLICT, 'an active Task with the same title, result definition and owner already exists', {
				details: { taskId: duplicate.id, number: duplicate.number, title: duplicate.title },
			});
		}
		const { task, event } = createTask({
			number,
			title,
			resultDefinition,
			ownerId,
			assigneeId: payload.assigneeId,
			blockedBy: payload.blockedBy,
			writeScopes: payload.writeScopes,
			irreversible: payload.irreversible,
			qaRequired,
			qaChecklist,
			originRefs: payload.originRefs,
			at: this.now(),
		});
		await this.ledger.append({ ...event, actor: command.actor, correlationId: command.correlationId, at: this.now(), projectId });
		return { task };
	}

	async taskCommand(command, action) {
		const state = this.state;
		const taskId = command.payload?.taskId;
		const task = state.tasks?.[taskId];
		if (task === undefined) fail(ERRORS.NOT_FOUND, `task ${String(taskId)} not found`);
		const expectedRevision = command.payload?.expectedRevision;
		let outcome;
		switch (action) {
			case 'claim': outcome = claimTask(task, command.actor, state.tasks ?? {}, { expectedRevision, at: this.now() }); break;
			case 'release': outcome = releaseTask(task, command.actor, { expectedRevision, reason: command.payload?.reason, at: this.now() }); break;
			case 'assign': outcome = assignTask(task, command.actor, command.payload?.assigneeId, { expectedRevision, at: this.now() }); break;
			case 'submit': outcome = submitTask(task, command.actor, { summary: command.payload?.summary, evidence: command.payload?.evidence }, { expectedRevision, at: this.now() }); break;
			case 'accept': {
				// Agent actors are pre-resolved by dispatch; resolve defensively here
				// so an unknown memberId fails closed instead of skipping the QA gate.
				const reviewer = command.actor.kind === 'agent'
					? this.state.members?.[command.actor.memberId] ?? undefined
					: null;
				if (command.actor.kind === 'agent' && reviewer === undefined) {
					fail(ERRORS.UNAUTHORIZED, `agent actor ${String(command.actor.memberId ?? '?')} is not a Team member`);
				}
				if (task.qaRequired === true && reviewer !== null && !isQaMember(reviewer)) {
					fail(ERRORS.INVALID_STATE, 'this task requires a QA reviewer');
				}
				const checklist = Array.isArray(task.qaChecklist) ? task.qaChecklist : [];
				const checks = Array.isArray(command.payload?.checks) ? command.payload.checks : [];
				if (reviewer !== null && checklist.length > 0) {
					if (checks.length !== checklist.length || checks.some((check) => check?.passed !== true)) {
						fail(ERRORS.INVALID_STATE, 'every QA checklist item must pass before acceptance');
					}
				}
				outcome = acceptTask(task, command.actor, {
					note: command.payload?.note,
					confirmed: command.payload?.confirmed,
					qaChecks: checks,
				}, { expectedRevision, at: this.now() });
				break;
			}
			case 'request_changes': outcome = requestChangesTask(task, command.actor, { note: command.payload?.note }, { expectedRevision, at: this.now() }); break;
			case 'cancel': outcome = cancelTask(task, command.actor, { reason: command.payload?.reason, expectedRevision, at: this.now() }); break;
			case 'reopen': outcome = reopenTask(task, command.actor, { reason: command.payload?.reason, expectedRevision, members: state.members, at: this.now() }); break;
			case 'reassign': outcome = reassignTask(task, command.actor, command.payload?.ownerId, { expectedRevision, reason: command.payload?.reason, at: this.now() }); break;
			case 'delete': outcome = deleteTask(task, command.actor, { expectedRevision, at: this.now() }); break;
			default: fail(ERRORS.INVALID_ARGUMENT, `unknown task action: ${action}`);
		}
		await this.ledger.append({ ...outcome.event, actor: command.actor, correlationId: command.correlationId, projectId: command.projectId, at: this.now() });
		if (action === 'accept') await this.notifyTaskFollowers(outcome.task, command);
		return { task: outcome.task, event: outcome.event };
	}

	async convert(command, payload) {
		const sourceEventIds = payload.sourceEventIds;
		if (!Array.isArray(sourceEventIds) || sourceEventIds.length === 0) fail(ERRORS.INVALID_ARGUMENT, 'sourceEventIds is required');
		const state = this.state;
		const existing = Object.values(state.tasks ?? {}).find((task) =>
			(task.originRefs ?? []).some((ref) => sourceEventIds.includes(ref)));
		if (existing !== undefined) {
			fail(ERRORS.CONFLICT, `already converted to ${existing.id}`, { details: { taskId: existing.id } });
		}
		const result = await this.createTask(command, {
			title: payload.title,
			resultDefinition: payload.doneCriteria ?? payload.resultDefinition,
			ownerId: payload.ownerId,
			assigneeId: payload.assigneeId,
			writeScopes: payload.writeScopes,
			originRefs: sourceEventIds,
		});
		return result;
	}

	/** Followers get one report when a Task is accepted; unfollow removes future reports. */
	async notifyTaskFollowers(task, command) {
		const followers = Array.isArray(this.state.followers?.[task.id]) ? this.state.followers[task.id] : [];
		for (const followerId of followers) {
			if (followerId === command.actor.memberId) continue;
			const duplicate = Object.values(this.state.inbox ?? {}).find((item) =>
				item.memberId === followerId
				&& item.type === 'followed_task_update'
				&& item.ref?.taskId === task.id
				&& item.ref?.kind === 'completed'
				&& item.state === 'unread');
			if (duplicate !== undefined) continue;
			const item = createInboxItem({
				memberId: followerId,
				type: 'followed_task_update',
				ref: { taskId: task.id, title: task.title, kind: 'completed' },
				requiresDecision: false,
			}, { at: this.now() });
			await this.ledger.append({
				type: 'inbox/item-created',
				payload: { itemId: item.id, ...item },
				actor: { kind: 'system' },
				projectId: command.projectId,
				at: this.now(),
			});
		}
	}

	async follow(command, payload) {
		if (typeof payload.taskId !== 'string') fail(ERRORS.INVALID_ARGUMENT, 'taskId is required');
		const following = payload.following === true;
		await this.ledger.append({
			type: following ? 'task/followed' : 'task/unfollowed',
			payload: { taskId: payload.taskId, memberId: command.actor.memberId ?? this.humanId() },
			actor: command.actor,
			correlationId: command.correlationId,
			projectId: command.projectId,
			at: this.now(),
		});
		return { following };
	}

	async postThread(command, payload) {
		const state = this.state;
		const taskId = payload.taskId;
		if (state.tasks?.[taskId] === undefined) fail(ERRORS.NOT_FOUND, `task ${String(taskId)} not found`);
		const thread = state.threads?.[taskId] ?? createThread(taskId);
		const actorKind = command.actor.kind;
		const authorId = command.actor.memberId ?? this.humanId();
		const outcome = appendReply(thread, { authorId, actorKind, baseSeq: payload.baseSeq, body: payload.body, refs: payload.refs }, { at: this.now() });
		await this.ledger.append({
			type: 'thread/posted',
			payload: { taskId, ...outcome.entry },
			actor: command.actor,
			correlationId: command.correlationId,
			projectId: command.projectId,
			at: this.now(),
		});
		return { thread: outcome.thread, entry: outcome.entry };
	}

	/** PMO: answer all pending structured questions with the max-value policy. */
	async autoAnswerDecisions(projectId = Object.keys(this.state.projects ?? {})[0]) {
		const humanId = this.humanId();
		if (humanId === null) return 0;
		const items = Object.values(this.state.inbox ?? {}).filter((item) =>
			item.memberId === humanId
			&& item.type === 'decision_required'
			&& item.state === 'unread');
		const results = [];
		for (const item of items) {
			const questions = Array.isArray(item.ref?.questions) ? item.ref.questions : [];
			const answers = chooseDecisionAnswers(questions);
			results.push(await this.autoAnswerDecision(item, answers, projectId));
		}
		return results;
	}

	async autoAnswerDecision(item, answers, projectId = Object.keys(this.state.projects ?? {})[0]) {
		const taskId = typeof item.ref?.taskId === 'string' ? item.ref.taskId : null;
		const task = taskId === null ? undefined : this.state.tasks?.[taskId];
		const questionById = new Map((item.ref?.questions ?? []).map((question) => [question.id, question.text]));
		const lines = answers.length > 0
			? answers.map((answer) => `- ${questionById.get(answer.id) ?? answer.id}: ${answer.value}`)
			: ['- 无结构化问题：按当前 Task/Thread 的最高价值路径推进，不等待 Human。'];
		const body = `【PMO 自动决策】按最高价值建议执行，不需要 Human 再确认：\n${lines.join('\n')}`;
		let entry = null;
		if (task !== undefined) {
			const thread = this.state.threads?.[task.id] ?? createThread(task.id);
			const outcome = appendReply(thread, {
				authorId: 'mem_pmo',
				actorKind: 'system',
				baseSeq: thread.headSeq,
				body,
			}, { at: this.now() });
			await this.ledger.append({
				type: 'thread/posted',
				payload: { taskId: task.id, ...outcome.entry },
				actor: { kind: 'system', memberId: 'mem_pmo' },
				projectId,
				at: this.now(),
			});
			entry = outcome.entry;
		}
		const next = ackInboxItem(item, {
			disposition: 'done',
			decision: { answers, auto: true, by: 'mem_pmo', body },
		}, { at: this.now() });
		this.diag?.append({
			ev: 'pmo.auto-answer',
			itemId: item.id,
			taskId,
			answers: answers.length,
			projectId,
		});
		await this.ledger.append({
			type: 'inbox/acked',
			payload: { itemId: next.id, memberId: next.memberId, state: next.state, disposition: next.disposition, at: next.ackedAt },
			actor: { kind: 'system', memberId: 'mem_pmo' },
			projectId,
			at: this.now(),
		});
		return { item: next, entry };
	}

	/** Surface an explicit Human decision request with all questions inline. */
	async requestDecision(command, payload) {
		const humanId = this.humanId();
		if (humanId === null) fail(ERRORS.NOT_FOUND, 'Human member not found');
		const raw = Array.isArray(payload.questions) ? payload.questions : [];
		if (raw.length === 0 || raw.length > 20) fail(ERRORS.INVALID_ARGUMENT, 'questions must contain 1..20 items');
		const questions = raw.map((question, index) => {
			if (typeof question === 'string') return { id: `q${index + 1}`, text: question.trim() };
			if (question === null || typeof question !== 'object') fail(ERRORS.INVALID_ARGUMENT, `questions[${index}] must be a string or object`);
			const text = typeof question.text === 'string' ? question.text.trim() : '';
			if (text === '') fail(ERRORS.INVALID_ARGUMENT, `questions[${index}].text is required`);
			const options = Array.isArray(question.options) ? question.options.filter((option) => typeof option === 'string' && option.trim() !== '').slice(0, 12) : [];
			return {
				id: typeof question.id === 'string' && question.id !== '' ? question.id : `q${index + 1}`,
				text,
				...(options.length ? { options } : {}),
				...(typeof question.recommendation === 'string' && question.recommendation !== '' ? { recommendation: question.recommendation } : {}),
				...(typeof question.blocking === 'string' && question.blocking !== '' ? { blocking: question.blocking } : {}),
			};
		});
		const title = typeof payload.title === 'string' && payload.title.trim() !== '' ? payload.title.trim() : '需要你决策';
		const taskId = typeof payload.taskId === 'string' ? payload.taskId : null;
		const duplicate = Object.values(this.state.inbox ?? {}).find((item) =>
			item.memberId === humanId
			&& item.type === 'decision_required'
			&& item.ref?.title === title
			&& item.ref?.taskId === taskId
			&& !['resolved', 'dismissed', 'superseded'].includes(item.state));
		if (duplicate !== undefined) return { item: duplicate, duplicate: true };
		const item = createInboxItem({
			memberId: humanId,
			type: 'decision_required',
			ref: {
				taskId,
				title,
				memberId: command.actor.memberId ?? null,
				memberName: this.state.members?.[command.actor.memberId]?.name ?? command.actor.memberId ?? null,
				questions,
				...(typeof payload.source === 'string' && payload.source !== '' ? { source: payload.source } : {}),
			},
			requiresDecision: true,
		}, { at: this.now() });
		await this.ledger.append({
			type: 'inbox/item-created',
			payload: { itemId: item.id, ...item },
			actor: command.actor,
			correlationId: command.correlationId,
			projectId: command.projectId,
			at: this.now(),
		});
		return { item, duplicate: false };
	}

	async answerDecision(command, payload) {
		if (command.actor.kind !== 'human') fail(ERRORS.UNAUTHORIZED, 'only Human may answer a decision');
		const item = this.state.inbox?.[payload.itemId];
		if (item === undefined) fail(ERRORS.NOT_FOUND, `inbox item ${String(payload.itemId)} not found`);
		if (item.type !== 'decision_required' || item.requiresDecision !== true) {
			fail(ERRORS.INVALID_STATE, 'this inbox item is not a Human decision');
		}
		const humanId = command.actor.memberId;
		if (item.memberId !== humanId) fail(ERRORS.UNAUTHORIZED, 'decision belongs to another member');
		const answers = (Array.isArray(payload.answers) ? payload.answers : [])
			.map((answer, index) => ({
				id: typeof answer?.id === 'string' && answer.id !== '' ? answer.id : `q${index + 1}`,
				value: typeof answer?.value === 'string' ? answer.value.trim() : '',
			}))
			.filter((answer) => answer.value !== '');
		if (answers.length === 0) fail(ERRORS.INVALID_ARGUMENT, 'at least one answer is required');
		const questions = Array.isArray(item.ref?.questions) ? item.ref.questions : [];
		const lines = answers.map((answer) => {
			const question = questions.find((candidate) => candidate.id === answer.id);
			return `- ${question?.text ?? answer.id}: ${answer.value}`;
		});
		const body = `Human 决策：\n${lines.join('\n')}${typeof payload.note === 'string' && payload.note.trim() !== '' ? `\n备注：${payload.note.trim()}` : ''}`;
		let entry = null;
		if (typeof item.ref?.taskId === 'string' && this.state.tasks?.[item.ref.taskId] !== undefined) {
			const taskId = item.ref.taskId;
			const thread = this.state.threads?.[taskId] ?? createThread(taskId);
			const outcome = appendReply(thread, {
				authorId: humanId,
				actorKind: 'human',
				baseSeq: thread.headSeq,
				body,
			}, { at: this.now() });
			await this.ledger.append({
				type: 'thread/posted',
				payload: { taskId, ...outcome.entry },
				actor: command.actor,
				projectId: command.projectId,
				at: this.now(),
			});
			entry = outcome.entry;
		}
		const next = ackInboxItem(item, { disposition: 'done', decision: { answers, note: payload.note ?? '', body } }, { at: this.now() });
		await this.ledger.append({
			type: 'inbox/acked',
			payload: { itemId: next.id, memberId: next.memberId, state: next.state, disposition: next.disposition, at: next.ackedAt },
			actor: command.actor,
			projectId: command.projectId,
			at: this.now(),
		});
		return { item: next, entry };
	}

	async ack(command, payload) {
		const state = this.state;
		const item = state.inbox?.[payload.itemId];
		if (item === undefined) fail(ERRORS.NOT_FOUND, `inbox item ${String(payload.itemId)} not found`);
		const next = ackInboxItem(item, { disposition: payload.disposition, decision: payload.decision }, { at: this.now() });
		await this.ledger.append({
			type: 'inbox/acked',
			payload: { itemId: next.id, memberId: next.memberId, state: next.state, disposition: next.disposition, at: next.ackedAt },
			actor: command.actor,
			correlationId: command.correlationId,
			projectId: command.projectId,
			at: this.now(),
		});
		return { item: next };
	}

	/** Create an inbox item and append it; used by the Waker/observer. */
	async notify(input, command = { actor: { kind: 'system' } }) {
		const item = createInboxItem(input, { at: this.now() });
		await this.ledger.append({
			type: 'inbox/item-created',
			payload: { itemId: item.id, ...item },
			actor: command.actor ?? { kind: 'system' },
			projectId: command.projectId,
			at: this.now(),
		});
		return item;
	}
}
