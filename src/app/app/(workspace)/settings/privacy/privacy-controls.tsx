"use client";

import { useState, useTransition } from "react";
import { publishNotice, saveRetention, type PrivacyResult } from "./actions";

function Result({ result }: { result: PrivacyResult | null }) {
  if (!result) return null;
  return (
    <p role={result.ok ? "status" : "alert"}
      className={`text-sm ${result.ok ? "text-green-700 dark:text-green-500" : "text-red-700 dark:text-red-400"}`}>
      {result.ok ? result.message : result.error}
    </p>
  );
}

export function RetentionForm({ months }: { months: number }) {
  const [value, setValue] = useState(String(months));
  const [result, setResult] = useState<PrivacyResult | null>(null);
  const [pending, start] = useTransition();
  const n = Number(value);
  const valid = Number.isInteger(n) && n >= 1 && n <= 120;

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="retention-months">Keep data for</label>
        <input id="retention-months" type="number" min={1} max={120} value={value} aria-invalid={!valid}
          onChange={(e) => setValue(e.target.value)}
          className="w-20 rounded-md border border-zinc-300 bg-white px-2 py-1 aria-[invalid=true]:border-red-600 dark:border-zinc-700 dark:bg-zinc-900" />
        <span>months after the role closes</span>
        <button type="button" disabled={pending || !valid || n === months}
          onClick={() => {
            if (n < months && !confirm(`Shortening to ${n} months deletes anyone already past that at the next daily run. Continue?`)) return;
            start(async () => setResult(await saveRetention({ months: n })));
          }}
          className="rounded-md border border-zinc-300 px-3 py-1 font-medium disabled:opacity-50 dark:border-zinc-700">
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      <Result result={result} />
    </div>
  );
}

export function NoticeEditor({ locale, initial, meta, isDraft, readOnly }: {
  locale: "en" | "ms"; initial: string; meta: string; isDraft: boolean; readOnly: boolean;
}) {
  const [body, setBody] = useState(initial);
  const [result, setResult] = useState<PrivacyResult | null>(null);
  const [pending, start] = useTransition();
  const label = locale === "en" ? "English" : "Bahasa Melayu";

  return (
    <div className="space-y-2">
      <label className="block text-sm">
        <span className="font-medium">{label}</span> <span className="text-zinc-500">· {meta}</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} readOnly={readOnly} maxLength={10000}
          className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm leading-6 read-only:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:read-only:bg-zinc-900/50" />
      </label>
      {isDraft && body === initial && (
        <p className="text-sm text-amber-700 dark:text-amber-400">This is the placeholder text. Replace it with your reviewed notice before real candidates apply.</p>
      )}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={pending || body.trim() === initial.trim() || body.trim().length < 100}
            onClick={() => confirm(`Publish this ${label} notice? New applicants will agree to it.`) &&
              start(async () => setResult(await publishNotice({ locale, body })))}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900">
            {pending ? "Publishing…" : "Publish new version"}
          </button>
          <Result result={result} />
        </div>
      )}
    </div>
  );
}
