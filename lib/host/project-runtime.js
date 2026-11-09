/**
 * One Project runtime: its own ledger, TeamService and optional SSE/waker hooks.
 *
 * A Project is the isolation boundary required by the ledger writer: every
 * ledger event must carry exactly this Project's id. ProjectRuntime wraps the
 * default Project first, so multiple runtimes can be mounted later without
 * changing the single-project behaviour.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openLedger } from '../ledger/writer.js';
import { seedDefaultRoster } from './default-roster.js';
import { TeamService } from './service.js';

export const DEFAULT_PROJECT_ID = 'prj_main';
export const HUMAN_ID = 'mem_human';

export class ProjectRuntime {
	constructor({ id, rootDir, dir, ledger, service }) {
		this.id = id;
		this.rootDir = rootDir;
		this.dir = dir;
		this.ledger = ledger;
		this.service = service;
	}

	static async open({ rootDir, projectId = DEFAULT_PROJECT_ID, now = undefined, seed = true, projectName = '我的项目', projectGoal = '把事交给团队', workspacePath = '' }) {
		const dir = join(rootDir, 'projects', projectId);
		mkdirSync(dir, { recursive: true });
		const ledger = openLedger({ dir, projectId, fsync: true });
		const service = new TeamService({ ledger, now });
		const runtime = new ProjectRuntime({ id: projectId, rootDir, dir, ledger, service });

		const repairs = ledger.opened?.repairs ?? (ledger.opened?.repair ? [ledger.opened.repair] : []);
		if (repairs.length > 0) {
			await ledger.append({
				type: 'ledger/repaired',
				payload: { repairs },
				actor: { kind: 'system' },
				projectId,
			});
		}

		if (seed) {
			const state = service.state;
			if (state.members?.[HUMAN_ID] === undefined) {
				await service.dispatch({
					type: 'member.add',
					actor: { kind: 'human', memberId: HUMAN_ID },
					projectId,
					payload: { id: HUMAN_ID, name: '你', kind: 'human', role: 'Human' },
				});
			}
			if (state.projects?.[projectId] === undefined) {
				await service.dispatch({
					type: 'project.create',
					actor: { kind: 'human', memberId: HUMAN_ID },
					projectId,
					payload: { id: projectId, name: projectName, goal: projectGoal, workspacePath },
				});
			}
			await seedDefaultRoster(service, projectId, { humanId: HUMAN_ID });
		}
		return runtime;
	}

	close() {
		try {
			this.ledger?.close?.();
		} catch {
			/* already closed */
		}
	}
}
