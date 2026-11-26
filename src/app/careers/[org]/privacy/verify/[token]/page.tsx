import type { Metadata } from "next";
import { Suspense } from "react";
import { kindLabel } from "@/lib/privacy/requests";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashToken, isTokenShaped } from "@/lib/tokens";
import { ConfirmForm } from "./confirm-form";

export const metadata: Metadata = { title: "Confirm your request", robots: { index: false } };

type Props = PageProps<"/careers/[org]/privacy/verify/[token]">;

export default function VerifyPage(props: Props) {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-16">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Confirm your data request</h1>
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Verify params={props.params} />
      </Suspense>
    </main>
  );
}

async function Verify({ params }: Pick<Props, "params">) {
  const { org, token } = await params;
  const back = <a href={`/careers/${org}/privacy`} className="underline">make a new request</a>;
  if (!isTokenShaped(token)) return <p>This link is not valid. You can {back}.</p>;

  const { data: req } = await createAdminClient().from("data_requests")
    .select("email, kind, status, organisations!inner(slug)")
    .eq("token_hash", hashToken(token)).eq("organisations.slug", org).maybeSingle();
  if (!req) return <p>This link is not valid or has already been used. You can {back}.</p>;

  return <ConfirmForm token={token} kindLabel={kindLabel(req.kind)} email={req.email} />;
}
