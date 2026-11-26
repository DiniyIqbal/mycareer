import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { deliverDueMessages } from "@/lib/messages/deliver";

/**
 * Message queue worker. Sends due emails: delayed automations (e.g. the 48h
 * rejection) and ones held back by quiet hours or a failed attempt.
 *
 * Call it every few minutes from a scheduler with
 *   Authorization: Bearer $CRON_SECRET
 * (Vercel Cron sends this header automatically when CRON_SECRET is set.)
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });

  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await deliverDueMessages();
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
