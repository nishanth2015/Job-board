// tests/render-lint.test.mjs — renderLint reports what generate-pdf.mjs drops
// silently (#5941): JavaScript is off and every request that is not file: or
// data: is aborted, so a template carrying either renders without it and says
// nothing. One positive and one negative case per rule; each negative is the
// rule's must-not-flag clause from the issue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { renderLint } from '../cv-templates.mjs';

const ROOT = join(import.meta.dirname, '..');
const dir = mkdtempSync(join(tmpdir(), 'render-lint-'));
let n = 0;
function lint(html) {
  const p = join(dir, `t${n++}.html`);
  writeFileSync(p, html);
  return renderLint(p);
}
const ids = (r) => r.findings.map((f) => f.id);

const CASES = [
  {
    id: 'script-element',
    hit: ['<body><script>fetch("x")</script></body>', '<SCRIPT src="a.js"></SCRIPT>'],
    miss: ['<p>Wrote a script for the pipeline</p>', '<noscript>Enable JS</noscript>', '<!-- <script>x</script> -->', '<img alt="<script>" src="a.png">'],
  },
  {
    id: 'embedded-content',
    hit: ['<iframe src="a.html"></iframe>', '<object data="a.pdf"></object>', '<embed src="a.svg">'],
    miss: ['<img src="a.png">', '<svg><rect/></svg>', '<img alt="<iframe>" src="a.png">'],
  },
  {
    id: 'event-handler-attribute',
    hit: ['<body onload="x()">', '<img src="a.png" onerror=x()>', '<a href="#" ONCLICK="x()">go</a>'],
    miss: ['<p title="once=twice">x</p>', '<div data-onclick="x">x</div>', '<p>onload= in text</p>'],
  },
  {
    id: 'script-url',
    hit: ['<a href="&#106;avascript:alert(1)">x</a>', '<a href="javascript&#58;alert(1)">x</a>', '<a href="javascript:alert(1)">x</a>', '<img src=" JavaScript:x()">', '<a href="data:text/html,<b>x</b>">x</a>'],
    miss: ['<img src="data:image/png;base64,AAAA">', '<style>@font-face{src:url("data:font/woff2;base64,AAAA")}</style>', '<a href="{{LINKEDIN_URL}}">x</a>'],
  },
  {
    id: 'meta-refresh',
    hit: ['<meta http-equiv="refresh" content="0;url=a.html">'],
    miss: ['<meta charset="utf-8">', '<meta name="viewport" content="width=device-width">'],
  },
  {
    id: 'remote-subresource',
    hit: [
      '<img src="https://example.com/a.png">',
      '<link rel="stylesheet" href="//fonts.example.com/a.css">',
      '<style>@import url("https://fonts.example.com/a.css");</style>',
      '<style>@import "https://fonts.example.com/a.css";</style>',
      '<style>body{background:url(http://example.com/a.png)}</style>',
      '<div style="background:url(\'https://example.com/a.png\')"></div>',
      '<img alt="src=photo.png" src="https://example.com/a.png">',
      '<img src="https&#58;//example.com/a.png">',
      '<img src="&#104;ttps://example.com/a.png">',
      '<div style="background:url(&quot;https://example.com/a.png&quot;)"></div>',
      '<STYLE>body{background:URL(https://example.com/a.png)}</STYLE>',
      '<img srcset="photo.png 1x, https://example.com/photo.png 2x">',
    ],
    miss: [
      '<a href="https://example.com/me">me</a>',
      '<img src="{{PHOTO}}">',
      '<img src="photo.png">',
      '<link rel="stylesheet" href="fonts/a.css">',
      '<style>@font-face{src:url("./fonts/a.woff2")}</style>',
      '<style>/* url(https://example.com/a.png) */ body{}</style>',
      '<img alt="src=https://example.com/a.png" src="photo.png">',
      '<img srcset="photo.png 1x, photo-2x.png 2x">',
      '<title>url(https://example.com/a.png)</title>',
      '<img alt="<style>body{background:url(https://example.com/a.png)}</style>" src="a.png">',
      '<p>Docs: url(https://example.com/a.png) and @import "https://example.com/a.css"</p>',
    ],
  },
];

for (const { id, hit, miss } of CASES) {
  test(`${id}: flags the construct`, () => {
    for (const html of hit) assert.ok(ids(lint(html)).includes(id), `expected ${id} for: ${html}`);
  });
  test(`${id}: stays quiet on what it must not flag`, () => {
    for (const html of miss) assert.ok(!ids(lint(html)).includes(id), `unexpected ${id} for: ${html}`);
  });
}

test('every finding is a warning with a rule text and a detail', () => {
  const r = lint('<script>x</script>');
  assert.equal(r.ok, false);
  assert.equal(r.error, null);
  for (const f of r.findings) {
    assert.equal(f.severity, 'warning');
    assert.ok(f.rule && f.detail);
  }
});

test('a clean template reports ok', () => {
  const r = lint('<html><head><meta charset="utf-8"><style>body{color:#000}</style></head><body><h1>{{NAME}}</h1></body></html>');
  assert.deepEqual(r.findings, []);
  assert.equal(r.ok, true);
});

test('an unreadable path is reported, never thrown', () => {
  const r = renderLint(join(dir, 'missing.html'));
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

test('lint --render runs the render check and exits 0 on findings', () => {
  const out = execFileSync('node', ['cv-templates.mjs', 'lint', 'cv', 'standard', '--render'], { cwd: ROOT, encoding: 'utf-8' });
  const parsed = JSON.parse(out);
  assert.ok(Array.isArray(parsed.findings));
  assert.equal(parsed.ok, true);
});

// Tracked files only: listTemplates() also walks templates/<pack>/ and any
// template the developer added, so a local install could fail this test.
function trackedTemplates() {
  try {
    return execFileSync('git', ['ls-files', '-z', 'templates'], { cwd: ROOT, encoding: 'utf-8' })
      .split('\0').filter((f) => f.endsWith('.html')).map((f) => join(ROOT, f));
  } catch {
    return null;
  }
}

test('the shipped templates are clean', (t) => {
  const shipped = trackedTemplates();
  if (!shipped) return t.skip('git is unavailable, so the tracked template set cannot be read');
  assert.ok(shipped.length >= 8, `expected the shipped template set, found ${shipped.length}`);
  for (const path of shipped) {
    const r = renderLint(path);
    assert.deepEqual(r.findings, [], `${path}: ${JSON.stringify(r.findings)}`);
    assert.equal(r.error, null);
  }
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
