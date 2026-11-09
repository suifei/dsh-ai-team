import { readFileSync } from 'node:fs';

/** Single source of the built-in engineering discipline; packaged as skills/ai-team-core/SKILL.md. */
export const CORE_SKILL_TEXT = readFileSync(new URL('../../skills/ai-team-core/SKILL.md', import.meta.url), 'utf8');
