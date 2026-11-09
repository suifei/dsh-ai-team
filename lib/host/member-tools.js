/**
 * The member-facing Team tool. It is registered globally but only becomes
 * visible to a session that is a live Team member (`when` checks the ledger).
 *
 * Mutations require `expectedRevision` (Task CAS) and `baseSeq` (Thread stale
 * reply protection); errors are returned as data so the member can re-read.
 */
import { taskCard } from './views.js';

const ACTIONS = ['tasks', 'members', 'inbox', 'recall', 'create', 'askHuman', 'member', 'evolve', 'distill', 'note', 'skill', 'claim', 'submit', 'thread', 'reply', 'accept', 'requestChanges'];

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

function resolveMember(state, value) {
	if (typeof value !== 'string' || value === '') return null;
	const exact = state.members?.[value];
	if (exact?.kind === 'agent') return exact;
	return Object.values(state.members ?? {}).find((member) => member.kind === 'agent' && member.name === value) ?? null;
}

function rosterText(state) {
	return Object.values(state.members ?? {})
		.filter((member) => member.kind === 'agent' && member.status !== 'retired')
		.map((member) => `${member.name}=${member.id}`)
		.join('、');
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
		description: 'Read and act on the AI Team board. The Project owner can create tasks with action=create and must set resultDefinition and ownerId. Use members for the exact roster id/name/role; use tasks for ids/revisions. When Human must decide something, call askHuman with every question and options—do not bury questions in a report. Use recall to search your notes/skills and your past Tasks/Threads. Claim before working; read a Thread before replying; submit evidence before acceptance.',
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
				ownerId: { type: 'string', description: 'Accountable owner id from members for create; defaults to you.' },
				assigneeId: { type: 'string', description: 'Optional assignee id from members for create.' },
				qaRequired: { type: 'boolean', description: 'Require a QA member to accept this task.' },
				qaChecklist: { type: 'array', items: { type: 'string' }, description: 'QA checklist items; all must pass before acceptance; required when qaRequired is true.' },
				allowDuplicate: { type: 'boolean', description: 'Set true only when an identical active Task is intentionally required.' },
				checks: {
					type: 'array',
					description: 'Acceptance checks for accept; include every qaChecklist item with passed=true/false.',
					items: {
						type: 'object',
						properties: {
							item: { type: 'string', description: 'Exact qaChecklist item.' },
							passed: { type: 'boolean' },
						},
						required: ['item', 'passed'],
					},
				},
				questions: {
					type: 'array',
					description: 'Human decision questions for askHuman; include every question instead of pointing at a report.',
					items: {
						type: 'object',
						properties: {
							text: { type: 'string', description: 'The question.' },
							options: { type: 'array', items: { type: 'string' }, description: 'Optional answer choices.' },
							recommendation: { type: 'string', description: 'Optional recommended answer.' },
							blocking: { type: 'string', description: 'What this decision blocks.' },
						},
						required: ['text'],
					},
				},
				personality: { type: 'string', description: 'New working personality for evolve/distill.' },
				reason: { type: 'string', description: 'Why the personality changed.' },
				memberId: { type: 'string', description: 'Target member for member/distill/note/skill.' },
				text: { type: 'string', description: 'Note text.' },
				query: { type: 'string', description: 'Keyword for recall.' },
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
			const state = options.getState(exec);
			const member = memberForSession(state, exec?.agent?.id);
			if (member === null) return failure({ code: 'E_NOT_MEMBER', message: 'this session is not a Team member' });
			const actor = { kind: 'agent', memberId: member.id };
			const pid = projectId(state, exec?.projectId);
			if (pid === null) return failure({ code: 'E_NOT_FOUND', message: 'no Project is configured' });
			const command = (type, payload) => options.dispatch({ type, payload, actor, projectId: pid }, exec);
			try {
				if (args.action === 'tasks') {
					const tasks = Object.values(state.tasks ?? {})
						.filter((task) => task.tombstone !== true)
						.map((task) => taskCard(state, task));
					return { ok: true, projectId: pid, tasks };
				}
				if (args.action === 'members') {
					const members = Object.values(state.members ?? {})
						.filter((candidate) => candidate.kind === 'agent' && candidate.status !== 'retired')
						.map((candidate) => ({
							id: candidate.id,
							name: candidate.name,
							role: candidate.role,
							status: candidate.status,
							qa: /验收|qa|quality|test|verification/i.test(candidate.role ?? ''),
						}));
					return { ok: true, projectId: pid, members };
				}
				if (args.action === 'recall') {
					const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
					if (query === '') return failure({ code: 'E_INVALID_ARGUMENT', message: 'query is required' });
					const own = state.members?.[member.id] ?? {};
					const hits = [];
					for (const note of own.notes ?? []) {
						if (note.toLowerCase().includes(query)) hits.push({ kind: 'note', text: note });
					}
					for (const skill of own.skills ?? []) {
						if (skill.toLowerCase().includes(query)) hits.push({ kind: 'skill', text: skill });
					}
					for (const task of Object.values(state.tasks ?? {})) {
						const ownTask = task.ownerId === member.id || task.assigneeId === member.id;
						if (!ownTask) continue;
						const taskText = `${task.title ?? ''} ${task.resultDefinition ?? ''}`.toLowerCase();
						if (taskText.includes(query)) hits.push({ kind: 'task', ref: task.id, text: task.title });
						const entries = state.threads?.[task.id]?.entries ?? [];
						for (const entry of entries) {
							if (String(entry.body ?? '').toLowerCase().includes(query)) {
								hits.push({ kind: 'thread', ref: task.id, text: `#${entry.seq} ${String(entry.body).slice(0, 200)}` });
							}
						}
					}
					return { ok: true, query: args.query, hits: hits.slice(-10) };
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
					const owner = args.ownerId === undefined ? member : resolveMember(state, args.ownerId);
					if (owner === null) {
						return failure({ code: 'E_INVALID_ARGUMENT', message: `ownerId ${String(args.ownerId)} is not a Team member; use members to get ids (${rosterText(state)})` });
					}
					const assignee = args.assigneeId === undefined ? null : resolveMember(state, args.assigneeId);
					if (args.assigneeId !== undefined && assignee === null) {
						return failure({ code: 'E_INVALID_ARGUMENT', message: `assigneeId ${String(args.assigneeId)} is not a Team member; use members to get ids (${rosterText(state)})` });
					}
					const result = await command('task.create', {
						title: args.title,
						resultDefinition: args.resultDefinition,
						ownerId: owner.id,
						...(assignee === null ? {} : { assigneeId: assignee.id }),
						...(args.allowDuplicate === true ? { allowDuplicate: true } : {}),
						...(args.qaRequired === true ? { qaRequired: true } : {}),
						...(Array.isArray(args.qaChecklist) ? { qaChecklist: args.qaChecklist } : {}),
					});
					return { ok: true, task: taskCard(options.getState(), result.task) };
				}
				if (args.action === 'askHuman') {
					if (!Array.isArray(args.questions) || args.questions.length === 0) {
						return failure({ code: 'E_INVALID_ARGUMENT', message: 'questions is required; list every question Human must answer' });
					}
					const result = await command('decision.request', {
						title: typeof args.title === 'string' && args.title.trim() !== '' ? args.title.trim() : '需要你决策',
						taskId: typeof args.taskId === 'string' && args.taskId !== '' ? args.taskId : null,
						questions: args.questions,
						source: 'team',
					});
					return { ok: true, item: result.item, duplicate: result.duplicate === true };
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
					if (args.action === 'accept') {
						const checks = Array.isArray(args.checks)
							? args.checks.filter((check) => typeof check?.item === 'string' && check.item !== '' && typeof check.passed === 'boolean')
							: [];
						if (checks.length > 0) payload.checks = checks;
					}
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
