// doctor.mjs warns about the user's own templates (#5777): one that no longer
// resolves, or that lost a slot every shipped variant keeps. Advisory only: it
// never makes onboardingNeeded true.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function doctorJson(target) {
  return JSON.parse(execFileSync(process.execPath, [join(ROOT, 'doctor.mjs'), '--json', '--target', target], {
    cwd: target, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
  }));
}

function target(templates) {
  const dir = mkdtempSync(join(tmpdir(), 'co-doctor-tpl-'));
  mkdirSync(join(dir, 'data', 'templates'), { recursive: true });
  for (const [file, text] of Object.entries(templates)) writeFileSync(join(dir, 'data', 'templates', file), text);
  return dir;
}

test('a user template that no longer resolves is a doctor warning naming the file', () => {
  const dir = target({ 'cv-template.broken.html': '{{NAME}}' });

  const out = doctorJson(dir);

  const warning = out.warnings.find((w) => w.includes('cv-template.broken.html'));
  assert.ok(warning, JSON.stringify(out.warnings));
  assert.match(warning, /missing required placeholders/);
});

test('a healthy user template adds no warning', () => {
  // A copy of the shipped base template: the realistic healthy case, whatever
  // slots the shipped set keeps today.
  const dir = target({ 'cv-template.fine.html': readFileSync(join(ROOT, 'templates', 'cv-template.html'), 'utf-8') });

  const out = doctorJson(dir);

  assert.ok(!out.warnings.some((w) => w.includes('cv-template.fine.html')), JSON.stringify(out.warnings));
});

test('the audit is advisory: it does not turn onboarding on', () => {
  const dir = target({ 'cv-template.broken.html': '{{NAME}}' });

  assert.equal(doctorJson(dir).onboardingNeeded, doctorJson(target({})).onboardingNeeded);
});
