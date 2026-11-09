/**
 * The member-facing Team tool. It is registered globally but only becomes
 * visible to a session that is a live Team member (`when` checks the ledger).
 *
 * Mutations require `expectedRevision` (Task CAS) and `baseSeq` (Thread stale
 * reply protection); errors are returned as data so the member can re-read.
 */
import { taskCard } from './views.js';

const ACTIONS = ['tasks', 'inbox', 'create', 'member', 'evolve', 'distill', 'note', 'skill', 'claim', 'submit', 'thread', 'reply', 'accept', 'requestChanges'];

function failure(error) {
	return {
		ok: false,
		error: {
			code: error?.code ?? 'E_TOOL',
			message: error?.message ?? String(error),
			details: error?.details ?? null,
		},
	};
}

function memberForSession(state, sessionId) {
	return Object.values(state.members ?? {}).find((member) => member.sessionId === sessionId) ?? null;
}

function projectId(state, requested) {
	if (typeof requested === 'string' && state.projects?.[requested] !== undefined) return requested;
	return Object.keys(state.projects ?? {})[0] ?? null;
}

/**
 * @param {{
 *   getState: () => any,
 *   dispatch: (command: any) => Promise<any>,
 *   maxThreadEntries?: number
 * }} options
 */
export function createTeamTool(options) {
	return {
		name: 'team',
		description: 'Read and act on the AI Team board. The Project owner can create tasks with action=create and must set resultDefinition and ownerId. Use member to inspect a colleague, evolve for only your own personality, distill (Project owner/Human) or note/skill for durable memory. Use tasks for ids/revisions; claim before working; read a Thread before replying; submit evidence before acceptance.',
		parameters: {
			type: 'object',
			properties: {
				action: { type: 'string', enum: ACTIONS, description: 'Operation to perform.' },
				taskId: { type: 'string', description: 'Task id from tasks.' },
				expectedRevision: { type: 'integer', description: 'Task revision from tasks/claim; required for claim/submit/accept/requestChanges.' },
				baseSeq: { type: 'integer', description: 'Thread headSeq read before replying; required for reply.' },
				afterSeq: { type: 'integer', description: 'Return Thread entries after this seq.' },
				summary: { type: 'string', description: 'What was done, for submit.' },
				evidence: { type: 'array', items: { type: 'string' }, description: 'Evidence strings/paths, at least one for submit.' },
				note: { type: 'string', description: 'Acceptance or changes-requested note.' },
				body: { type: 'string', description: 'Thread reply body.' },
				title: { type: 'string', description: 'Task title for create.' },
				resultDefinition: { type: 'string', description: 'Acceptance definition for create.' },
				ownerId: { type: 'string', description: 'Accountable owner for create; defaults to you.' },
				assigneeId: { type: 'string', description: 'Optional assignee for create.' },
				qaRequired: { type: 'boolean', description: 'Require a QA member to accept this task.' },
				personality: { type: 'string', description: 'New working personality for evolve/distill.' },
				reason: { type: 'string', description: 'Why the personality changed.' },
				memberId: { type: 'string', description: 'Target member for member/distill/note/skill.' },
				text: { type: 'string', description: 'Note text.' },
				skill: { type: 'string', description: 'Skill name to add.' },
			},
			required: ['action'],
			additionalProperties: false,
		},
		output: {
			schema: { type: 'object', additionalProperties: true },
			render(_args, value) {
				return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
			},
		},
		async execute(args, exec) {
			const state = options.getState();
			const member = memberForSession(state, exec?.agent?.id);
			if (member === null) return failure({ code: 'E_NOT_MEMBER', message: 'this session is not a Team member' });
			const actor = { kind: 'agent', memberId: member.id };
			const pid = projectId(state, exec?.projectId);
			if (pid === null) return failure({ code: 'E_NOT_FOUND', message: 'no Project is configured' });
			const command = (type, payload) => options.dispatch({ type, payload, actor, projectId: pid });
			try {
				if (args.action === 'tasks') {
					const tasks = Object.values(state.tasks ?? {})
						.filter((task) => task.tombstone !== true)
						.map((task) => taskCard(state, task));
					return { ok: true, projectId: pid, tasks };
				}
				if (args.action === 'member') {
					const target = state.members?.[args.memberId ?? member.id];
					if (target === undefined || target.kind !== 'agent') return failure({ code: 'E_NOT_FOUND', message: 'agent not found' });
					const tasks = Object.values(state.tasks ?? {})
						.filter((task) => task.ownerId === target.id || task.assigneeId === target.id)
						.slice(-10)
						.map((task) => ({ id: task.id, number: task.number, title: task.title, status: task.status, ownerId: task.ownerId, assigneeId: task.assigneeId }));
					return {
						ok: true,
						member: {
							id: target.id, name: target.name, role: target.role, personality: target.personality ?? '',
							notes: target.notes ?? [], skills: target.skills ?? [], profileVersion: target.profileVersion ?? 1,
							distillVersion: target.distillVersion ?? 0, status: target.status,
						},
						tasks,
					};
				}
				if (args.action === 'note') {
					const result = await command('member.note', {
						...(typeof args.memberId === 'string' ? { memberId: args.memberId } : {}),
						text: typeof args.text === 'string' ? args.text : '',
					});
					return { ok: true, member: result.member };
				}
				if (args.action === 'skill') {
					const result = await command('member.skill', {
						...(typeof args.memberId === 'string' ? { memberId: args.memberId } : {}),
						name: typeof args.skill === 'string' ? args.skill : '',
					});
					return { ok: true, member: result.member };
				}
				if (args.action === 'distill') {
					const result = await command('member.distill', {
						...(typeof args.memberId === 'string' ? { memberId: args.memberId } : {}),
						personality: typeof args.personality === 'string' ? args.personality : '',
						reason: typeof args.reason === 'string' ? args.reason : 'agent distill',
					});
					return { ok: true, member: result.member };
				}
				if (args.action === 'evolve') {
					if (typeof args.personality !== 'string' || args.personality.trim() === '') {
						return failure({ code: 'E_INVALID_ARGUMENT', message: 'personality is required' });
					}
					const result = await command('member.evolve', {
						personality: args.personality,
						reason: typeof args.reason === 'string' ? args.reason : 'self-evolution',
					});
					return { ok: true, member: result.member };
				}
				if (args.action === 'create') {
					const project = state.projects?.[pid];
					if (project?.ownerMemberId !== member.id && project?.ownerId !== member.id) {
						return failure({ code: 'E_UNAUTHORIZED', message: 'only the Project owner may create tasks' });
					}
					if (typeof args.title !== 'string' || args.title.trim() === '') return failure({ code: 'E_INVALID_ARGUMENT', message: 'title is required' });
					if (typeof args.resultDefinition !== 'string' || args.resultDefinition.trim() === '') {
						return failure({ code: 'E_INVALID_ARGUMENT', message: 'resultDefinition is required' });
					}
					const result = await command('task.create', {
						title: args.title,
						resultDefinition: args.resultDefinition,
						ownerId: typeof args.ownerId === 'string' && args.ownerId !== '' ? args.ownerId : member.id,
						...(typeof args.assigneeId === 'string' && args.assigneeId !== '' ? { assigneeId: args.assigneeId } : {}),
						...(args.qaRequired === true ? { qaRequired: true } : {}),
					});
					return { ok: true, task: taskCard(options.getState(), result.task) };
				}
				if (args.action === 'inbox') {
					const items = Object.values(state.inbox ?? {})
						.filter((item) => item.memberId === member.id && !['resolved', 'dismissed', 'superseded'].includes(item.state));
					return { ok: true, memberId: member.id, items };
				}
				if (args.action === 'claim' || args.action === 'submit' || args.action === 'accept' || args.action === 'requestChanges') {
					if (typeof args.taskId !== 'string' || args.taskId === '') return failure({ code: 'E_INVALID_ARGUMENT', message: 'taskId is required' });
					if (!Number.isSafeInteger(args.expectedRevision)) return failure({ code: 'E_INVALID_ARGUMENT', message: 'expectedRevision is required; read tasks first' });
					const payload = { taskId: args.taskId, expectedRevision: args.expectedRevision };
					if (args.action === 'submit') {
						const evidence = Array.isArray(args.evidence) ? args.evidence.filter((item) => typeof item === 'string' && item !== '') : [];
						if (evidence.length === 0) return failure({ code: 'E_INVALID_ARGUMENT', message: 'at least one evidence entry is required' });
						payload.summary = typeof args.summary === 'string' ? args.summary : '';
						payload.evidence = evidence.map((value) => ({ kind: 'text', value }));
					}
					if (args.action === 'accept' || args.action === 'requestChanges') payload.note = typeof args.note === 'string' ? args.note : '';
					const type = args.action === 'requestChanges' ? 'task.request_changes' : `task.${args.action}`;
					const result = await command(type, payload);
					return { ok: true, task: taskCard(options.getState(), result.task), event: result.event?.type ?? null };
				}
				if (args.action === 'thread') {
					if (typeof args.taskId !== 'string') return failure({ code: 'E_INVALID_ARGUMENT', message: 'taskId is required' });
					const thread = state.threads?.[args.taskId] ?? { taskId: args.taskId, headSeq: 0, entries: [] };
					const after = Number.isSafeInteger(args.afterSeq) ? args.afterSeq : 0;
					const entries = thread.entries.filter((entry) => entry.seq > after).slice(-(options.maxThreadEntries ?? 20));
					return { ok: true, taskId: args.taskId, headSeq: thread.headSeq, entries };
				}
				if (args.action === 'reply') {
					if (typeof args.taskId !== 'string') return failure({ code: 'E_INVALID_ARGUMENT', message: 'taskId is required' });
					if (!Number.isSafeInteger(args.baseSeq)) return failure({ code: 'E_INVALID_ARGUMENT', message: 'baseSeq is required; read thread first' });
					if (typeof args.body !== 'string' || args.body.trim() === '') return failure({ code: 'E_INVALID_ARGUMENT', message: 'body is required' });
					const result = await command('thread.post', { taskId: args.taskId, baseSeq: args.baseSeq, body: args.body });
					return { ok: true, taskId: args.taskId, headSeq: result.thread.headSeq, entry: result.entry };
				}
				return failure({ code: 'E_INVALID_ARGUMENT', message: `unknown action: ${String(args.action)}` });
			} catch (error) {
				return failure(error);
			}
		},
	};
}
