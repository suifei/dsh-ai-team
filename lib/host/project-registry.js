/** Lightweight Project index. The ledger remains the source of truth for Project state. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PROJECT_ID } from './project-runtime.js';

export class ProjectRegistry {
	constructor({ rootDir, projects, activeProjectId }) {
		this.rootDir = rootDir;
		this.projects = Array.isArray(projects) ? projects : [];
		this.activeProjectId = activeProjectId ?? DEFAULT_PROJECT_ID;
	}

	static load(rootDir) {
		mkdirSync(rootDir, { recursive: true });
		const file = join(rootDir, 'projects.json');
		let parsed;
		try {
			parsed = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
		} catch {
			parsed = null;
		}
		const projects = Array.isArray(parsed?.projects) && parsed.projects.length > 0
			? parsed.projects.filter((project) => typeof project?.id === 'string' && project.id !== '')
			: [{ id: DEFAULT_PROJECT_ID, name: '我的项目', createdAt: 0 }];
		if (!projects.some((project) => project.id === DEFAULT_PROJECT_ID)) {
			projects.unshift({ id: DEFAULT_PROJECT_ID, name: '我的项目', createdAt: 0 });
		}
		const active = projects.some((project) => project.id === parsed?.activeProjectId)
			? parsed.activeProjectId
			: DEFAULT_PROJECT_ID;
		const registry = new ProjectRegistry({ rootDir, projects, activeProjectId: active });
		if (!existsSync(file)) registry.save();
		return registry;
	}

	get activeProject() {
		return this.projects.find((project) => project.id === this.activeProjectId) ?? this.projects[0];
	}

	list() {
		return this.projects.map((project) => ({ ...project, active: project.id === this.activeProjectId }));
	}

	add({ id, name, createdAt, goal, workspacePath }) {
		if (typeof id !== 'string' || id === '') throw new Error('project id is required');
		if (!this.projects.some((project) => project.id === id)) {
			this.projects.push({ id, name: name ?? id, goal: goal ?? '', workspacePath: workspacePath ?? '', createdAt: createdAt ?? Date.now() });
			this.save();
		}
		return this.projects.find((project) => project.id === id);
	}

	setActive(id) {
		if (!this.projects.some((project) => project.id === id)) throw new Error(`unknown project: ${id}`);
		this.activeProjectId = id;
		this.save();
	}

	save() {
		const file = join(this.rootDir, 'projects.json');
		const temp = `${file}.tmp`;
		writeFileSync(temp, JSON.stringify({
			activeProjectId: this.activeProjectId,
			projects: this.projects,
		}, null, 2), 'utf8');
		renameSync(temp, file);
	}
}
