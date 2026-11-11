/**
 * 取消/重开理由「可留空」链路测试（用户实证的取消失败）：
 * - UI：WorkbenchDialog 的 optional 语义（空理由 canSubmit=true）由渲染 E2E
 *   覆盖组件树；此处验证 domain/host 链路空理由全通。
 * - domain：cancelTask/reopenTask 空/缺省 reason 不再拒绝，事件 reason 统一 ''。
 * - host：dispatch('task.cancel') 空 reason 成功且账本留痕。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cancelTask, reopenTask, createTask, claimTask, submitTask } from '../lib/domain/task.js';
import { TeamService } from '../lib/host/service.js';
import { openLedger } from '../lib/ledger/writer.js';

const BASE_AT = 1_700_000_000_000;
const PROJECT_ID = 'prj_cancel';
const human = { kind: 'human', memberId: 'h1' };
const agent = { kind: 'agent', memberId: 'a1' };

function makeTask() {
	return createTask({ number: 1, title: '演示任务', resultDefinition: '完成即验收', ownerId: 'h1' }).task;
}

function makeSubmitted() {
	const task = makeTask();
	const claimed = claimTask(task, agent, {}, { at: BASE_AT });
	return submitTask(claimed.task, agent, { summary: '完成', evidence: [{ kind: 'text', value: '证据' }] }, { at: BASE_AT + 1 });
}

test('domain: cancel/reopen accept empty or missing reason (reason recorded as empty string)', () => {
	const task = makeTask();
	const cancelled = cancelTask(task, human, { reason: '' , at: BASE_AT });
	assert.equal(cancelled.task.status, 'cancelled');
	assert.equal(cancelled.event.payload.reason, '');

	// cancelled 不可 reopen（既有域规则）；reopen 的空理由从 pending_acceptance 验证。
	const submitted = makeSubmitted();
	assert.equal(submitted.task.status, 'pending_acceptance');
	const reopened = reopenTask(submitted.task, human, { at: BASE_AT + 2 });
	assert.equal(reopened.task.status, 'in_progress', 'valid assignee returns to in_progress');
	assert.equal(reopened.event.payload.reason, '');

	// 超长仍被拒（边界保留）。
	assert.throws(() => cancelTask(task, human, { reason: 'x'.repeat(2001) }), /too long/);
});

test('host: task.cancel with an empty reason succeeds and leaves a ledger trail', async (t) => {
	const fs = await import('node:fs');
	const os = await import('node:os');
	const path = await import('node:path');
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiteam-cancel-'));
	t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); });
	const ledger = openLedger({ dir, projectId: PROJECT_ID });
	const service = new TeamService({ ledger, now: () => BASE_AT });
	await service.dispatch({ type: 'project.create', actor: human, payload: { id: PROJECT_ID, name: 'P', goal: 'g', ownerId: 'h1' } });
	await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'h1', name: 'Human', kind: 'human' } });
	const created = await service.dispatch({ type: 'task.create', actor: human, projectId: PROJECT_ID, payload: { title: '待取消', resultDefinition: 'x' } });

	const result = await service.dispatch({
		type: 'task.cancel',
		actor: human,
		projectId: PROJECT_ID,
		payload: { taskId: created.task.id, expectedRevision: created.task.revision, reason: '' },
	});
	assert.equal(result.task.status, 'cancelled');
	assert.equal(ledger.state.tasks[created.task.id].status, 'cancelled');
	const cancelledEvent = ledger.events.filter((event) => event.type === 'task/cancelled').at(-1);
	assert.equal(cancelledEvent.payload.reason, '');
});
