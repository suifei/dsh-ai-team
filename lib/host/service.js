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
			id: m.id, name: m.name, role: m.role ?? '', status: m.status ?? 'idle', kind: m.kind ?? 'agent',
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
			case 'member.add': return await this.addMember(command, payload);
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

	async addMember(command, payload) {
		if (command.actor.kind !== 'human') fail(ERRORS.UNAUTHORIZED, 'only Human may create a member');
		if (typeof payload.name !== 'string' || payload.name.trim() === '') fail(ERRORS.INVALID_ARGUMENT, 'member name is required');
		const member = {
			id: payload.id ?? ids.member(),
			name: payload.name.trim(),
			kind: payload.kind === 'human' ? 'human' : 'agent',
			role: payload.role ?? '',
			status: 'idle',
			createdAt: this.now(),
		};
		await this.append(command, 'project/member-added', {
			memberId: member.id,
			name: member.name,
			kind: member.kind,
			role: member.role,
			status: member.status,
			projectId: payload.projectId,
		});
		return { member };
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
