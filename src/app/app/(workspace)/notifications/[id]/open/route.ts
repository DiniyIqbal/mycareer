import { NextResponse, type NextRequest } from "next/server";
import { getMembership } from "@/lib/auth/membership";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Marks a notification read and opens what it points at. RLS: own only. */
export async function GET(request: NextRequest, ctx: RouteContext<"/app/notifications/[id]/open">) {
  const { id } = await ctx.params;
  const fallback = new URL("/app/notifications", request.url);
  if (!UUID.test(id) || !(await getMembership())) return NextResponse.redirect(fallback, 303);

  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .select("payload")
    .maybeSingle();
  const p = (data?.payload ?? {}) as { candidate_id?: string; application_id?: string; job_id?: string; request_id?: string };
  if (p.request_id && UUID.test(p.request_id)) {
    return NextResponse.redirect(new URL(`/app/requests/${p.request_id}`, request.url), 303);
  }
  if (!p.candidate_id && p.job_id && UUID.test(p.job_id)) {
    return NextResponse.redirect(new URL(`/app/jobs/${p.job_id}/pipeline`, request.url), 303);
  }
  if (!p.candidate_id || !UUID.test(p.candidate_id)) return NextResponse.redirect(fallback, 303);

  const anchor = p.application_id && UUID.test(p.application_id) ? `#application-${p.application_id}` : "";
  return NextResponse.redirect(new URL(`/app/candidates/${p.candidate_id}${anchor}`, request.url), 303);
}
