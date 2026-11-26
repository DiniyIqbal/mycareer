"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type OnboardingState = { error?: string };

const schema = z.object({
  name: z.string().trim().min(1, "Enter your organisation's name").max(200),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/, "Use 3–48 lowercase letters, numbers or hyphens"),
});

export async function createOrganisation(_: OnboardingState, formData: FormData): Promise<OnboardingState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_organisation", {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
  });
  if (error) {
    if (error.code === "23505") return { error: "That careers page address is taken." };
    if (error.code === "23514") return { error: "That careers page address is not allowed." };
    return { error: "Could not create the organisation. Please try again." };
  }
  redirect("/app");
}
