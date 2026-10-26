// Duplicate, rename and delete of the user's own templates (#1692). Every case
// runs against the REAL core in this checkout and a scratch data/templates
// directory, because "does the copy still resolve" is the whole point and a
// stand-in resolver would only agree with itself.
//
// Run:  node --test tests/lib/template-files.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listTemplatesOfKind } from "../../src/lib/template-gallery.mjs";
import {
  duplicateTemplate,
  renameTemplate,
  deleteTemplate,
  isValidTemplateName,
} from "../../src/lib/template-files.mjs";

const CORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function scratch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "template-files-"));
  const userDir = path.join(root, "data", "templates");
  const profilePath = path.join(root, "profile.yml");
  return { root, userDir, profilePath };
}

const names = async (s, kind = "cv") =>
  (await listTemplatesOfKind(CORE, kind, { profilePath: s.profilePath, userDir: s.userDir })).templates;

test("template names are lowercase words joined by single hyphens, and never the base", () => {
  for (const ok of ["mine", "my-cv", "v2", "a1-b2"]) assert.ok(isValidTemplateName(ok), ok);
  for (const bad of ["", "Mine", "my cv", "a--b", "-a", "a-", "../x", "a/b", "a.b", "standard", "x".repeat(41)]) {
    assert.ok(!isValidTemplateName(bad), JSON.stringify(bad));
  }
});

test("duplicating a shipped template writes a user copy that lists and resolves", async () => {
  const s = scratch();

  await duplicateTemplate(CORE, { kind: "cv", from: "modern", name: "my-modern", userDir: s.userDir });

  const mine = (await names(s)).find((t) => t.name === "my-modern");
  assert.equal(mine?.layer, "user");
  assert.ok(fs.existsSync(path.join(s.userDir, "cv-template.my-modern.html")));
});

test("duplicating a pack carries its sections, so the copy still resolves", async () => {
  const s = scratch();

  await duplicateTemplate(CORE, { kind: "cv", from: "ats", name: "my-ats", userDir: s.userDir });

  assert.ok(fs.existsSync(path.join(s.userDir, "my-ats", "cv-template.my-ats.html")));
  assert.ok(fs.existsSync(path.join(s.userDir, "my-ats", "sections", "experience.html")));
  assert.equal((await names(s)).find((t) => t.name === "my-ats")?.layer, "user");
});

test("a duplicate of a flat template that declares sections is refused loudly, not left broken", async () => {
  const s = scratch();
  fs.mkdirSync(s.userDir, { recursive: true });
  fs.writeFileSync(
    path.join(s.userDir, "cv-template.declares.html"),
    "<!-- career-ops-template\nname: D\nsections: all\n-->{{NAME}}{{EXPERIENCE}}{{EDUCATION}}",
  );

  await assert.rejects(
    duplicateTemplate(CORE, { kind: "cv", from: "declares", name: "copy-of-it", userDir: s.userDir }),
    /sections/i,
  );
  assert.ok(!fs.existsSync(path.join(s.userDir, "cv-template.copy-of-it.html")));
});

test("a cover-letter template can be duplicated too", async () => {
  const s = scratch();

  await duplicateTemplate(CORE, { kind: "cover", from: "standard", name: "warm", userDir: s.userDir });

  assert.ok(fs.existsSync(path.join(s.userDir, "cover-letter-template.warm.html")));
  assert.equal((await names(s, "cover")).find((t) => t.name === "warm")?.layer, "user");
});

test("duplicate refuses a bad name, an existing name, and an unknown source", async () => {
  const s = scratch();
  await duplicateTemplate(CORE, { kind: "cv", from: "modern", name: "taken", userDir: s.userDir });

  await assert.rejects(duplicateTemplate(CORE, { kind: "cv", from: "modern", name: "../x", userDir: s.userDir }), /name/i);
  await assert.rejects(duplicateTemplate(CORE, { kind: "cv", from: "modern", name: "taken", userDir: s.userDir }), /already/i);
  await assert.rejects(duplicateTemplate(CORE, { kind: "cv", from: "modern", name: "compact", userDir: s.userDir }), /already/i);
  await assert.rejects(duplicateTemplate(CORE, { kind: "cv", from: "nope", name: "fresh", userDir: s.userDir }), /not found/i);
});

test("renaming a user template moves its file and keeps it resolvable", async () => {
  const s = scratch();
  await duplicateTemplate(CORE, { kind: "cv", from: "modern", name: "before", userDir: s.userDir });

  await renameTemplate(CORE, { kind: "cv", name: "before", to: "after", userDir: s.userDir, profilePath: s.profilePath });

  const listed = (await names(s)).map((t) => t.name);
  assert.ok(listed.includes("after") && !listed.includes("before"));
});

test("a shipped template cannot be renamed, and a rename cannot land on an existing name", async () => {
  const s = scratch();
  await duplicateTemplate(CORE, { kind: "cv", from: "modern", name: "mine", userDir: s.userDir });

  await assert.rejects(renameTemplate(CORE, { kind: "cv", name: "compact", to: "x1", userDir: s.userDir, profilePath: s.profilePath }), /your own|user/i);
  await assert.rejects(renameTemplate(CORE, { kind: "cv", name: "mine", to: "compact", userDir: s.userDir, profilePath: s.profilePath }), /already/i);
});

test("deleting a user template removes it, and a pack's directory goes with its only template", async () => {
  const s = scratch();
  await duplicateTemplate(CORE, { kind: "cv", from: "modern", name: "flat-one", userDir: s.userDir });
  await duplicateTemplate(CORE, { kind: "cv", from: "ats", name: "pack-one", userDir: s.userDir });

  await deleteTemplate(CORE, { kind: "cv", name: "flat-one", userDir: s.userDir, profilePath: s.profilePath });
  await deleteTemplate(CORE, { kind: "cv", name: "pack-one", userDir: s.userDir, profilePath: s.profilePath });

  assert.ok(!fs.existsSync(path.join(s.userDir, "cv-template.flat-one.html")));
  assert.ok(!fs.existsSync(path.join(s.userDir, "pack-one")));
  assert.ok(!(await names(s)).some((t) => ["flat-one", "pack-one"].includes(t.name)));
});

test("a shipped template cannot be deleted", async () => {
  const s = scratch();

  await assert.rejects(deleteTemplate(CORE, { kind: "cv", name: "modern", userDir: s.userDir, profilePath: s.profilePath }), /your own|user/i);
});

test("the template the profile names as default cannot be deleted", async () => {
  const s = scratch();
  await duplicateTemplate(CORE, { kind: "cv", from: "modern", name: "favorite", userDir: s.userDir });
  fs.writeFileSync(s.profilePath, "cv:\n  template: favorite\n");

  await assert.rejects(deleteTemplate(CORE, { kind: "cv", name: "favorite", userDir: s.userDir, profilePath: s.profilePath }), /default/i);
  assert.ok(fs.existsSync(path.join(s.userDir, "cv-template.favorite.html")));
});

test("a duplicate's card is not named like its source", async () => {
  const s = scratch();

  await duplicateTemplate(CORE, { kind: "cv", from: "modern", name: "my-modern", userDir: s.userDir });

  const t = await names(s);
  assert.equal(t.find((x) => x.name === "modern").displayName, "Modern");
  assert.equal(t.find((x) => x.name === "my-modern").displayName, "My Modern");
});

test("renaming the default reports it, so the profile can follow", async () => {
  const s = scratch();
  await duplicateTemplate(CORE, { kind: "cv", from: "modern", name: "was-default", userDir: s.userDir });
  fs.writeFileSync(s.profilePath, "cv:\n  template: was-default\n");

  const out = await renameTemplate(CORE, { kind: "cv", name: "was-default", to: "now-default", userDir: s.userDir, profilePath: s.profilePath });

  assert.deepEqual(out, { wasDefault: true });
});
