import { NextResponse, type NextRequest } from "next/server";
import { buildCandidateExport } from "@/lib/privacy/export";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken, isTokenShaped } from "@/lib/tokens";

/**
 * The candidate's copy of their data (AP-05), from the link HR emailed them.
 * Valid for 7 days; every download is audited.
 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/careers/[org]/privacy/export/[token]">) {
  const { token } = await ctx.params;
  const gone = () => new NextResponse("This download link is not valid or has expired. Please make a new request.", {
    status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
  if (!isTokenShaped(token)) return gone();

  const db = createAdminClient();
  const { data: req } = await db.from("data_requests")
    .select("id, org_id, candidate_id, export_expires_at")
    .eq("export_token_hash", hashToken(token)).maybeSingle();
  if (!req?.candidate_id || !req.export_expires_at || Date.parse(req.export_expires_at) < Date.now()) return gone();

  const data = await buildCandidateExport(req.org_id, req.candidate_id);
  if (!data) return gone();
  await db.from("audit_log").insert({ org_id: req.org_id, actor_id: null, action: "data_request.download",
    entity: "data_request", entity_id: req.id });

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="my-data-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}
