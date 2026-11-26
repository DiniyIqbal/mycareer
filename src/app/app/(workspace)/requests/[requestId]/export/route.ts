import { NextResponse, type NextRequest } from "next/server";
import { writeAudit } from "@/lib/audit";
import { getMembership, isHr } from "@/lib/auth/membership";
import { buildCandidateExport } from "@/lib/privacy/export";
import { createClient } from "@/lib/supabase/server";

/** HR preview of the file a candidate would receive. Audited like a resume view. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/app/requests/[requestId]/export">) {
  const { requestId } = await ctx.params;
  const m = await getMembership();
  const notFound = new NextResponse("Not found.", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!m || !isHr(m) || !/^[0-9a-f-]{36}$/i.test(requestId)) return notFound;

  const supabase = await createClient();
  const { data: r } = await supabase.from("data_requests").select("id, candidate_id")
    .eq("id", requestId).eq("org_id", m.orgId).maybeSingle();
  if (!r?.candidate_id) return notFound;
  const data = await buildCandidateExport(m.orgId, r.candidate_id);
  if (!data) return notFound;

  await writeAudit({ orgId: m.orgId, actorId: m.userId, action: "data_request.preview", entity: "data_request", entityId: r.id });
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="candidate-data-${r.id.slice(0, 8)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
