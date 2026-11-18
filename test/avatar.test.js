import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { DEFAULT_AVATAR, parseAvatar, renderAvatarSvg } from '../lib/domain/avatar.js';
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

test('renderAvatarSvg draws locally with hash-avatar v1: same picture as the library, loose params fall back, ring only at 128px+', () => {
	const HashAvatar = createRequire(import.meta.url)('@suifei/hash-avatar');
	assert.equal(HashAvatar.version, 'v1');
	assert.equal(renderAvatarSvg('墨渊', { gender: 'male', age: 'middle', race: 'asian', size: 64 }), HashAvatar.svg('墨渊', { gender: 'male', age: 'middle', race: 'asian', size: 64, fingerprint: false }));
	assert.equal(renderAvatarSvg('墨渊', { gender: 'robot', age: null, race: 'x', size: 'abc' }), HashAvatar.svg('墨渊', { ...DEFAULT_AVATAR, size: 64, fingerprint: false }));
	assert.equal(renderAvatarSvg('墨渊', { size: 144 }), HashAvatar.svg('墨渊', { ...DEFAULT_AVATAR, size: 144, fingerprint: true }));
	assert.match(renderAvatarSvg('', { size: 99999 }), /width="1024"/);
});

test('GET /ai-team/api/avatar.svg serves the SVG from the plugin itself, cacheable, no network', async (t) => {
	const { apply } = await import('../index.js');
	const routes = [];
	const root = mkdtempSync(join(tmpdir(), 'ai-team-avatar-route-'));
	const prevHome = process.env.DSH_HOME;
	process.env.DSH_HOME = root;
	const ctx = {
		effect(fn) { fn(); },
		on() { return () => {}; },
		get(id) {
			if (id === 'connection') return { requestRejection: () => undefined };
			if (id === 'webServer') return { register(route) { routes.push(route); return () => {}; } };
			if (id === 'permissionPresets') return { catalog: () => ({ defaultPreset: 'danger-full-access', options: [], defaultOptions: [] }), resolve: () => ({ sandbox: 'danger-full-access', approval: 'never' }) };
			if (id === 'sandboxPolicy') return { defaultMode: 'danger-full-access', overrideOf: () => 'danger-full-access' };
			return undefined;
		},
	};
	apply(ctx);
	const server = createServer((req, res) => routes[0].handler(req, res));
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	t.after(async () => {
		await new Promise((r) => server.close(r));
		if (prevHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prevHome;
		rmSync(root, { recursive: true, force: true });
	});
	const r = await fetch(`http://127.0.0.1:${server.address().port}/ai-team/api/avatar.svg?name=${encodeURIComponent('青岚')}&gender=female&age=youth&race=asian&size=80`);
	assert.equal(r.status, 200);
	assert.match(r.headers.get('content-type'), /^image\/svg\+xml/);
	assert.match(r.headers.get('cache-control'), /immutable/);
	assert.equal(await r.text(), renderAvatarSvg('青岚', { gender: 'female', age: 'youth', race: 'asian', size: 80 }));
});
