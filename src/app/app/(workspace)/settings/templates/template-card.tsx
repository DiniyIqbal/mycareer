"use client";

import { useId, useState, useTransition } from "react";
import { renderTemplate } from "@/lib/email/render";
import { BODY_MAX, LOCALES, SUBJECT_MAX, unknownVariables, type Locale } from "@/lib/messages/templates";
import { removeTranslation, saveAutomation, saveTemplate, sendTestEmail, type TemplateResult } from "./actions";

type Version = { subject: string | null; body: string } | null;

export type TemplateCardProps = {
  templateKey: "application_received" | "interview_invite" | "offer_pending" | "rejected";
  label: string;
  when: string;
  automation: { active: boolean; delayHours: number } | null;
  versions: Record<Locale, Version>;
  sample: Record<string, string>;
};

export function TemplateCard({ templateKey, label, when, automation, versions, sample }: TemplateCardProps) {
  const [locale, setLocale] = useState<Locale>("en");
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-zinc-200 dark:border-zinc-800">
      <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <h2 id={headingId} className="font-semibold">{label}</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{when}</p>
        {automation && <AutomationControls templateKey={templateKey} initial={automation} />}
      </div>
      <div className="px-5 py-4">
        <div role="tablist" aria-label={`${label} language`} className="mb-4 flex gap-2">
          {LOCALES.map((l) => (
            <button key={l.code} role="tab" type="button" aria-selected={locale === l.code}
              onClick={() => setLocale(l.code)}
              className="rounded-full border border-zinc-300 px-3 py-1 text-sm aria-selected:border-zinc-900 aria-selected:bg-zinc-900 aria-selected:text-white dark:border-zinc-700 dark:aria-selected:border-white dark:aria-selected:bg-white dark:aria-selected:text-zinc-900">
              {l.label}{!versions[l.code] && " (not set)"}
            </button>
          ))}
        </div>
        {/* key: switching language starts from that version's saved text. */}
        <Editor key={locale} templateKey={templateKey} locale={locale} version={versions[locale]}
          fallback={locale === "ms" ? versions.en : null} sample={sample} />
      </div>
    </section>
  );
}

function Editor({ templateKey, locale, version, fallback, sample }: {
  templateKey: TemplateCardProps["templateKey"];
  locale: Locale;
  version: Version;
  fallback: Version;
  sample: Record<string, string>;
}) {
  const id = useId();
  const [subject, setSubject] = useState(version?.subject ?? "");
  const [body, setBody] = useState(version?.body ?? "");
  const [result, setResult] = useState<TemplateResult | null>(null);
  const [pending, start] = useTransition();
  const unknown = unknownVariables(`${subject}\n${body}`);
  const dirty = subject !== (version?.subject ?? "") || body !== (version?.body ?? "");

  const run = (fn: () => Promise<TemplateResult>) => start(async () => setResult(await fn()));
  const input = { key: templateKey, locale, subject, body };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-3">
        {!version && locale === "ms" && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            No Malay version yet, so Malay-speaking candidates get the English one.
            {fallback && (
              <button type="button" className="ml-1 underline"
                onClick={() => { setSubject(fallback.subject ?? ""); setBody(fallback.body); }}>
                Start from the English text
              </button>
            )}
          </p>
        )}
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Subject</span>
          <input id={`${id}-subject`} value={subject} maxLength={SUBJECT_MAX} onChange={(e) => setSubject(e.target.value)}
            className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Email</span>
          <textarea value={body} rows={10} maxLength={BODY_MAX} onChange={(e) => setBody(e.target.value)}
            className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-[13px] leading-6 dark:border-zinc-700 dark:bg-zinc-900" />
        </label>
        {unknown.length > 0 && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            Unknown placeholder {unknown.map((u) => `{{${u}}}`).join(", ")}. Check the spelling.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={pending || !dirty || unknown.length > 0}
            onClick={() => run(() => saveTemplate(input))}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900">
            {pending ? "Working…" : "Save"}
          </button>
          <button type="button" disabled={pending || !subject.trim() || !body.trim() || unknown.length > 0}
            onClick={() => run(() => sendTestEmail(input))} className="text-sm underline disabled:opacity-50">
            Send me a test
          </button>
          {locale === "ms" && version && (
            <button type="button" disabled={pending} className="text-sm text-red-700 underline dark:text-red-400"
              onClick={() => confirm("Remove the Malay version? Malay-speaking candidates will get the English email.")
                && run(() => removeTranslation({ key: templateKey }))}>
              Remove Malay version
            </button>
          )}
          {result && (
            <span role={result.ok ? "status" : "alert"}
              className={`text-sm ${result.ok ? "text-green-700 dark:text-green-500" : "text-red-700 dark:text-red-400"}`}>
              {result.ok ? result.message : result.error}
            </span>
          )}
        </div>
      </div>

      <div>
        <p className="mb-1 text-sm font-medium">Preview <span className="font-normal text-zinc-500">(sample candidate)</span></p>
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900/50">
          <p className="border-b border-zinc-200 pb-2 font-medium dark:border-zinc-800">
            {renderTemplate(subject, sample) || <span className="text-zinc-400">No subject</span>}
          </p>
          <p className="mt-3 whitespace-pre-line break-words leading-6">{renderTemplate(body, sample)}</p>
        </div>
      </div>
    </div>
  );
}

function AutomationControls({ templateKey, initial }: {
  templateKey: TemplateCardProps["templateKey"];
  initial: { active: boolean; delayHours: number };
}) {
  const [active, setActive] = useState(initial.active);
  const [delay, setDelay] = useState(String(initial.delayHours));
  const [result, setResult] = useState<TemplateResult | null>(null);
  const [pending, start] = useTransition();
  const delayNum = Number(delay);
  const valid = delay.trim() !== "" && Number.isInteger(delayNum) && delayNum >= 0 && delayNum <= 720;
  const dirty = active !== initial.active || delayNum !== initial.delayHours;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4" />
        Send automatically
      </label>
      <label className="flex items-center gap-2">
        <span>Wait</span>
        <input type="number" min={0} max={720} step={1} value={delay} disabled={!active}
          onChange={(e) => setDelay(e.target.value)} aria-invalid={!valid}
          className="w-20 rounded-md border border-zinc-300 bg-white px-2 py-1 disabled:opacity-50 aria-[invalid=true]:border-red-600 dark:border-zinc-700 dark:bg-zinc-900" />
        <span>hours after the move{delayNum === 0 && active ? " (immediately)" : ""}</span>
      </label>
      <button type="button" disabled={pending || !dirty || !valid}
        onClick={() => start(async () => setResult(await saveAutomation({ key: templateKey, active, delayHours: delayNum })))}
        className="rounded-md border border-zinc-300 px-3 py-1 font-medium disabled:opacity-50 dark:border-zinc-700">
        {pending ? "Saving…" : "Save"}
      </button>
      {!valid && <span className="text-red-700 dark:text-red-400">Use a whole number of hours, 0–720.</span>}
      {result && (
        <span role={result.ok ? "status" : "alert"}
          className={result.ok ? "text-green-700 dark:text-green-500" : "text-red-700 dark:text-red-400"}>
          {result.ok ? result.message : result.error}
        </span>
      )}
    </div>
  );
}
