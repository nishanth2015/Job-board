// tests/scan-recheck-policy-siblings.test.mjs — every scanner applies the
// scan_history.recheck_after_days window scan.mjs applies.
//
// portals.yml's `scan_history.recheck_after_days` lets an `added` (or
// `skipped_expired`) URL become eligible again after N days, for roles that
// reopen at the same URL. scan.mjs builds its seen set with that policy. The
// admission gate (scan-interamt, scan-hn, openrouter-runner, plugin ingest),
// scan-dayforce and scan-ats-full called loadSeenUrls() with no policy, which
// reads as "dedup forever", so the same portals.yml gave two verdicts: scan.mjs
// let the URL back in and every other writer refused it. The gate exists to
// stop exactly that (#5478).
//
// The gate runs in a child process because discovered suites share one process
// (and one module cache) with the rest of test-all, so scan.mjs may already be
// imported with its real data paths baked in.
import { pass, fail, NODE, ROOT } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, relative, sep } from 'path';
import { pathToFileURL } from 'url';
import { tmpdir } from 'os';
import { localToday } from '../lib/local-today.mjs';
import { trackedFiles } from '../lib/mjs-files.mjs';

console.log('\nscan_history.recheck_after_days — the gate and the sibling scanners apply it too');

const daysAgo = (n) => {
  const d = new Date(`${localToday()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

const root = mkdtempSync(join(tmpdir(), 'career-ops-recheck-siblings-'));
mkdirSync(join(root, 'data'), { recursive: true });
const OLD = 'https://boards.greenhouse.io/acme/jobs/1001';
const FRESH = 'https://boards.greenhouse.io/acme/jobs/1002';
writeFileSync(join(root, 'data', 'scan-history.tsv'), [
  'url\tfirst_seen\tportal\ttitle\tcompany\tstatus',
  `${OLD}\t${daysAgo(60)}\tgreenhouse\tEngineer\tAcme\tadded`,
  `${FRESH}\t${daysAgo(5)}\tgreenhouse\tEngineer\tAcme\tadded`,
  '',
].join('\n'));

// The configs and URLs come from a JSON file read at run time, never spliced
// into the evaluated source.
const probeSource = `
  const { readFileSync } = await import('node:fs');
  const [scanUrl, gateUrl, jobFile] = process.argv.slice(-3);
  const scan = await import(scanUrl);
  const { createAdmissionGate } = await import(gateUrl);
  const { configs, urls } = JSON.parse(readFileSync(jobFile, 'utf8'));
  const out = {};
  for (const [name, config] of Object.entries(configs)) {
    const gate = createAdmissionGate({ config, titleFilter: () => true, locationFilter: () => true, blacklist: new Map() });
    const scanSeen = scan.loadSeenUrls(scan.scanHistoryPolicy(config)).seen;
    out[name] = urls.map((url) => ({
      url,
      gate: gate.check({ url, company: 'Acme', title: 'Engineer', location: 'Remote' }),
      scanSeen: scanSeen.has(scan.normalizeUrlForDedup(url)),
    }));
  }
  process.stdout.write(JSON.stringify(out));
`;

try {
  const jobFile = join(root, 'job.json');
  writeFileSync(jobFile, JSON.stringify({
    configs: { recheck30: { scan_history: { recheck_after_days: 30 } }, none: {} },
    urls: [OLD, FRESH],
  }));
  const out = JSON.parse(execFileSync(NODE, [
    '--input-type=module', '-e', probeSource,
    pathToFileURL(join(ROOT, 'scan.mjs')).href,
    pathToFileURL(join(ROOT, 'lib', 'admission-gate.mjs')).href,
    jobFile,
  ], { env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '' }, encoding: 'utf8' }));

  const [oldRecheck, freshRecheck] = out.recheck30;
  const [oldNone, freshNone] = out.none;

  // Premise: scan.mjs itself releases the 60-day-old row and keeps the 5-day one.
  if (oldRecheck.scanSeen === false && freshRecheck.scanSeen === true) {
    pass('premise: scan.mjs releases a 60-day-old added row under a 30-day window and keeps a 5-day-old one');
  } else {
    fail(`premise broken — scan.mjs verdicts: ${JSON.stringify(out.recheck30)}`);
  }

  if (oldRecheck.gate === null && freshRecheck.gate === 'seen') {
    pass('the admission gate admits the row the window released and still refuses the one inside it');
  } else {
    fail(`gate ignores scan_history.recheck_after_days: ${JSON.stringify(out.recheck30)}`);
  }

  if (oldNone.gate === 'seen' && freshNone.gate === 'seen' && oldNone.scanSeen && freshNone.scanSeen) {
    pass('with no recheck window, the gate and scan.mjs both dedup forever, as before');
  } else {
    fail(`no-policy verdicts changed: ${JSON.stringify(out.none)}`);
  }
} catch (err) {
  fail(`admission-gate recheck probe crashed: ${err.message}`);
}

// scan-dayforce builds its own seen set: loadConfig hands back the policy.
try {
  const { loadConfig } = await import(pathToFileURL(join(ROOT, 'scan-dayforce.mjs')).href);
  const portals = join(root, 'portals.yml');
  writeFileSync(portals, 'scan_history:\n  recheck_after_days: 30\ndayforce_boards: []\n');
  const withWindow = loadConfig(portals).historyPolicy;
  writeFileSync(portals, 'dayforce_boards: []\n');
  const without = loadConfig(portals).historyPolicy;
  if (withWindow?.recheckAfterDays === 30 && without?.recheckAfterDays === null) {
    pass('scan-dayforce loadConfig carries the recheck window to its seen set');
  } else {
    fail(`scan-dayforce loadConfig historyPolicy wrong: ${JSON.stringify({ withWindow, without })}`);
  }
} catch (err) {
  fail(`scan-dayforce loadConfig probe crashed: ${err.message}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

// Census: a seen set built with no policy dedups forever, whatever portals.yml
// says. Every loadSeenUrls call outside the tests has to pass one.
const BARE = /(?<!function )\bloadSeenUrls\(\s*(?:\)|\{\s*\})/;
const offenders = [];
let calls = 0;
for (const abs of trackedFiles(ROOT, (rel) => /\.(?:mjs|ts)$/.test(rel) && !rel.startsWith('tests/') && !rel.startsWith('web/tests/') && rel !== 'test-all.mjs')) {
  const rel = relative(ROOT, abs).split(sep).join('/');
  const lines = readFileSync(abs, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/^\s*(?:\/\/|\/\*|\*)/.test(line)) return;
    if (/(?<!function )\bloadSeenUrls\(/.test(line)) calls++;
    if (BARE.test(line)) offenders.push(`${rel}:${i + 1}`);
  });
}
if (calls >= 3 && offenders.length === 0) {
  pass(`all ${calls} loadSeenUrls calls outside the tests pass a recheck policy`);
} else {
  fail(`loadSeenUrls built with no policy (dedups forever, ignoring scan_history.recheck_after_days): ${JSON.stringify(offenders)} of ${calls} calls`);
}
