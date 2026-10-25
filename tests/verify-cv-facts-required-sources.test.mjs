/** Required fact sources must be checked and consumed from the same read. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyFacts } from '../verify-cv-facts.mjs';
import { pass, fail } from './helpers.mjs';

console.log('\nRequired primary sources for the CV fact gate');

const directory = fs.mkdtempSync(join(tmpdir(), 'career-ops-required-facts-'));
const source = join(directory, 'cv.md');
const config = join(directory, 'cv-facts.json');
const options = { sourcePaths: [source], requiredSourcePaths: [source], configPath: config };

function check(label, run) {
  try { run(); pass(label); }
  catch (error) { fail(`${label}: ${error.stack || error.message}`); }
}

try {
  fs.writeFileSync(config, JSON.stringify({ allow_metrics: [], allow_facts: [], forbidden_phrases: [], warn_phrases: [] }));

  check('a missing required source rejects even a document without metric claims', () => {
    assert.throws(() => verifyFacts('Maintained alert rules.', options), /Required fact source is not readable:/);
  });

  for (const [label, content] of [['empty', ''], ['whitespace-only', '\n \t\r\n']]) {
    check(`${label} required sources reject instead of running an empty-source check`, () => {
      fs.writeFileSync(source, content);
      assert.throws(() => verifyFacts('Maintained alert rules.', options), /Required fact source is empty:/);
    });
  }

  const latexSource = join(directory, 'cv.tex');
  const latexOptions = { ...options, sourcePaths: [latexSource], requiredSourcePaths: [latexSource] };
  for (const [label, body] of [
    ['empty', ''],
    ['whitespace-only', '\n \t\r\n'],
    ['comment-only', '\n% Managed 20 people.\n  % Maintained alert rules.\n'],
  ]) {
    check(`${label} extracted LaTeX bodies reject a claim-free target when required`, () => {
      fs.writeFileSync(latexSource, `\\documentclass{article}\n\\begin{document}${body}\\end{document}\n`);
      assert.throws(() => verifyFacts('Maintained alert rules.', latexOptions), /Required fact source is empty:/);
    });
  }

  check('a nonempty required LaTeX body still supports its actual metric', () => {
    fs.writeFileSync(latexSource, String.raw`\documentclass{article}
\newcommand{\oldTeam}{Managed 999 people.}
\begin{document}
% Managed 777 people.
Managed 20 people.
\end{document}
`);
    const result = verifyFacts('Managed 20 people.', latexOptions);
    assert.equal(result.verdict, 'pass');
    assert.deepEqual(result.invented, []);
  });

  check('required LaTeX sources still exclude preamble and comment metrics from evidence', () => {
    const result = verifyFacts('Managed 999 people. Managed 777 people.', latexOptions);
    assert.equal(result.verdict, 'block');
    assert.deepEqual(result.invented.sort(), ['777 people', '999 people']);
  });

  check('requiring a source does not silently add it to the evidence list', () => {
    fs.writeFileSync(source, '- Managed 20 people.\n');
    assert.throws(() => verifyFacts('Managed 20 people.', { ...options, sourcePaths: [] }), /Required fact source not included:/);
  });

  check('a readable required source supports its actual metric', () => {
    const result = verifyFacts('Managed 20 people.', options);
    assert.equal(result.verdict, 'pass');
    assert.deepEqual(result.invented, []);
  });

  check('a readable required source does not authorize an inflated metric', () => {
    const result = verifyFacts('Managed 999 people.', options);
    assert.equal(result.verdict, 'block');
    assert.deepEqual(result.invented, ['999 people']);
  });

  check('relative source paths and absolute requirements resolve to the same file', () => {
    const result = verifyFacts('Managed 20 people.', { ...options, sourcePaths: ['cv.md'], cwd: directory });
    assert.equal(result.verdict, 'pass');
  });

  for (const [target, verdict] of [['Managed 20 people.', 'pass'], ['Managed 999 people.', 'block']]) {
    check(`a source deleted immediately after its single read still yields the snapshot's ${verdict} verdict`, () => {
      fs.writeFileSync(source, '- Managed 20 people.\n');
      const originalRead = fs.readFileSync;
      const originalExists = fs.existsSync;
      let reads = 0;
      try {
        fs.existsSync = function(path) {
          if (path === source) throw new Error('A required source must be read directly, without an existence precheck.');
          return originalExists.call(this, path);
        };
        fs.readFileSync = function(path, ...args) {
          if (path === source) reads++;
          const contents = originalRead.call(this, path, ...args);
          if (path === source) fs.unlinkSync(source);
          return contents;
        };
        syncBuiltinESMExports();

        const result = verifyFacts(target, options);
        assert.equal(result.verdict, verdict);
        assert.equal(reads, 1, 'claim extraction must use the read that satisfied the requirement');
        assert.equal(originalExists(source), false);
        assert.deepEqual(result.invented, verdict === 'block' ? ['999 people'] : []);
      } finally {
        fs.readFileSync = originalRead;
        fs.existsSync = originalExists;
        syncBuiltinESMExports();
      }
    });
  }

  check('missing optional sources retain the default no-metric behavior', () => {
    fs.rmSync(source, { force: true });
    const result = verifyFacts('Maintained alert rules.', { sourcePaths: [source], configPath: config });
    assert.equal(result.verdict, 'pass');
    assert.deepEqual(result.invented, []);
  });

  check('missing optional sources still block unsupported metrics without throwing', () => {
    fs.rmSync(source, { force: true });
    const result = verifyFacts('Managed 20 people.', { sourcePaths: [source], configPath: config });
    assert.equal(result.verdict, 'block');
    assert.deepEqual(result.invented, ['20 people']);
  });
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
