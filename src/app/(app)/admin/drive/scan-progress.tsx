"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/components/ui";

interface Run {
  started_at: string;
  files_added: number;
  files_updated: number;
  files_registered: number;
  files_queued: number;
}

/** Refreshes the page every few seconds while a scan runs (SDD ScanProgress). */
export function ScanProgress({ run }: { run: Run }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(id);
  }, [router]);

  const processed = run.files_registered + run.files_queued;
  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900" aria-live="polite">
      <h2 className="mb-2 flex items-center gap-2 font-semibold">
        <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" aria-hidden />
        Scan in progress
      </h2>
      <p>Started {formatDateTime(run.started_at)}.</p>
      <ul className="mt-2 space-y-1">
        <li>Files recorded: {run.files_added + run.files_updated}</li>
        <li>Files processed for coding: {processed}</li>
        <li>Coded automatically: {run.files_registered}</li>
        <li>Waiting for classification: {run.files_queued}</li>
      </ul>
    </section>
  );
}
