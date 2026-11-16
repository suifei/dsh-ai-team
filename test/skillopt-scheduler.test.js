// 夜间自优化环的 Windows 计划任务脚本（vendored skillopt scheduler 生成的 run.ps1）。
// 实机（il2c，11-15/11-16）：任务每晚 03:17 触发、LastTaskResult=1、cron.log 一行未写——
// Windows PowerShell 5.1 在 `$ErrorActionPreference='Stop'` 下把引擎写往 stderr 的第一行
// 当作终止性错误，脚本在记日志之前就以 1 退出。这里用真实生成器 + 真实引擎复现：空项目里
// 引擎会往 stderr 报错并以非零退出，日志必须收到它，任务退出码必须是引擎自己的。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const vendor = fileURLToPath(new URL('../lib/vendor/skillopt', import.meta.url));
const python = process.env.SKILLOPT_PYTHON ?? 'python';
const hasPython = spawnSync(python, ['--version'], { encoding: 'utf8' }).status === 0;
const skip = process.platform !== 'win32' ? 'Windows scheduler helper only' : (hasPython ? false : 'python is not available');

const decode = (buffer) => (buffer[0] === 0xff && buffer[1] === 0xfe ? buffer.subarray(2).toString('utf16le') : buffer.toString('utf8'));

test('run.ps1 logs engine stderr and exits with the engine exit code', { skip }, () => {
	const project = mkdtempSync(join(tmpdir(), 'skillopt-sched-'));
	try {
		const generate = spawnSync(python, ['-X', 'utf8', '-c', [
			'import sys',
			`sys.path.insert(0, ${JSON.stringify(vendor)})`,
			'from skillopt_sleep import scheduler',
			`print(scheduler._runner_cmd(${JSON.stringify(project)}, "mock", "--source no_such_source", sys.executable))`,
		].join('\n')], { encoding: 'utf8' });
		assert.equal(generate.status, 0, generate.stderr);
		const script = join(project, '.skillopt-sleep', 'run.ps1');
		const bytes = readFileSync(script);
		assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'run.ps1 must carry a UTF-8 BOM for Windows PowerShell 5.1');
		const text = bytes.toString('utf8');
		assert.match(text, /\$ErrorActionPreference = 'Continue'/);
		assert.match(text, /exit \$LASTEXITCODE/);

		// 确定性的失败：未知的 transcript source 让引擎在 stderr 报参数错误并以非零退出。
		// 家目录指到临时目录：引擎读写 ~/.skillopt-sleep，不能依赖、也不能改动本机用户的配置与状态
		// （此前本例靠本机 config.json 里一个坏掉的 transcript_source 才失败，配置一修好测试就变红）。
		const env = { ...process.env, USERPROFILE: project, HOME: project };
		const run = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { encoding: 'utf8', env });
		const log = join(project, '.skillopt-sleep', 'cron.log');
		assert.ok(existsSync(log), 'cron.log must be written');
		const logged = decode(readFileSync(log));
		assert.match(logged, /invalid choice: 'no_such_source'/, 'engine stderr must reach the log');
		assert.notEqual(run.status, 0, 'a failing engine must fail the task');
		assert.doesNotMatch(logged, /NativeCommandError/, 'stderr lines are logged as plain text, not PowerShell error records');
	} finally {
		rmSync(project, { recursive: true, force: true });
	}
});
