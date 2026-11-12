import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultDiagDir, isErrorEvent } from '../lib/diaglog.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

test('the diagnostic dir follows DSH_HOME so isolated instances cannot pollute production', () => {
	// 实机事故：跑测试（DSH_HOME 指到临时目录）时，诊断行仍写进真实的
	// `~/.dsh/ai-team`，生产日志里混进了 `E:/definitely-not-existing-dir-xyz`
	// 这类夹具行。
	const previous = process.env.DSH_HOME;
	try {
		delete process.env.DSH_HOME;
		assert.equal(defaultDiagDir(), join(homedir(), '.dsh', 'ai-team'));

		const isolated = join(homedir(), 'aiteam-fake-home');
		process.env.DSH_HOME = isolated;
		assert.equal(defaultDiagDir(), join(isolated, 'ai-team'));
		assert.notEqual(defaultDiagDir(), join(homedir(), '.dsh', 'ai-team'));

		// 空白值按未设置处理（不要拼出 `/ai-team` 这种根路径）。
		process.env.DSH_HOME = '   ';
		assert.equal(defaultDiagDir(), join(homedir(), '.dsh', 'ai-team'));
	} finally {
		if (previous === undefined) delete process.env.DSH_HOME;
		else process.env.DSH_HOME = previous;
	}
});

test('a benign flush on a closed handle is not an error event', () => {
	// turn/end 之后句柄已关闭：降级为 session.flush.skipped，不该在发布默认级别出现。
	assert.equal(isErrorEvent('session.flush.fail'), true);
	assert.equal(isErrorEvent('session.flush.skipped'), false);
});
