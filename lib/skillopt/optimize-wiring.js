/**
 * 自动优化循环的宿主适配：VCS（git / 文件备份）、候选生成器（独立子代理）、
 * results.tsv 追加。与 optimizer.js 的纯编排分离，便于测试替换。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runEngineCli, quoteArgv } from './gate-wiring.js';
import { awaitActivationText } from './subagent-text.js';

/** 项目是否为干净 git 仓库（决定 git 棘轮还是文件备份）。 */
async function isCleanGitRepo(shell, cwd) {
	const inside = await runEngineCli(shell, ['git', '-C', cwd, 'rev-parse', '--is-inside-work-tree']).catch(() => null);
	if (inside?.exitCode !== 0 || !/true/.test(inside?.stdout ?? '')) return false;
	const status = await runEngineCli(shell, ['git', '-C', cwd, 'status', '--porcelain']).catch(() => null);
	return status?.exitCode === 0 && (status.stdout ?? '').trim() === '';
}

/**
 * @param {{shell:object, projectDir:string, now?:()=>number}} deps
 * @returns {Promise<object>} vcs 适配器
 */
export async function makeVcs({ shell, projectDir, now = () => Date.now() }) {
	const git = await isCleanGitRepo(shell, projectDir);
	if (git) {
		const commit = async (message) => {
			const add = await runEngineCli(shell, ['git', '-C', projectDir, 'add', '-A']);
			if (add.exitCode !== 0) throw new Error(`git add failed: ${add.stderr}`);
			const done = await runEngineCli(shell, ['git', '-C', projectDir, 'commit', '-m', message, '--no-verify']);
			if (done.exitCode !== 0) throw new Error(`git commit failed: ${done.stderr}`);
			const head = await runEngineCli(shell, ['git', '-C', projectDir, 'rev-parse', '--short', 'HEAD']);
			return (head.stdout ?? '').trim() || null;
		};
		return {
			kind: 'git',
			commit,
			// keep 时无需额外动作：commit 已留下保留版本。
			commitKept: async () => {},
			revert: async () => {
				const done = await runEngineCli(shell, ['git', '-C', projectDir, 'revert', 'HEAD', '--no-edit']);
				if (done.exitCode !== 0) throw new Error(`git revert failed: ${done.stderr}`);
			},
			writeBaseline: async (path, text) => { writeFileSync(path, text, 'utf8'); },
		};
	}
	const backupDir = join(projectDir, '.skillopt-sleep', 'backups');
	mkdirSync(backupDir, { recursive: true });
	return {
		kind: 'file',
		backup: async (path, text) => {
			const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
			const target = join(backupDir, `${path.split(/[\\/]/).pop()}.${stamp}.bak`);
			writeFileSync(target, text, 'utf8');
			return target;
		},
		restore: async (path, backupPath) => {
			if (!existsSync(backupPath)) throw new Error(`backup missing: ${backupPath}`);
			copyFileSync(backupPath, path);
		},
	};
}


export function makeGenerator({ subagents, ensureParent, providerName, cwd }) {
	/**
	 * 启动生成子代理（两阶段：只启动，不等待）。返回 { childId, outputStart }；
	 * 输出由 PMO tick 从会话事件里收割（工具 execute 内无法同步等待）。
	 */
	const start = async ({ before, dimension, round }) => {
		const parentInfo = await ensureParent();
		const provider = providerName();
		const prompt = [
			'你是技能改进器。只输出改进后的完整 SKILL.md 内容（不要解释、不要代码围栏）。',
			`目标维度：dim${dimension.id} ${dimension.name}（当前 ${dimension.score}/10，权重 ${dimension.weight}）。`,
			'硬约束：不得改变技能的核心用途；只解决该维度；不得删掉已有的失败分支/检查点/反例清单；',
			'不得加长到原文 150% 以上；不得引入软化措辞（建议/可以考虑/根据情况/灵活把握/视情况而定）。',
			`这是第 ${round} 轮。`,
			'',
			'## 原文',
			before,
		].join('\n');
		const activation = await subagents.startActivation({
			provider,
			label: `skillopt-optimize-${round}`,
			request: { cwd, prompt: [{ type: 'text', text: prompt }], parent: parentInfo?.agent },
			delivery: 'parent',
			signal: new AbortController().signal,
		});
		return { childId: activation.childId, outputStart: activation.outputStart ?? null };
	};
	return { start };
}

/**
 * 同步判据：results.tsv 中该 skill 的**最后一条**记录是否为 paired keep。
 * adopt 门在工具 execute 内无法等待子代理，因此以已落盘的 judge 结论为准。
 */
export function hasPairedKeepRecord(projectDir, skillPath) {
	const name = typeof skillPath === 'string' && skillPath !== ''
		? skillPath.split(/[\\/]/).slice(-2, -1)[0]
		: null;
	const file = join(projectDir, '.skillopt-sleep', 'results.tsv');
	if (!existsSync(file)) return false;
	const lines = readFileSync(file, 'utf8').trim().split(/\r?\n/).slice(1);
	const rows = lines.map((line) => line.split('\t')).filter((cells) => name === null || cells[2] === name);
	const last = rows.at(-1);
	if (last === undefined) return false;
	return last[5] === 'keep' && last[8] === 'paired';
}

/** results.tsv 追加（表头自动补）。 */
export function makeResultAppender({ projectDir }) {
	const dir = join(projectDir, '.skillopt-sleep');
	const path = join(dir, 'results.tsv');
	return async (line) => {
		mkdirSync(dir, { recursive: true });
		const header = ['timestamp', 'commit', 'skill', 'old_score', 'new_score', 'status', 'dimension', 'note', 'eval_mode'].join('\t');
		const prefix = existsSync(path) && readFileSync(path, 'utf8').includes('eval_mode') ? '' : header + '\n';
		writeFileSync(path, prefix + line + '\n', { encoding: 'utf8', flag: 'a' });
	};
}

export { quoteArgv };
