import { NextResponse, type NextRequest } from "next/server";
import { writeAudit } from "@/lib/audit";
import { getMembership } from "@/lib/auth/membership";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNED_URL_SECONDS = 60;

/**
 * Opens a candidate's resume (HR-05, PRD §13). The bucket is private: access
 * is checked here through RLS (hiring managers only reach candidates on jobs
 * assigned to them), every view is written to the audit log, and the browser
 * is sent to a signed URL that expires after a minute. The file is served from
 * the storage domain, not this app's origin, so a hostile file cannot run
 * script against the app.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<"/app/files/[fileId]">) {
  const { fileId } = await ctx.params;
  if (!UUID.test(fileId)) return text("File not found.", 404);

  const membership = await getMembership();
  if (!membership) return text("File not found.", 404);

  const supabase = await createClient();
  const { data: file, error } = await supabase
    .from("candidate_files")
    .select("id, org_id, candidate_id, storage_path, original_name, mime_type, scan_status")
    .eq("id", fileId)
    .eq("org_id", membership.orgId)
    .maybeSingle();
  if (error) {
    console.error("[files] lookup failed:", error);
    return text("Something went wrong. Please try again.", 500);
  }
  if (!file) return text("File not found.", 404);
  if (file.scan_status === "infected") {
    return text("This file was flagged by the virus scan and cannot be opened.", 403);
  }

  const isPdf = file.mime_type === "application/pdf";
  const { data: signed, error: signError } = await createAdminClient()
    .storage.from("resumes")
    // PDFs open in the browser's viewer; Word files download.
    .createSignedUrl(file.storage_path, SIGNED_URL_SECONDS, { download: isPdf ? false : file.original_name });
  if (signError || !signed) {
    console.error("[files] signing failed:", signError);
    return text("The file could not be opened. Please try again.", 500);
  }

  await writeAudit({
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "resume.view",
    entity: "candidate_file",
    entityId: file.id,
    metadata: { candidate_id: file.candidate_id, scan_status: file.scan_status },
  });

  const response = NextResponse.redirect(signed.signedUrl, 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

function text(message: string, status: number) {
  return new NextResponse(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
