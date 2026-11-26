import { NextResponse, type NextRequest } from "next/server";
import { checkCronAuth } from "@/lib/cron";
import { deliverDueMessages } from "@/lib/messages/deliver";

/**
 * Message queue worker. Sends due emails: delayed automations (e.g. the 48h
 * rejection) and ones held back by quiet hours or a failed attempt.
 * Run every few minutes with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: NextRequest) {
  const denied = checkCronAuth(request);
  if (denied) return denied;
  const result = await deliverDueMessages();
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
