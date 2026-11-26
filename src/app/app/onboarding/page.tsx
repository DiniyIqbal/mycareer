import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getMembership } from "@/lib/auth/membership";
import { OnboardingForm } from "./onboarding-form";

export default function OnboardingPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
      <h1 className="mb-2 text-2xl font-semibold tracking-tight">Set up your organisation</h1>
      <p className="mb-6 text-zinc-600 dark:text-zinc-400">
        You will be the Org Admin. You can invite recruiters and hiring managers later.
      </p>
      <Suspense>
        <RedirectIfMember />
      </Suspense>
      <OnboardingForm />
    </main>
  );
}

async function RedirectIfMember() {
  if (await getMembership()) redirect("/app");
  return null;
}
