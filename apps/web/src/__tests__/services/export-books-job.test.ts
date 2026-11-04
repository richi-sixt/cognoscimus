import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelExportJob, startExportJob } from '@/services/exportBooksJob';
import { useExportJobsStore } from '@/store/exportJobsStore';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';

// A run reports to the progress bar: where it is, what it skipped, how it ended.

const exportMock = vi.fn();
vi.mock('@/services/exportBooksService', () => ({
  exportBooksAsZip: (...a: unknown[]) => exportMock(...a),
}));
vi.mock('@/services/backupService', () => ({ canStreamBackup: () => true }));

const books = [{ hash: 'a' }, { hash: 'b' }] as Book[];
const app = {} as AppService;
const jobs = () => useExportJobsStore.getState().jobs;

beforeEach(() => {
  exportMock.mockReset();
  useExportJobsStore.setState({ jobs: [] });
});

describe('startExportJob', () => {
  it('follows the run and ends as done with what was skipped', async () => {
    const seen: string[] = [];
    exportMock.mockImplementation(async (_a, _b, _f, onProgress, extras) => {
      seen.push(jobs()[0]!.status);
      onProgress(1, 2, 'First');
      seen.push(`${jobs()[0]!.status}:${jobs()[0]!.current}/${jobs()[0]!.total}`);
      extras.onSummary({ saved: 1, skipped: ['Second'] });
      seen.push(jobs()[0]!.status);
      return true;
    });

    await startExportJob(app, books, 'x.zip');

    expect(seen).toEqual(['starting', 'running:1/2', 'finishing']);
    expect(jobs()).toHaveLength(1);
    expect(jobs()[0]).toMatchObject({ status: 'done', saved: 1, skipped: ['Second'] });
  });

  it('drops the row when the save dialog is dismissed', async () => {
    exportMock.mockResolvedValue(false);

    await startExportJob(app, books, 'x.zip');

    expect(jobs()).toEqual([]);
  });

  it('keeps a failed run visible with its message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    exportMock.mockRejectedValue(new Error('disk full'));

    await startExportJob(app, books, 'x.zip');

    expect(jobs()[0]).toMatchObject({ status: 'error', error: 'disk full' });
  });

  it('drops the row when cancelled', async () => {
    exportMock.mockImplementation(
      (_a, _b, _f, _p, extras: { signal: AbortSignal }) =>
        new Promise((_, reject) =>
          extras.signal.addEventListener('abort', () =>
            reject(new DOMException('cancelled', 'AbortError')),
          ),
        ),
    );

    const run = startExportJob(app, books, 'x.zip');
    cancelExportJob(jobs()[0]!.id);
    await run;

    expect(jobs()).toEqual([]);
  });
});
