import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSkillCatalog } from '../lib/runtime/skill-catalog.js';

test('skill catalog exposes names, descriptions and when-to-use with bounds', async () => {
	const skills = {
		async list(options) {
			assert.equal(options.cwd, 'E:/works/demo');
			return [
				{ name: 'nuwa-skill', description: '制造新技能', whenToUse: '需要新角色能力时' },
				{ name: 'distilly', description: 'x'.repeat(300) },
			];
		},
	};
	const text = await formatSkillCatalog(skills, { cwd: 'E:/works/demo', limit: 2 });
	assert.match(text, /nuwa-skill/);
	assert.match(text, /需要新角色能力时/);
	assert.match(text, /distilly/);
	assert.match(text, /…/);
});

test('skill catalog is empty when the service or catalog is absent', async () => {
	assert.equal(await formatSkillCatalog(null), '');
	assert.equal(await formatSkillCatalog({ list: async () => [] }), '');
});
