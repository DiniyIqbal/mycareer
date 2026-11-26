"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import { StageBadge } from "../../../candidates/stage-badge";
import { moveApplication } from "./actions";

export type BoardCard = {
  id: string;
  candidateId: string;
  stageId: string;
  name: string;
  email: string;
  applied: string;
  daysInStage: number;
};
type Stage = { id: string; name: string; kind: string };
type Move = { id: string; from: string; to: string };
type Toast = { tone: "ok" | "error"; text: string; undo?: Move };

export function Board({ jobId, stages, cards, canMove }: {
  jobId: string;
  stages: Stage[];
  cards: BoardCard[];
  canMove: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimistic, applyMove] = useOptimistic(cards, (state, move: Move) =>
    state.map((c) => (c.id === move.id ? { ...c, stageId: move.to, daysInStage: 0 } : c)),
  );
  const [toast, setToast] = useState<Toast | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Move | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  const stageById = new Map(stages.map((s) => [s.id, s]));

  // HR-06: other people's moves appear without reloading.
  useEffect(() => {
    const supabase = getBrowserClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel(`pipeline:${jobId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "applications", filter: `job_id=eq.${jobId}` }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => router.refresh(), 300);
      })
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [jobId, router]);

  useEffect(() => {
    if (rejecting) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [rejecting]);

  function request(move: Move) {
    if (!canMove || move.from === move.to) return;
    if (stageById.get(move.to)?.kind === "rejected") setRejecting(move);
    else perform(move);
  }

  function perform(move: Move, reason?: string, isUndo = false) {
    const card = optimistic.find((c) => c.id === move.id);
    startTransition(async () => {
      applyMove(move);
      const result = await moveApplication({
        applicationId: move.id, fromStageId: move.from, toStageId: move.to, reason,
      });
      if (!result.ok) {
        setToast({ tone: "error", text: result.error });
        return;
      }
      const to = stageById.get(move.to)?.name ?? "the new stage";
      setToast({
        tone: "ok",
        text: `${card?.name ?? "Candidate"} moved to ${to}.${result.notice ? ` ${result.notice}` : ""}`,
        undo: isUndo ? undefined : { id: move.id, from: move.to, to: move.from },
      });
    });
  }

  return (
    <>
      <div aria-live="polite" className="min-h-0">
        {toast && (
          <div role={toast.tone === "error" ? "alert" : "status"}
            className={`mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm ${
              toast.tone === "error"
                ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
                : "border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900"}`}>
            <span>{toast.text}</span>
            <span className="flex gap-3">
              {toast.undo && (
                <button type="button" className="font-medium underline" disabled={pending}
                  onClick={() => toast.undo && perform(toast.undo, undefined, true)}>
                  Undo
                </button>
              )}
              <button type="button" aria-label="Dismiss" onClick={() => setToast(null)}>✕</button>
            </span>
          </div>
        )}
      </div>

      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4">
        {stages.map((stage) => {
          const column = optimistic.filter((c) => c.stageId === stage.id);
          return (
            <section key={stage.id} aria-labelledby={`stage-${stage.id}`}
              className={`flex w-72 shrink-0 snap-start flex-col rounded-lg border bg-zinc-50 dark:bg-zinc-900/50 ${
                dropTarget === stage.id ? "border-zinc-900 dark:border-white" : "border-zinc-200 dark:border-zinc-800"}`}
              onDragOver={canMove ? (e) => { e.preventDefault(); setDropTarget(stage.id); } : undefined}
              onDragLeave={canMove ? () => setDropTarget((t) => (t === stage.id ? null : t)) : undefined}
              onDrop={canMove ? (e) => {
                e.preventDefault();
                setDropTarget(null);
                const id = e.dataTransfer.getData("text/plain");
                const card = optimistic.find((c) => c.id === id);
                if (card) request({ id, from: card.stageId, to: stage.id });
              } : undefined}>
              <h2 id={`stage-${stage.id}`} className="flex items-center justify-between px-3 py-2 text-sm font-semibold">
                <StageBadge name={stage.name} kind={stage.kind} />
                <span className="tabular-nums text-zinc-500">{column.length}</span>
              </h2>
              <ul className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
                {column.map((card) => (
                  <li key={card.id} draggable={canMove}
                    onDragStart={(e) => { e.dataTransfer.setData("text/plain", card.id); e.dataTransfer.effectAllowed = "move"; setDragging(card.id); }}
                    onDragEnd={() => { setDragging(null); setDropTarget(null); }}
                    className={`rounded-md border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 ${
                      canMove ? "cursor-grab active:cursor-grabbing" : ""} ${dragging === card.id ? "opacity-50" : ""}`}>
                    <Link href={`/app/candidates/${card.candidateId}#application-${card.id}`} className="font-medium hover:underline">
                      {card.name}
                    </Link>
                    <p className="truncate text-xs text-zinc-500">{card.email}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Applied {card.applied} · {card.daysInStage === 0 ? "today" : `${card.daysInStage}d`} in stage
                    </p>
                    {canMove && (
                      <label className="mt-2 block text-xs">
                        <span className="sr-only">Move {card.name} to</span>
                        <select value={card.stageId} disabled={pending}
                          onChange={(e) => request({ id: card.id, from: card.stageId, to: e.target.value })}
                          className="w-full rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900">
                          {stages.map((s) => (
                            <option key={s.id} value={s.id}>{s.id === card.stageId ? `In ${s.name}` : `Move to ${s.name}`}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <dialog ref={dialogRef} onClose={() => setRejecting(null)}
        className="m-auto w-full max-w-md rounded-lg p-0 backdrop:bg-black/40 dark:bg-zinc-900 dark:text-zinc-100">
        <form method="dialog" className="space-y-4 p-5"
          onSubmit={(e) => {
            if ((e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") !== "confirm" || !rejecting) return;
            perform(rejecting, reasonRef.current?.value.trim() || undefined);
            if (reasonRef.current) reasonRef.current.value = "";
          }}>
          <h2 className="text-lg font-semibold">
            Reject {optimistic.find((c) => c.id === rejecting?.id)?.name ?? "candidate"}?
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            If automatic emails are on, they will get a polite rejection email after a delay (48 hours by
            default). Moving them back before then cancels it.
          </p>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Reason (internal, optional)</span>
            <textarea ref={reasonRef} rows={3} maxLength={500}
              className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
          </label>
          <div className="flex justify-end gap-3">
            <button value="cancel" className="rounded-md px-4 py-2">Cancel</button>
            <button value="confirm" className="rounded-md bg-red-700 px-4 py-2 font-medium text-white">Reject</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
