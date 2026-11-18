import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_AVATAR, parseAvatar } from '../lib/domain/avatar.js';
import { listTalents, listTeams, loadCatalog, parseTalent, resolveTeam, talentFromMember, writeTalent } from '../lib/domain/catalog.js';
import { applyEvent, initialState } from '../lib/ledger/fold.js';

const repo = fileURLToPath(new URL('..', import.meta.url));
const bundled = () => loadCatalog({ roots: [{ source: 'bundled', dir: repo }] });

test('parseAvatar: absent is null, partial fills the defaults, typos are refused with the field named', () => {
	assert.equal(parseAvatar(undefined), null);
	assert.equal(parseAvatar(null), null);
	assert.deepEqual(parseAvatar({ gender: 'female' }), { ...DEFAULT_AVATAR, gender: 'female' });
	assert.deepEqual(parseAvatar({ gender: 'male', age: 'old', race: 'auto' }), { gender: 'male', age: 'old', race: 'auto' });
	assert.throws(() => parseAvatar({ age: 'elder' }), /avatar\.age/);
	assert.throws(() => parseAvatar('male'), /必须是对象/);
});

test('every bundled talent ships an Asian avatar preset; teams and the market carry it to the cards', () => {
	const catalog = bundled();
	const talents = listTalents(catalog);
	assert.equal(talents.length, 44);
	for (const talent of talents) {
		assert.ok(talent.avatar, `${talent.id} has an avatar`);
		assert.equal(talent.avatar.race, 'asian', `${talent.id} defaults to asian`);
	}
	assert.deepEqual(talents.find((x) => x.id === 'pmo-lead').avatar, { gender: 'male', age: 'middle', race: 'asian' });
	const team = resolveTeam(catalog, 'default').team;
	assert.deepEqual(team.members.find((m) => m.id === 'mem_lead').avatar, { gender: 'male', age: 'middle', race: 'asian' });
	assert.ok(listTeams(catalog).every((entry) => entry.members.every((m) => m.avatar && m.avatar.race === 'asian')));
	assert.throws(() => parseTalent('name: a\nrole: b\navatar: { gender: robot }\n', 'x'), /x: avatar\.gender/);
});

test('custom talents keep the chosen avatar; save-as-talent carries the member avatar', () => {
	const root = mkdtempSync(join(tmpdir(), 'ai-team-avatar-'));
	try {
		const saved = writeTalent(root, 'my-artist', { name: '画眉', role: '插画', avatar: { gender: 'female', age: 'teen', race: 'white' } });
		assert.deepEqual(saved.avatar, { gender: 'female', age: 'teen', race: 'white' });
		const plain = writeTalent(root, 'plain', { name: '素', role: '执行' });
		assert.equal(plain.avatar, null);
		assert.deepEqual(talentFromMember({ name: 'x', role: 'y', avatar: { gender: 'neutral', age: 'old', race: 'black' } }, 'executor').avatar, { gender: 'neutral', age: 'old', race: 'black' });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('the ledger remembers a member avatar from member-added and profile-updated; bad shapes keep the old one', () => {
	let state = initialState();
	state = applyEvent(state, { seq: 1, type: 'project/member-added', at: 1, actor: { kind: 'human' }, payload: { memberId: 'mem_a', name: '甲', kind: 'agent', avatar: { gender: 'male', age: 'youth', race: 'asian' } } });
	assert.deepEqual(state.members.mem_a.avatar, { gender: 'male', age: 'youth', race: 'asian' });
	state = applyEvent(state, { seq: 2, type: 'member/profile-updated', at: 2, actor: { kind: 'human' }, payload: { memberId: 'mem_a', avatar: { gender: 'female', age: 'old', race: 'brown' } } });
	assert.deepEqual(state.members.mem_a.avatar, { gender: 'female', age: 'old', race: 'brown' });
	state = applyEvent(state, { seq: 3, type: 'member/profile-updated', at: 3, actor: { kind: 'human' }, payload: { memberId: 'mem_a', name: '乙', avatar: { gender: 'x' } } });
	assert.deepEqual(state.members.mem_a.avatar, { gender: 'female', age: 'old', race: 'brown' });
	assert.equal(state.members.mem_a.name, '乙');
});

test('service: member.add keeps the avatar, an avatar-only profile update is a change, a typo is INVALID_ARGUMENT', async (t) => {
	const { openLedger } = await import('../lib/ledger/writer.js');
	const { TeamService } = await import('../lib/host/service.js');
	const dir = mkdtempSync(join(tmpdir(), 'ai-team-avatar-svc-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const service = new TeamService({ ledger: openLedger({ dir, projectId: 'prj_av' }) });
	const human = { kind: 'human', memberId: 'h1' };
	await service.dispatch({ type: 'member.add', actor: human, projectId: 'prj_av', payload: { id: 'h1', name: '你', kind: 'human', role: 'Human' } });
	await service.dispatch({ type: 'member.add', actor: human, projectId: 'prj_av', payload: { id: 'a1', name: '甲', role: '执行', avatar: { gender: 'female', age: 'youth', race: 'asian' } } });
	assert.deepEqual(service.state.members.a1.avatar, { gender: 'female', age: 'youth', race: 'asian' });
	await service.dispatch({ type: 'member.profile.update', actor: human, projectId: 'prj_av', payload: { memberId: 'a1', avatar: { gender: 'male', age: 'old', race: 'white' } } });
	assert.deepEqual(service.state.members.a1.avatar, { gender: 'male', age: 'old', race: 'white' });
	await assert.rejects(service.dispatch({ type: 'member.profile.update', actor: human, projectId: 'prj_av', payload: { memberId: 'a1', avatar: { gender: 'male', age: 'old', race: 'white' } } }), /required/);
	await assert.rejects(service.dispatch({ type: 'member.add', actor: human, projectId: 'prj_av', payload: { id: 'a2', name: '乙', avatar: { age: 'elder' } } }), (error) => error.code === 'E_INVALID_ARGUMENT' || /avatar\.age/.test(error.message));
	assert.equal(service.state.members.a2, undefined);
});
