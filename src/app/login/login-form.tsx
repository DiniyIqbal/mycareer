"use client";

import { useActionState, useState } from "react";
import { signIn, signUp, type AuthState } from "./actions";

const input = "w-full rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900";

export function LoginForm({ next, initialMode = "signin", email }: {
  next?: string;
  initialMode?: "signin" | "signup";
  email?: string;
}) {
  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const [state, action, pending] = useActionState<AuthState, FormData>(
    mode === "signin" ? signIn : signUp,
    {},
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      {mode === "signup" && (
        <div className="space-y-1">
          <label htmlFor="full_name" className="text-sm font-medium">Full name</label>
          <input id="full_name" name="full_name" autoComplete="name" required className={input} />
        </div>
      )}
      <div className="space-y-1">
        <label htmlFor="email" className="text-sm font-medium">Work email</label>
        <input id="email" name="email" type="email" autoComplete="email" required defaultValue={email} className={input} />
      </div>
      <div className="space-y-1">
        <label htmlFor="password" className="text-sm font-medium">Password</label>
        <input id="password" name="password" type="password" minLength={10} required
          autoComplete={mode === "signin" ? "current-password" : "new-password"} className={input} />
      </div>

      {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
      {state.message && <p role="status" className="text-sm text-green-700">{state.message}</p>}

      <button disabled={pending}
        className="w-full rounded-md bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-60 dark:bg-white dark:text-zinc-900">
        {mode === "signin" ? "Sign in" : "Create account"}
      </button>
      <button type="button" className="w-full text-sm text-zinc-600 underline dark:text-zinc-400"
        onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
        {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
      </button>
    </form>
  );
}
