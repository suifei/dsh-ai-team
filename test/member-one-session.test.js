import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLedger } from '../lib/ledger/writer.js';
import { TeamService } from '../lib/host/service.js';
import { FAILURE_CATEGORY } from '../lib/runtime/failure-policy.js';

// 一个成员一个会话（官方契约：可续接子智能体只在首次 startActivation 创建，之后一律
// subagents.sendMessage，离线由宿主冷恢复）。原会话续接不上时插件不新建子智能体，
// 而是把成员记为 failed、给 Human 一条决策项（host.test 覆盖「不新建」那一半）。

const human = { kind: 'human', memberId: 'h1' };

test('an unresumable session stops the member and asks Human; rebinding keeps the same session', async () => {
	assert.equal(FAILURE_CATEGORY.SESSION, 'session');
	const root = await mkdtemp(join(tmpdir(), 'ai-team-one-session-'));
	const ledger = openLedger({ dir: join(root, 'ledger'), projectId: 'prj_s', fsync: false });
	const service = new TeamService({ ledger });
	try {
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'h1', name: 'Human', kind: 'human' } });
		await service.dispatch({ type: 'member.add', actor: human, payload: { id: 'a1', name: '玄策', kind: 'agent' } });
		await service.dispatch({ type: 'project.create', actor: human, payload: { workspacePath: process.cwd(), name: 'S', ownerId: 'a1' } });
		await service.dispatch({ type: 'member.bind', actor: human, payload: { memberId: 'a1', sessionId: 's-1' } });

		const result = await service.recordMemberFailure('a1', { category: 'session', code: 'NOT_RESUMABLE', message: 'not resumable' }, 'prj_s');
		assert.equal(service.state.members.a1.status, 'failed', 'the waker stops waking it: no loop');
		assert.equal(service.state.members.a1.sessionId, 's-1', 'its one session is kept');
		assert.equal(result.inboxItem?.memberId, 'h1', 'Human gets a decision item');
		assert.equal(result.inboxItem.ref.kind, 'member_failure');
		assert.equal(result.inboxItem.ref.category, 'session');

		// 同一失败不重复刷决策项。
		const again = await service.recordMemberFailure('a1', { category: 'session', code: 'NOT_RESUMABLE', message: 'not resumable' }, 'prj_s');
		assert.equal(again.inboxItem, null);

		// Human 选择复用：重新绑定同一会话即回到 running，不产生新会话。
		await service.dispatch({ type: 'member.bind', actor: human, payload: { memberId: 'a1', sessionId: 's-1' } });
		assert.equal(service.state.members.a1.status, 'running');
		assert.equal(service.state.members.a1.sessionId, 's-1');
	} finally {
		ledger.close();
		await rm(root, { recursive: true, force: true });
	}
});
