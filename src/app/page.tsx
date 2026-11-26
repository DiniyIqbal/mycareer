import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">MyCareer</h1>
      <p className="mt-4 text-lg text-zinc-600 dark:text-zinc-400">
        Post a job once, receive every application in one pipeline, and keep candidates informed
        automatically.
      </p>
      <div className="mt-8">
        <Link href="/login"
          className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white dark:bg-white dark:text-zinc-900">
          Sign in for HR
        </Link>
      </div>
    </main>
  );
}
