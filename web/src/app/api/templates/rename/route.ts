import { NextResponse } from "next/server";
import fs from "node:fs";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { profileWithTemplate } from "@/lib/template-gallery.mjs";
import { renameTemplate } from "@/lib/template-files.mjs";
import { failure, manageContext, text } from "../manage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rename one of your own templates. When it was the default, the profile's
// template key follows it, so the rename does not silently send CVs back to the
// base template.
export async function POST(req: Request) {
  const ctx = await manageContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const to = text(ctx.body.to);
  try {
    const { wasDefault } = await renameTemplate(ctx.codeRoot, { kind: ctx.kind, name: text(ctx.body.name), to, userDir: ctx.userDir, profilePath: ctx.profilePath });
    if (wasDefault) {
      try {
        atomicWriteWithBackup(ctx.profilePath, profileWithTemplate(fs.readFileSync(ctx.profilePath, "utf8"), ctx.kind, to));
      } catch (e) {
        // The file is already renamed, so say so: a bare failure would read as "nothing happened".
        const why = e instanceof Error ? e.message : "write failed";
        return NextResponse.json({ error: `Renamed to "${to}", but the profile still names the old template: ${why}` }, { status: 409 });
      }
    }
    return NextResponse.json({ ok: true, name: to, wasDefault });
  } catch (e) {
    return failure(e);
  }
}
