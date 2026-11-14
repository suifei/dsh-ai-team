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

test('self-heal outcomes stay visible at the shipped level', () => {
	// 与 host.repair.ok 同理：这些是「救回来没有」的关键证据，不能只在 full 级别出现。
	assert.equal(isErrorEvent('host.repair.ok'), true);
	assert.equal(isErrorEvent('member.session.reused'), true);
	// 普通进度行仍然被过滤（errors 级别不能变成 full）。
	assert.equal(isErrorEvent('dispatch.start'), false);
	assert.equal(isErrorEvent('ledger.open'), false);
});
