import { canStreamBackup } from '@/services/backupService';
import { exportBooksAsZip } from '@/services/exportBooksService';
import { useExportJobsStore } from '@/store/exportJobsStore';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';

const controllers = new Map<string, AbortController>();
let counter = 0;

/** Stops a run; the half-written file is dropped. */
export const cancelExportJob = (id: string) => controllers.get(id)?.abort();

/**
 * Saves the books as a ZIP and reports the run to the progress bar. Call it
 * straight from the click: the save dialog has to open before anything is awaited.
 */
export async function startExportJob(
  appService: AppService,
  books: Book[],
  filename: string,
): Promise<void> {
  const id = `export-${Date.now()}-${++counter}`;
  const controller = new AbortController();
  controllers.set(id, controller);
  const { add, update, remove } = useExportJobsStore.getState();
  add({
    id,
    status: 'starting',
    streaming: canStreamBackup(),
    current: 0,
    total: books.length,
    title: '',
    saved: 0,
    skipped: [],
  });
  try {
    const saved = await exportBooksAsZip(
      appService,
      books,
      filename,
      (current, total, title) => update(id, { status: 'running', current, total, title }),
      {
        signal: controller.signal,
        onSummary: ({ saved, skipped }) => update(id, { status: 'finishing', saved, skipped }),
      },
    );
    // The save dialog was dismissed.
    if (!saved) remove(id);
    else update(id, { status: 'done' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      remove(id);
    } else {
      console.error('Failed to save books as ZIP:', error);
      update(id, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    controllers.delete(id);
  }
}
