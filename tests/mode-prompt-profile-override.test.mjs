import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const prompt = readFileSync(new URL('../modes/oferta.md', import.meta.url), 'utf8');

test('evaluation mode prompt honors CAREER_OPS_PROFILE', () => {
  assert.match(prompt, /CAREER_OPS_PROFILE/);
});
