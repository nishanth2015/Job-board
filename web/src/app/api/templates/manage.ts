import { NextResponse } from "next/server";
import { careerOpsRoot } from "@/lib/career-ops";
import { resolveCodeRoot } from "@/lib/core/code-root.mjs";
import { getProfilePath } from "@/lib/core/profile-path.mjs";
import { readJsonObject } from "@/lib/json-body";
import { parseKind, userTemplatesDir } from "@/lib/template-gallery.mjs";

// What the three manage routes (duplicate, rename, delete) share: the body, the
// kind, and the three locations. The core scripts live in the engine checkout; the
// profile and the user's templates live in the data root.
export type ManageContext = {
  kind: "cv" | "cover";
  body: Record<string, unknown>;
  codeRoot: string;
  userDir: string;
  profilePath: string;
  dataRoot: string;
};

export async function manageContext(req: Request): Promise<ManageContext | NextResponse> {
  const body = await readJsonObject(req);
  if (!body) return NextResponse.json({ error: "bad json" }, { status: 400 });
  const kind = parseKind(body.kind ?? "cv");
  if (!kind) return NextResponse.json({ error: "kind must be cv or cover" }, { status: 400 });
  const dataRoot = careerOpsRoot();
  return {
    kind,
    body,
    codeRoot: resolveCodeRoot(process.cwd(), process.env),
    userDir: userTemplatesDir(dataRoot),
    profilePath: getProfilePath(dataRoot),
    dataRoot,
  };
}

/** A name a request carries, or "" when it is missing or not text. */
export const text = (v: unknown) => (typeof v === "string" ? v : "");

/** Our own refusals are the caller's to fix (422, or 404 for a missing name); anything else is a 500. */
export function failure(e: unknown): NextResponse {
  const message = e instanceof Error ? e.message : "could not complete that";
  const known = /not found|already|your own|default|name must|sections|placeholders|too large|NUL|changed since|missing/i.test(message);
  const status = /not found/i.test(message) ? 404 : /changed since/i.test(message) ? 409 : known ? 422 : 500;
  return NextResponse.json({ error: message }, { status });
}
