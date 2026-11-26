import { NextResponse, type NextRequest } from "next/server";
import { checkCronAuth } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Retention worker (privacy notice: data kept N months after the role
 * closes). Deletes overdue candidates in the database, then their resume
 * files. Run daily with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: NextRequest) {
  const denied = checkCronAuth(request);
  if (denied) return denied;

  const db = createAdminClient();
  const { data, error } = await db.rpc("purge_expired_candidates", { p_limit: 500 });
  if (error) {
    console.error("[retention] purge failed:", error);
    return NextResponse.json({ error: "Purge failed" }, { status: 500 });
  }
  const rows = (data ?? []) as { org_id: string; candidate_id: string; paths: string[] }[];
  const paths = rows.flatMap((r) => r.paths ?? []);
  let filesFailed = 0;
  // Storage accepts up to 1000 paths per call.
  for (let i = 0; i < paths.length; i += 1000) {
    const { error: storageError } = await db.storage.from("resumes").remove(paths.slice(i, i + 1000));
    if (storageError) {
      filesFailed += Math.min(1000, paths.length - i);
      console.error("[retention] file removal failed (records already deleted):", storageError);
    }
  }
  return NextResponse.json(
    { candidatesDeleted: rows.length, filesDeleted: paths.length - filesFailed, filesFailed, more: rows.length === 500 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
