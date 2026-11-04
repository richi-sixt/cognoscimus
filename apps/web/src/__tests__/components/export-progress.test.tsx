import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, vars?: Record<string, unknown>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars?.[name])),
}));

const cancelMock = vi.fn();
vi.mock('@/services/exportBooksJob', () => ({ cancelExportJob: (id: string) => cancelMock(id) }));

import ExportProgress from '@/components/ExportProgress';
import { ExportJob, useExportJobsStore } from '@/store/exportJobsStore';

const job = (extra: Partial<ExportJob> = {}): ExportJob => ({
  id: 'j1',
  status: 'running',
  streaming: true,
  current: 3,
  total: 10,
  title: 'Asterix',
  saved: 0,
  skipped: [],
  ...extra,
});

beforeEach(() => {
  cancelMock.mockReset();
  useExportJobsStore.setState({ jobs: [] });
});
afterEach(cleanup);

describe('ExportProgress', () => {
  it('shows nothing without a run', () => {
    const { container } = render(<ExportProgress />);

    expect(container.firstChild).toBeNull();
  });

  it('shows which book is being saved and lets the run be cancelled', () => {
    useExportJobsStore.setState({ jobs: [job()] });
    render(<ExportProgress />);

    expect(screen.getByText('Book 3 of 10')).toBeTruthy();
    expect(screen.getByText('Asterix')).toBeTruthy();
    fireEvent.click(screen.getByText('Cancel'));

    expect(cancelMock).toHaveBeenCalledWith('j1');
  });

  it('warns about the memory limit only when the file is built in memory', () => {
    useExportJobsStore.setState({ jobs: [job({ streaming: false })] });
    render(<ExportProgress />);

    expect(screen.getByText(/builds the file in memory/)).toBeTruthy();
  });

  it('keeps a result with skipped books until it is closed', () => {
    vi.useFakeTimers();
    useExportJobsStore.setState({
      jobs: [job({ status: 'done', saved: 2, skipped: ['Gone'] })],
    });
    render(<ExportProgress />);

    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText(/2 book\(s\) saved, 1 skipped: Gone/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Close'));

    expect(useExportJobsStore.getState().jobs).toEqual([]);
    vi.useRealTimers();
  });

  it('clears a clean result by itself', () => {
    vi.useFakeTimers();
    useExportJobsStore.setState({ jobs: [job({ status: 'done', saved: 4 })] });
    render(<ExportProgress />);

    act(() => vi.advanceTimersByTime(9000));

    expect(useExportJobsStore.getState().jobs).toEqual([]);
    vi.useRealTimers();
  });
});
