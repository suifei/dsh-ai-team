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
import { FOLD_STATE_VERSION } from '../ledger/fold.js';
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

	static async open({ rootDir, projectId = DEFAULT_PROJECT_ID, now = undefined, seed = true, projectName = '我的项目', projectGoal = '把事交给团队', workspacePath = '', diag = null, pmoMaxRounds = undefined }) {
		const dir = join(rootDir, 'projects', projectId);
		mkdirSync(dir, { recursive: true });
		const ledger = openLedger({
			dir,
			projectId,
			fsync: true,
			// 检查点接线：boot 从投影地板续放尾部，跳过全量 fold；每 500 次
			// 追加与 close 前落盘，崩溃窗口有界（账本本体不受影响）。
			checkpoint: { stateVersion: FOLD_STATE_VERSION, saveEvery: 500 },
		});
		const service = new TeamService({ ledger, now, diag, pmoMaxRounds });
		const runtime = new ProjectRuntime({ id: projectId, rootDir, dir, ledger, service });

		const recovery = ledger.recovery;
		if (recovery !== null && recovery !== undefined) {
			diag?.append({
				ev: 'ledger.checkpoint',
				projectId,
				source: recovery.source,
				fromSeq: recovery.fromSeq,
				errors: recovery.errors?.length ?? 0,
				saved: recovery.saved ?? null,
			});
		}

		const repairs = ledger.opened?.repairs ?? (ledger.opened?.repair ? [ledger.opened.repair] : []);
		if (repairs.length > 0) {
			diag?.append({ ev: 'ledger.repair', projectId, repairs });
			await ledger.append({
				type: 'ledger/repaired',
				payload: { repairs },
				actor: { kind: 'system' },
				projectId,
			});
		}
		diag?.append({
			ev: 'ledger.open',
			projectId,
			events: ledger.headSeq,
			head: ledger.head.seq,
			segments: ledger.opened?.segments ?? null,
		});

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
					// 播种是内部路径：允许先建一个「待设定目录」的默认项目，用户在首次使用
				// 引导里选定目录后再 project.workspace.update。
				payload: { id: projectId, name: projectName, goal: projectGoal, workspacePath, seed: true },
				});
			}
			await seedDefaultRoster(service, projectId, { humanId: HUMAN_ID });
			await service.backfillHumanMentions(state.projects?.[projectId]?.workspacePath ?? '');
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
