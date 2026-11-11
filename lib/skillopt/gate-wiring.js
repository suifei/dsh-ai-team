/**
 * SkillOpt adopt gate 的宿主接线：把「读候选/基线」和「独立 judge」落到
 * DSH 服务上。与 adopt-gate.js（纯协议）分离，便于单测协议、集成测接线。
 *
 * baseline 取 live SKILL.md 当前内容：adopt 之前 live 文件就是改前版本
 * （staging 只写候选项），因此不需要 git 历史即可对比。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { judgePair } from './judge-runner.js';

/** 引号一个 argv 元素（Windows cmd 与 POSIX sh 通用单引号形式）。 */
export function quoteArgv(argv) {
	const quote = (value) => {
		const text = String(value);
		if (text === '' || /[\s"'`$\\!&|<>()*?^%;]/.test(text)) return '"' + text.replace(/"/g, '\\"') + '"';
		return text;
	};
	return argv.map(quote).join(' ');
}

/**
 * 模型可控的 project 会被拼进 shell 命令，因此必须在进 shell 前校验。
 * `quoteArgv` 只是引号包裹：`$(...)`、反引号在双引号内仍会被 shell 展开，
 * 而 pwsh 下 `\"` 也不是转义——只靠引号挡不住注入。这里要求它是一个
 * 真实存在的绝对目录，且不含任何 shell 元字符。
 */
export function assertSafeProjectDir(dir) {
	if (typeof dir !== 'string' || dir.trim() === '') throw new Error('project directory is required');
	const text = dir.trim();
	if (!isAbsolute(text)) throw new Error('project directory must be an absolute path');
	if (/[\u0000-\u001f`$;|&<>(){}[\]*?"'!^%\r\n]/.test(text)) {
		throw new Error('project directory must not contain shell metacharacters');
	}
	if (!existsSync(text) || statSync(text).isDirectory() !== true) {
		throw new Error('project directory does not exist');
	}
	return text;
}

/** 跑引擎 CLI（status 等只读命令）；返回 {exitCode, stdout, stderr}。 */
export async function runEngineCli(shell, args, options = {}) {
	const request = {
		command: quoteArgv(args),
		timeoutMs: options.timeoutMs ?? 60_000,
		signal: options.signal,
	};
	const spec = typeof shell?.resolve === 'function' ? shell.resolve(request) : request;
	const exec = typeof shell?.execute === 'function'
		? await shell.execute(spec)
		: await shell.run(spec);
	const result = typeof exec?.result === 'function' ? await exec.result() : exec;
	const text = (value) => (typeof value === 'string' ? value : value?.text ?? '');
	return {
		exitCode: result?.exitCode ?? null,
		stdout: text(result?.stdout),
		stderr: text(result?.stderr),
		timedOut: result?.timedOut === true,
	};
}

/**
 * 构造 readPair：从引擎 status 找 latest staging，从 staging 目录读候选与基线。
 * @param {{shell:object, engineScript:string, python?:string, diag?:object}} deps
 * @returns {(projectDir: string) => Promise<{before:string, after:string, skillPath:string|null}>}
 */
export function makeReadPair(deps) {
	const { shell, engineScript, python = 'python', diag } = deps;
	return async (projectDir) => {
		const safeDir = assertSafeProjectDir(projectDir);
		const status = await runEngineCli(shell, [python, engineScript, 'status', '--json', '--project', safeDir]);
		if (status.timedOut) throw new Error('engine status timed out');
		const raw = status.stdout.slice(status.stdout.indexOf('{'));
		let payload;
		try {
			payload = JSON.parse(raw);
		} catch {
			throw new Error(`cannot parse engine status: ${(status.stderr || status.stdout).slice(0, 200)}`);
		}
		const stagingDir = payload?.latest_staging;
		if (typeof stagingDir !== 'string' || stagingDir === '' || !existsSync(stagingDir)) {
			throw new Error('no staged proposal (run skillopt_run first; latest_staging is empty)');
		}
		const names = readdirSync(stagingDir);
		const markdown = names.filter((name) => name.toLowerCase().endsWith('.md'));
		const manifests = names.filter((name) => name.toLowerCase().endsWith('.json'));
		if (markdown.length === 0 || manifests.length === 0) {
			throw new Error(`staging ${stagingDir} has no proposal/manifest pair (found: ${names.join(', ') || 'nothing'})`);
		}
		// manifest: 取含 live_skill_path 的第一行（字段名以引擎为准）。
		let livePath = null;
		for (const manifestName of manifests) {
			try {
				const manifest = JSON.parse(readFileSync(join(stagingDir, manifestName), 'utf8'));
				const rows = Array.isArray(manifest) ? manifest : manifest?.skills ?? manifest?.proposals ?? [manifest];
				const row = (Array.isArray(rows) ? rows : []).find((entry) => typeof entry?.live_skill_path === 'string');
				if (row !== undefined) { livePath = row.live_skill_path; break; }
			} catch { /* try next */ }
		}
		const after = readFileSync(join(stagingDir, markdown[0]), 'utf8');
		if (livePath === null || !existsSync(livePath)) {
			// 无基线时退回「候选内部基线」不可行——拒绝由 gate 处理。
			throw new Error('staging manifest has no reachable live_skill_path; baseline unavailable');
		}
		const before = readFileSync(livePath, 'utf8');
		diag?.append?.({ ev: 'skillopt.readpair', project: projectDir, stagingDir, livePath, bytesBefore: before.length, bytesAfter: after.length });
		return { before, after, skillPath: livePath };
	};
}

/**
 * 构造 judge 函数（供 adopt gate 用）：惰性取 parent/provider，起独立子代理盲评。
 * @param {object} deps
 * @param {object} deps.subagents ctx.get('subagents')
 * @param {() => Promise<{agent: object}>} deps.ensureParent
 * @param {() => string} deps.providerName
 * @param {number} [deps.votes]
 * @param {object} [deps.diag]
 */
export function makeJudge(deps) {
	const { subagents, ensureParent, providerName, votes, diag } = deps;
	return async ({ before, after, projectDir }) => {
		const parentInfo = await ensureParent();
		const provider = providerName();
		const result = await judgePair({
			before,
			after,
			subagents,
			parent: parentInfo?.agent,
			provider,
			cwd: projectDir,
			votes,
		});
		diag?.append?.({
			ev: 'skillopt.judge',
			project: projectDir,
			verdict: result.verdict,
			better: result.better,
			worse: result.worse,
			ties: result.ties,
			valid: result.valid,
			errors: result.errors,
		});
		return result;
	};
}
