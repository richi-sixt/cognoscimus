import { create } from 'zustand';

// The books being saved as a ZIP, one row per run. A run outlives the page that
// started it, so the progress bar reads it from here instead of from the shelf.

export type ExportJobStatus = 'starting' | 'running' | 'finishing' | 'done' | 'error';

export interface ExportJob {
  id: string;
  status: ExportJobStatus;
  /** Written straight to disk, or built in memory and saved at the end. */
  streaming: boolean;
  current: number;
  total: number;
  title: string;
  saved: number;
  skipped: string[];
  error?: string;
}

interface ExportJobsState {
  jobs: ExportJob[];
  add: (job: ExportJob) => void;
  update: (id: string, patch: Partial<ExportJob>) => void;
  remove: (id: string) => void;
}

export const useExportJobsStore = create<ExportJobsState>((set) => ({
  jobs: [],
  add: (job) => set((state) => ({ jobs: [...state.jobs, job] })),
  update: (id, patch) =>
    set((state) => ({ jobs: state.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) })),
  remove: (id) => set((state) => ({ jobs: state.jobs.filter((j) => j.id !== id) })),
}));
