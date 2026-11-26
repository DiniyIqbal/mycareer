import { redirect } from "next/navigation";
import { Suspense } from "react";
import { isHr, requireMembership } from "@/lib/auth/membership";
import { sampleVariables, SYSTEM_TEMPLATES, TEMPLATE_VARIABLES } from "@/lib/messages/templates";
import { createClient } from "@/lib/supabase/server";
import { TemplateCard, type TemplateCardProps } from "./template-card";

export default function TemplatesPage() {
  return (
    <main className="max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">Email templates</h1>
      <p className="mb-6 mt-1 text-zinc-600 dark:text-zinc-400">
        The emails candidates receive. Changes apply to emails sent from now on, including ones already scheduled.
      </p>
      <Suspense fallback={<p className="text-zinc-500">Loading templates…</p>}>
        <Templates />
      </Suspense>
    </main>
  );
}

async function Templates() {
  const m = await requireMembership();
  if (!isHr(m)) redirect("/app");

  const supabase = await createClient();
  const [templates, rules] = await Promise.all([
    supabase.from("message_templates").select("key, locale, subject, body").eq("org_id", m.orgId).eq("channel", "email"),
    supabase.from("automation_rules").select("trigger_stage_kind, active, delay_minutes")
      .eq("org_id", m.orgId).is("job_id", null).eq("action", "send_template"),
  ]);
  if (templates.error) throw templates.error;
  if (rules.error) throw rules.error;

  const find = (key: string, locale: string) => templates.data?.find((t) => t.key === key && t.locale === locale) ?? null;

  return (
    <>
      <section aria-labelledby="vars" className="mb-6 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
        <h2 id="vars" className="font-medium">Placeholders</h2>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">Type these into a subject or email and they are filled in for each candidate:</p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {TEMPLATE_VARIABLES.map((v) => (
            <li key={v.name}><code className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">{`{{${v.name}}}`}</code></li>
          ))}
        </ul>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Candidates currently apply in English. Malay versions are used once Bahasa Melayu is added to the careers site;
          until a Malay version exists, the English one is sent.
        </p>
      </section>

      <div className="space-y-6">
        {SYSTEM_TEMPLATES.map((t) => {
          const rule = t.stageKind ? rules.data?.find((r) => r.trigger_stage_kind === t.stageKind) : null;
          const props: TemplateCardProps = {
            templateKey: t.key,
            label: t.label,
            when: t.when,
            automation: t.stageKind
              ? { active: rule?.active ?? false, delayHours: Math.round((rule?.delay_minutes ?? 0) / 60) }
              : null,
            versions: {
              en: find(t.key, "en"),
              ms: find(t.key, "ms"),
            },
            sample: sampleVariables(m.orgName),
          };
          return <TemplateCard key={t.key} {...props} />;
        })}
      </div>
    </>
  );
}
