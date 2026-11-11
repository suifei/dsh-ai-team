/**
 * Headless render E2E (client factory → full workbench tree evaluation).
 *
 * Rationale: `node --check` cannot catch shorthand-property references to
 * undefined identifiers (e.g. `{ onOpenProfile, }` where the Workbench scope
 * only has `openProfile`) — such code is syntactically valid but throws
 * ReferenceError at first render, exactly the production failure this test
 * guards against. This test executes every component function body and every
 * element-props expression of the main workbench path with a behavior-faithful
 * React mock, so any undefined identifier in the render path fails here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const now = Date.now();
const BOOTSTRAP = {
	ok: true,
	revision: 42,
	projects: [{ id: 'prj_t', name: '测试项目', workspacePath: 'E:/works/demo' }],
	project: { id: 'prj_t', name: '测试项目', workspacePath: 'E:/works/demo' },
	agents: [
		{ id: 'a1', name: '青岚', role: '执行', status: 'running', config: { model: 'glm-x', contextWindow: 128000 }, configVersion: 3 },
		{ id: 'a2', name: '墨渊', role: '复核', status: 'failed', lastFailure: { category: 'billing', message: '余额不足' } },
	],
	humanMemberId: 'h1',
	stream: [
		{ id: 's1', type: 'agent_message', at: now - 60000, author: { name: '青岚', kind: 'agent' }, body: '已认领任务并开始执行。', taskIds: ['t1'] },
		{ id: 's2', type: 'human_message', at: now - 30000, author: { name: '你', kind: 'human' }, body: '请优先处理高风险项。' },
	],
	tasks: [
		{ id: 't1', number: 1, title: '实现登录页', status: 'in_progress', ownerId: 'a1', assigneeId: 'a1', revision: 3, blockedBy: [], irreversible: false, createdAt: now - 3600000, updatedAt: now - 60000, replies: 2, summary: '登录页初稿' },
		{ id: 't2', number: 2, title: '数据迁移脚本', status: 'pending_acceptance', ownerId: 'h1', assigneeId: 'a2', revision: 5, blockedBy: [], irreversible: true, createdAt: now - 7200000, updatedAt: now - 120000, replies: 4, summary: '迁移脚本待验收' },
		{ id: 't3', number: 3, title: '评审文档', status: 'done', ownerId: 'a2', assigneeId: 'a2', revision: 8, blockedBy: [], irreversible: false, createdAt: now - 86400000, updatedAt: now - 3600000, replies: 1 },
	],
	inbox: [
		{ id: 'i1', memberId: 'h1', type: 'decision_required', requiresDecision: true, state: 'unread', createdAt: now - 25 * 3600000, ackedAt: null, projectName: '测试项目', ref: { title: '迁移脚本验收', taskId: 't2', category: 'billing', memberName: '墨渊', questions: [{ id: 'q1', text: '是否通过验收？', options: ['通过', '打回'], recommendation: '通过' }] } },
		{ id: 'i2', memberId: 'h1', type: 'decision_required', requiresDecision: true, state: 'done', createdAt: now - 96 * 3600000, ackedAt: now - 90 * 3600000, projectName: '测试项目', ref: { title: '历史决策', taskId: 't3', questions: [] } },
	],
	quadrants: {
		rev: 42, generatedAt: now,
		q1: { count: 1, items: [{ kind: 'task', category: 'review', taskId: 't2', taskNumber: 2, title: '数据迁移脚本' }] },
		q2: { count: 1, items: [{ kind: 'task', category: 'work', taskId: 't1', taskNumber: 1, title: '实现登录页' }] },
		q3: { count: 0, items: [] },
		q4: { count: 1, items: [{ kind: 'task', category: 'done', taskId: 't3', taskNumber: 3, title: '评审文档' }] },
	},
	threads: {
		t1: { taskId: 't1', headSeq: 2, entries: [
			{ seq: 1, author: '青岚', authorId: 'a1', body: '认领了', at: now - 60000 },
			{ seq: 2, author: '你', authorId: 'h1', body: '加油', at: now - 30000 },
		] },
	},
	follows: {},
	notes: {},
	modelCatalog: { providers: [{ id: 'prov', name: 'Prov', models: [{ id: 'm1', name: 'Model One' }], modelCount: 1 }] },
};
const MODELS = { ok: true, providers: BOOTSTRAP.modelCatalog.providers };
const PENDING = { ok: true, rows: [
	{ taskId: 't2', taskNumber: 2, title: '数据迁移脚本', category: 'irreversible', projectId: 'prj_t', projectName: '测试项目' },
]};
const RISKS = { ok: true, risks: { rev: 42, generatedAt: now, blocked: [], failures: [], staleDecisions: [{ itemId: 'i1', title: '迁移脚本验收', taskId: 't2', waitingHours: 25 }], counts: { blocked: 0, failures: 0, staleDecisions: 1 } } };
const PEOPLE = { ok: true, people: [
	{ name: '青岚', role: '执行', projects: [{ projectId: 'prj_t', projectName: '测试项目', status: 'running', sessionId: 'x', talentPool: false, attempts: 0, lastFailure: null, activeTasks: 1, inProgress: 1, pendingAcceptance: 0, pending: 0, blocked: 0 }], failures: 0, activeTasks: 1 },
]};

function makeReact() {
	// hooks slots persist per component function across render passes,
	// mirroring React's state persistence between renders. A per-component
	// cursor emulates the hook call-order contract: render N reads the same
	// slot indexes that render N-1 wrote, never a fresh initial value.
	const slotsByComponent = new Map();
	const effectsOnce = new WeakSet();
	let currentSlots = null;
	let currentComponentType = null;
	const createElement = (type, props = null, ...children) => {
		// HTML forbids nested <button>; a misplaced closer silently reparents
		// sibling buttons as children (user-visible as one giant button box).
		const containsButton = (node) => {
			if (node === null || node === undefined) return false;
			if (Array.isArray(node)) return node.some(containsButton);
			if (typeof node !== 'object') return false;
			if (node.type === 'button') return true;
			if (Array.isArray(node.children)) return node.children.some(containsButton);
			if (node.children !== undefined) return containsButton(node.children);
			return false;
		};
		if (type === 'button' && children.some(containsButton)) {
			throw new Error('E2E nested-button guard: a <button> rendered with another <button> inside — check the element closers');
		}
		if (type !== null && typeof type === 'function') {
			const prev = currentSlots;
			const prevType = currentComponentType;
			let slots = slotsByComponent.get(type);
			if (!slots) { slots = { items: [], cursor: 0 }; slotsByComponent.set(type, slots); }
			slots.cursor = 0;
			currentSlots = slots;
			currentComponentType = type;
			if (process.env.RENDER_DEBUG && type.name === 'Workbench') {
				console.error('[dbg] Workbench render entry, slot0 =', JSON.stringify(slots.items[0] && slots.items[0].value));
			}
			let output;
			try {
				const fullProps = { ...(props ?? {}), children: children.length <= 1 ? children[0] : children };
				if (type.prototype && type.prototype instanceof React.Component) {
					const instance = new type(fullProps);
					output = instance.render();
				} else {
					output = type(fullProps);
				}
			} finally {
				currentSlots = prev;
				currentComponentType = prevType;
				// React #310 guard: hooks count must be constant across renders
				// of the same component (a hook added after an early-return
				// branch crashes real React on the data-arrive re-render).
				if (slots.prevHookCount !== undefined && slots.cursor > slots.prevHookCount) {
					throw new Error(`E2E #310 guard: ${type.name || 'component'} rendered ${slots.cursor} hooks after ${slots.prevHookCount} on the previous pass — hooks must not appear after early returns`);
				}
				slots.prevHookCount = Math.max(slots.prevHookCount ?? 0, slots.cursor);
			}
			return { type: type.name || 'Anonymous', props, children: [output] };
		}
		return { type: typeof type === 'string' ? type : 'host', props, children };
	};
	const React = {
		createElement,
		__debugSlots: (componentName) => {
			for (const [fn, slots] of slotsByComponent) {
				if (fn.name === componentName) return slots.items.map((entry, i) => {
					const raw = entry === null || entry === undefined ? null : ('value' in entry ? entry.value : entry.current);
					return `[${i}]=${JSON.stringify(raw === undefined ? null : raw).substring(0, 50)}`;
				});
			}
			return null;
		},
		Component: class Component { constructor(props) { if (props) this.props = props; } },
		useState(initial) {
			const slot = currentSlots.cursor++;
			if (slot >= currentSlots.items.length) currentSlots.items.push({ value: initial });
			const entry = currentSlots.items[slot];
			const set = (next) => {
				entry.value = typeof next === 'function' ? next(entry.value) : next;
				if (process.env.RENDER_DEBUG) console.error('[dbg] set slot', slot, '=', String(entry.value).substring(0, 60));
			};
			return [entry.value, set];
		},
		useRef(initial) {
			const slot = currentSlots.cursor++;
			if (slot >= currentSlots.items.length) currentSlots.items.push({ current: initial });
			return currentSlots.items[slot];
		},
		useEffect(fn) {
			// 依赖数组语义近似：同一组件的 mount-effect 只执行一次（cleanup 亦不重跑），
			// 否则每次重渲染都重置上一轮的 `alive` 标志，异步数据永远被拒收。
			const key = currentComponentType;
			if (key !== null && effectsOnce.has(key)) return () => {};
			effectsOnce.add(key);
			fn();
			return () => {};
		},
		useMemo(fn) { return fn(); },
		useCallback(fn) { return fn(); },
		useLayoutEffect(fn) { fn(); return () => {}; },
	};
	return React;
}

test('headless render: workbench main path evaluates every component without reference errors', async () => {
	const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
	const React = makeReact();
	const sandboxBox = { captured: null };
	const sandbox = {
		window: {
			__ModuleLoader__: { load(definition) { sandboxBox.captured = definition; } },
			addEventListener() {}, removeEventListener() {},
			location: { href: 'http://127.0.0.1:28862/', pathname: '/', search: '' },
			setTimeout: () => 0, clearTimeout() {},
		},
		document: {
			createElement() { return { dataset: {}, textContent: '', style: {}, remove() {}, appendChild() {} }; },
			head: { append() {} }, addEventListener() {}, removeEventListener() {},
			activeElement: null, querySelector: () => null,
		},
		EventSource: class { addEventListener() {} close() {} },
		location: { href: 'http://127.0.0.1:28862/', pathname: '/', search: '' },
		requestAnimationFrame: () => 0,
		setTimeout: () => 0, clearTimeout() {},
		console: { log() {}, error() {}, warn() {} },
		fetch: async (url) => {
			const path = String(url).split('?')[0];
			const ok = (body) => ({ ok: true, status: 200, json: async () => body });
			if (path === '/ai-team/api/bootstrap') return ok(BOOTSTRAP);
			if (path === '/ai-team/api/models') return ok(MODELS);
			if (path === '/ai-team/api/pending-acceptance') return ok(PENDING);
			if (path === '/ai-team/api/risks') return ok(RISKS);
			if (path === '/ai-team/api/people') return ok(PEOPLE);
			return { ok: false, status: 404, json: async () => ({ error: { code: 'NOT_FOUND', message: path } }) };
		},
	};
	vm.runInNewContext(source, sandbox, { filename: 'client.js' });
	const definition = sandboxBox.captured;
	assert.equal(definition.id, '@suifei/dsh-ai-team');

	const mod = definition.factory(() => React);
	let mainRender = null;
	const ctx = {
		effect(fn) { fn(); },
		locale: { register() {}, bind: (ns) => (key) => ns + '.' + key },
		slots: {
			inject(name, install) { install(); },
			register(options, render) {
				if (options.name === 'main') mainRender = render;
				return () => {};
			},
		},
	};
	mod.apply(ctx);
	assert.equal(typeof mainRender, 'function', 'main slot renderer must be registered');

	// Pass 1: synchronous tree evaluation (loading phase) — every component
	// function body and props expression runs here.
	const tree1 = mainRender();
	assert.ok(tree1, 'render must return an element tree');

	// Let the async bootstrap fetch resolve, then re-render with data.
	await new Promise((resolve) => setTimeout(resolve, 20));
	console.log('WORKBENCH SLOTS before pass2:', JSON.stringify(React.__debugSlots('Workbench')));

	// Pass 2/3: data-backed renders — StreamMessage, TeamPulse, board cards,
	// inbox rows, pending queue, event history all evaluate now.
	const tree2 = mainRender();
	assert.ok(tree2, 're-render must return an element tree');
	const dump2 = [];
	const collect2 = (node) => {
		if (typeof node === 'string') dump2.push(node);
		else if (node && typeof node === 'object') {
			if (Array.isArray(node.children)) node.children.forEach(collect2);
			else if (node.children !== undefined) collect2(node.children);
		}
	};
	collect2(tree2);
	console.log('TREE2 STRINGS:', JSON.stringify(dump2.slice(0, 20)));
	const tree3 = mainRender();
	assert.ok(tree3, 'third render must return an element tree');

	const allStrings = [];
	const collect = (node) => {
		if (typeof node === 'string') allStrings.push(node);
		else if (node && typeof node === 'object') {
			if (Array.isArray(node.children)) node.children.forEach(collect);
			else if (node.children !== undefined) collect(node.children);
		}
	};
	collect(tree3);
	console.log('TREE STRINGS:', JSON.stringify(allStrings.slice(0, 40)));
	const flattened = JSON.stringify(tree3, (key, value) => {
		if (key === 'props') return undefined;
		if (typeof value === 'function') return undefined;
		return value;
	});
	assert.ok(flattened.includes('Task #'), 'task cards must render');

	// R-04 防刷屏回归：管理视图的 UI children 不得携带超长技术原文
	// （失败 message 等调试串只允许出现在 hover title 属性里）。
	const oversize = [];
	const stringified = [];
	const walkStrings = (node) => {
		if (typeof node === 'string') {
			if (node.length > 200) oversize.push(node.slice(0, 60));
			if (node.includes('[object Object]')) stringified.push(node.slice(0, 80));
			return;
		}
		if (node && typeof node === 'object') {
			if (Array.isArray(node.children)) node.children.forEach(walkStrings);
			else if (node.children !== undefined) walkStrings(node.children);
		}
	};
	walkStrings(tree3);
	assert.deepEqual(oversize, [], 'no UI string may exceed 200 chars — long diagnostics belong in title attributes');
	assert.deepEqual(stringified, [], 'no object may be stringified into UI text ([object Object]) — read .id/.name from catalog rows');
});
