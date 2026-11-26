import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/app/login/actions";
import { isPast } from "@/lib/dates";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABEL, ROLE_DESCRIPTION } from "@/lib/team/roles";
import { hashInviteToken, isTokenShaped } from "@/lib/team/tokens";
import { AcceptButton } from "./accept-button";

export const metadata: Metadata = { title: "Team invitation · MyCareer", robots: { index: false } };

export default function InvitePage(props: PageProps<"/invite/[token]">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
      <Suspense fallback={<p className="text-zinc-500">Loading invitation…</p>}>
        <Invite params={props.params} />
      </Suspense>
    </main>
  );
}

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <h1 className="mb-3 text-2xl font-semibold tracking-tight">{title}</h1>
      <div className="space-y-3 text-zinc-700 dark:text-zinc-300">{children}</div>
    </>
  );
}

async function Invite({ params }: Pick<PageProps<"/invite/[token]">, "params">) {
  const { token } = await params;
  const invalid = (
    <Message title="Invitation not found">
      <p>This link is not valid or the invitation was cancelled. Ask your admin to send a new one.</p>
    </Message>
  );
  if (!isTokenShaped(token)) return invalid;

  // Visitors have no access to invitations; look it up by the token's hash.
  const { data: inv } = await createAdminClient()
    .from("invitations")
    .select("email, role, expires_at, accepted_at, revoked_at, organisations(name)")
    .eq("token_hash", hashInviteToken(token))
    .maybeSingle();
  if (!inv || inv.revoked_at) return invalid;

  const orgName = (inv.organisations as unknown as { name: string } | null)?.name ?? "the organisation";
  const role = inv.role as keyof typeof ROLE_LABEL;
  const here = `/invite/${token}`;

  if (inv.accepted_at) {
    return (
      <Message title="Invitation already used">
        <p>You can sign in to {orgName} with {inv.email}.</p>
        <Link href="/login?next=/app" className="inline-block underline">Sign in</Link>
      </Message>
    );
  }
  if (isPast(inv.expires_at)) {
    return (
      <Message title="Invitation expired">
        <p>Invitations last 7 days. Ask your admin at {orgName} to send a new one.</p>
      </Message>
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const intro = (
    <>
      <p>You have been invited to join <strong>{orgName}</strong> on MyCareer as <strong>{ROLE_LABEL[role]}</strong>.</p>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{ROLE_DESCRIPTION[role]}</p>
    </>
  );

  if (!user) {
    const q = `next=${encodeURIComponent(here)}&email=${encodeURIComponent(inv.email)}`;
    return (
      <Message title={`Join ${orgName}`}>
        {intro}
        <p>Continue with <strong>{inv.email}</strong>:</p>
        <div className="flex flex-col gap-3 pt-2 sm:flex-row">
          <Link href={`/login?${q}&mode=signup`}
            className="rounded-md bg-zinc-900 px-4 py-2 text-center font-medium text-white dark:bg-white dark:text-zinc-900">
            Create account
          </Link>
          <Link href={`/login?${q}`} className="rounded-md border border-zinc-300 px-4 py-2 text-center font-medium dark:border-zinc-700">
            I already have an account
          </Link>
        </div>
      </Message>
    );
  }

  if (user.email?.toLowerCase() !== inv.email) {
    return (
      <Message title="Different account">
        {intro}
        <p>
          This invitation is for <strong>{inv.email}</strong>, but you are signed in as <strong>{user.email}</strong>.
          Sign out, then open the link again.
        </p>
        <form action={signOut}><button className="underline">Sign out</button></form>
      </Message>
    );
  }

  return (
    <Message title={`Join ${orgName}`}>
      {intro}
      <AcceptButton token={token} />
    </Message>
  );
}
