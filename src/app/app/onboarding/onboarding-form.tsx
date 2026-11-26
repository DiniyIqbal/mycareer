"use client";

import { useActionState, useState } from "react";
import { createOrganisation, type OnboardingState } from "./actions";

const input = "w-full rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900";

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

export function OnboardingForm() {
  const [state, action, pending] = useActionState<OnboardingState, FormData>(createOrganisation, {});
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="name" className="text-sm font-medium">Organisation name</label>
        <input id="name" name="name" required className={input}
          onChange={(e) => { if (!slugEdited) setSlug(slugify(e.target.value)); }} />
      </div>
      <div className="space-y-1">
        <label htmlFor="slug" className="text-sm font-medium">Careers page address</label>
        <div className="flex items-center gap-1 text-sm text-zinc-500">
          <span>/careers/</span>
          <input id="slug" name="slug" required value={slug} className={input}
            onChange={(e) => { setSlugEdited(true); setSlug(e.target.value); }} />
        </div>
      </div>
      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      <button disabled={pending}
        className="w-full rounded-md bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-60 dark:bg-white dark:text-zinc-900">
        Create organisation
      </button>
    </form>
  );
}
