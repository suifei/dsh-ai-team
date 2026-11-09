import { ERRORS, fail } from '../domain/errors.js';
import { ids } from '../domain/ids.js';
import { ackInboxItem, createInboxItem } from '../domain/inbox.js';
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
import { boardView, quadrantsView } from './views.js';
import { applyMemberConfigPatch, normalizeMemberConfig } from '../domain/member-config.js';
import { isQaMember, unfinishedTasksFor } from '../domain/member-profile.js';

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
	 * @param {{ ledger: { state: any, append: (input: any) => Promise<any> }, now?: () => number }} options
	 */
	constructor(options) {
		this.ledger = options.ledger;
		this.now = options.now ?? (() => Date.now());
		this.memberConfigPolicy = options.memberConfigPolicy ?? {};
	}

	get state() {
		return this.ledger.state;
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
		const human = options.humanMemberId ?? this.state.humanMemberId
			?? Object.values(this.state.members ?? {}).find((member) => member.kind === 'human')?.id
			?? 'mem_human';
		return quadrantsView(this.state, { ...options, humanMemberId: human });
	}

	/** One page of workbench state; the UI reads this instead of the ledger. */
	bootstrap(projectId, threadTaskId) {
		const state = this.state;
		const projects = Object.values(state.projects ?? {}).map((p) => ({
			id: p.id, name: p.name, goal: p.goal ?? '', owner: p.ownerName ?? p.ownerMemberId ?? p.ownerId, active: p.status !== 'archived',
		}));
		const members = Object.values(state.members ?? {}).map((m) => ({
			id: m.id,
			name: m.name,
			role: m.role ?? '',
			status: m.status ?? 'idle',
			kind: m.kind ?? 'agent',
			sessionId: m.sessionId ?? null,
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
		const tasks = Object.values(state.tasks ?? {})
			.filter((task) => task.tombstone !== true && task.status !== 'deleted')
			.map((task) => ({
				id: task.id,
				number: task.number,
				title: task.title,
				status: task.status,
				owner: state.members?.[task.ownerId]?.name ?? task.ownerId,
				assignee: task.assigneeId === null || task.assigneeId === undefined ? null : (state.members?.[task.assigneeId]?.name ?? task.assigneeId),
				replies: state.threads?.[task.id]?.headSeq ?? 0,
				following: (state.followers?.[task.id] ?? []).length > 0,
				blockedBy: task.blockedBy ?? [],
				revision: task.revision,
				resultDefinition: task.resultDefinition,
			}));
		const project = projectId === undefined ? projects[0] : projects.find((p) => p.id === projectId);
		const stream = project === undefined ? [] : (state.stream ?? []).filter((entry) => entry.projectId === project.id);
		const selected = threadTaskId ?? tasks.find((task) => task.status === 'in_progress')?.id ?? tasks[0]?.id;
		const thread = selected === undefined ? null : (state.threads?.[selected] ?? { taskId: selected, headSeq: 0, entries: [] });
		return {
			project: project ?? null,
			projects,
			agents,
			members,
			tasks,
			stream,
			thread,
			inbox: Object.values(state.inbox ?? {}).filter((item) => item.memberId === state.humanMemberId || item.memberId === 'h1'),
			board: project === undefined ? null : this.board(project.id),
			quadrants: project === undefined ? null : this.quadrants(project.id),
		};
	}

	/**
	 * Dispatch one command. The caller is an exact Team member (or Human) and
	 * the ledger serializes commands per Project.
	 * @param {{ type: string, payload?: any, actor: { kind: string, memberId?: string }, correlationId?: string, projectId?: string }} command
	 */
	async dispatch(command) {
		const payload = command.payload ?? {};
		const actor = command.actor;
		if (actor === undefined || (actor.kind !== 'human' && actor.kind !== 'agent')) {
			fail(ERRORS.UNAUTHORIZED, 'an exact Team member is required');
		}
		switch (command.type) {
			case 'project.create': return await this.createProject(command, payload);
			case 'project.owner.update': return await this.changeProjectOwner(command, payload);
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
			default: fail(ERRORS.INVALID_ARGUMENT, `unknown command: ${String(command.type)}`);
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
		const ownerMemberId = payload.ownerId ?? command.actor.memberId ?? 'h1';
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
			status: project.status,
		});
		return { project };
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
		const entry = {
			seq: (this.state.stream?.at(-1)?.seq ?? 0) + 1,
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
		return { entry, event };
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

	async recordWake(memberId, info) {
		const event = {
			type: info.ok === true ? 'wake/delivered' : 'wake/failed',
			payload: { memberId, taskId: info.taskId ?? null, reason: info.reason ?? null, messageId: info.messageId ?? null, error: info.error ?? null },
			actor: { kind: 'system' },
			projectId: Object.keys(this.state.projects ?? {})[0],
			at: this.now(),
		};
		await this.ledger.append(event);
		return event;
	}

	async bindHostSession(sessionId) {
		if (typeof sessionId !== 'string' || sessionId === '') fail(ERRORS.INVALID_ARGUMENT, 'host sessionId is required');
		await this.ledger.append({
			type: 'team/host-bound',
			payload: { sessionId },
			actor: { kind: 'system' },
			projectId: Object.keys(this.state.projects ?? {})[0],
			at: this.now(),
		});
		return { sessionId };
	}

	async bindMemberSession(command, payload) {
		if (command.actor.kind !== 'human') fail(ERRORS.UNAUTHORIZED, 'only Human may bind a member session');
		const member = this.state.members?.[payload.memberId];
		if (member === undefined) fail(ERRORS.NOT_FOUND, `member ${String(payload.memberId)} not found`);
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
		const name = typeof payload.name === 'string' ? payload.name.trim() : undefined;
		const role = typeof payload.role === 'string' ? payload.role.trim() : undefined;
		const personality = typeof payload.personality === 'string' ? payload.personality.trim() : undefined;
		if (name === '' || role === '' || personality === '') fail(ERRORS.INVALID_ARGUMENT, 'profile fields cannot be blank');
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
	async recordMemberFailure(memberId, failure) {
		const member = this.state.members?.[memberId];
		if (member === undefined) fail(ERRORS.NOT_FOUND, `member ${String(memberId)} not found`);
		const attempt = Number.isSafeInteger(failure.attempt) ? failure.attempt : (member.lastFailure?.attempt ?? 0) + 1;
		const fatal = failure.category === 'auth' || failure.category === 'billing' || failure.category === 'policy' || failure.category === 'unknown';
		const recorded = { ...failure, attempt };
		await this.ledger.append({
			type: 'member/llm-failed',
			payload: { ...recorded, memberId, fatal },
			actor: { kind: 'system' },
			projectId: Object.keys(this.state.projects ?? {})[0],
			at: this.now(),
		});
		let inboxItem = null;
		if (fatal) {
			const humanId = this.state.humanMemberId
				?? Object.values(this.state.members ?? {}).find((candidate) => candidate.kind === 'human')?.id
				?? null;
			const duplicate = humanId === null ? undefined : Object.values(this.state.inbox ?? {}).find((item) =>
				item.memberId === humanId
				&& item.requiresDecision === true
				&& item.ref?.memberId === memberId
				&& !['resolved', 'dismissed', 'superseded'].includes(item.state));
			if (humanId !== null && duplicate === undefined) {
				inboxItem = createInboxItem({
					memberId: humanId,
					type: 'decision_required',
					ref: { memberId, category: recorded.category, taskId: recorded.taskId ?? null },
					requiresDecision: true,
				}, { at: this.now() });
				await this.ledger.append({
					type: 'inbox/item-created',
					payload: { itemId: inboxItem.id, ...inboxItem },
					actor: { kind: 'system' },
					projectId: Object.keys(this.state.projects ?? {})[0],
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
	async applySystemFallback(memberId, patch, reason = 'llm-fallback') {
		const member = this.state.members?.[memberId];
		if (member === undefined) fail(ERRORS.NOT_FOUND, `member ${String(memberId)} not found`);
		const current = normalizeMemberConfig(member.config ?? {});
		const result = applyMemberConfigPatch(current, patch, {
			policy: this.memberConfigPolicy,
			configVersion: member.configVersion ?? 0,
		});
		if (!result.changed) return { member, config: current, changed: false };
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
			projectId: Object.keys(this.state.projects ?? {})[0],
			at: this.now(),
		});
		return { member: { ...member, config: nextConfig, configVersion: nextConfig.configVersion }, config: nextConfig, changed: true };
	}

	async recordMemberRecovery(memberId, attempt, effectiveConfig) {
		const member = this.state.members?.[memberId];
		if (member === undefined) fail(ERRORS.NOT_FOUND, `member ${String(memberId)} not found`);
		await this.ledger.append({
			type: 'member/recovered',
			payload: { memberId, attempt, effectiveConfig: effectiveConfig ?? member.config ?? null },
			actor: { kind: 'system' },
			projectId: Object.keys(this.state.projects ?? {})[0],
			at: this.now(),
		});
		return { member: { ...member, status: 'running', lastRecoveredAt: this.now() } };
	}

	async createTask(command, payload) {
		const state = this.state;
		const projectId = command.projectId;
		const project = state.projects?.[projectId];
		if (project === undefined) fail(ERRORS.NOT_FOUND, `project ${String(projectId)} not found`);
		const number = Math.max(0, ...Object.values(state.tasks ?? {}).map((task) => task.number ?? 0)) + 1;
		const ownerId = payload.ownerId ?? project.ownerMemberId ?? project.ownerId;
		const { task, event } = createTask({
			number,
			title: payload.title,
			resultDefinition: payload.resultDefinition,
			ownerId,
			assigneeId: payload.assigneeId,
			blockedBy: payload.blockedBy,
			writeScopes: payload.writeScopes,
			irreversible: payload.irreversible,
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
			case 'accept': outcome = acceptTask(task, command.actor, { note: command.payload?.note, confirmed: command.payload?.confirmed }, { expectedRevision, at: this.now() }); break;
			case 'request_changes': outcome = requestChangesTask(task, command.actor, { note: command.payload?.note }, { expectedRevision, at: this.now() }); break;
			case 'cancel': outcome = cancelTask(task, command.actor, { reason: command.payload?.reason, expectedRevision, at: this.now() }); break;
			case 'reopen': outcome = reopenTask(task, command.actor, { reason: command.payload?.reason, expectedRevision, members: state.members, at: this.now() }); break;
			case 'reassign': outcome = reassignTask(task, command.actor, command.payload?.ownerId, { expectedRevision, reason: command.payload?.reason, at: this.now() }); break;
			case 'delete': outcome = deleteTask(task, command.actor, { expectedRevision, at: this.now() }); break;
			default: fail(ERRORS.INVALID_ARGUMENT, `unknown task action: ${action}`);
		}
		await this.ledger.append({ ...outcome.event, actor: command.actor, correlationId: command.correlationId, projectId: command.projectId, at: this.now() });
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

	async follow(command, payload) {
		if (typeof payload.taskId !== 'string') fail(ERRORS.INVALID_ARGUMENT, 'taskId is required');
		const following = payload.following === true;
		await this.ledger.append({
			type: following ? 'task/followed' : 'task/unfollowed',
			payload: { taskId: payload.taskId, memberId: command.actor.memberId ?? 'h1' },
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
		const authorId = command.actor.memberId ?? 'h1';
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
