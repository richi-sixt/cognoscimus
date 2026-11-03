import React, { useEffect, useRef, useState } from 'react';
import {
  RiCheckboxCircleFill,
  RiErrorWarningFill,
  RiLoader2Line,
  RiUploadCloud2Line,
  RiDownloadCloud2Line,
} from 'react-icons/ri';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useFileSelector } from '@/hooks/useFileSelector';
import { useScreenWakeLock } from '@/hooks/useScreenWakeLock';
import {
  type BackupSummary,
  canStreamBackup,
  restoreFromBackupZip,
  saveBackupFile,
  saveBackupStreaming,
} from '@/services/backupService';
import { useLibraryStore } from '@/store/libraryStore';
import Dialog from '@/components/Dialog';

export const setBackupDialogVisible = (visible: boolean) => {
  const dialog = document.getElementById('backup_window');
  if (dialog) {
    const event = new CustomEvent('setDialogVisibility', {
      detail: { visible },
    });
    dialog.dispatchEvent(event);
  }
};

type BackupStatus = 'idle' | 'backing-up' | 'restoring' | 'completed' | 'error';

interface BackupProgress {
  current: number;
  total: number;
  currentFile?: string;
}

interface BackupResult {
  type: 'backup' | 'restore';
  booksAdded?: number;
  booksUpdated?: number;
  settingsRestored?: boolean;
  summary?: BackupSummary;
}

interface BackupWindowProps {
  onPullLibrary: (fullRefresh?: boolean, verbose?: boolean) => void;
}

export const BackupWindow: React.FC<BackupWindowProps> = ({ onPullLibrary }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { setLibrary } = useLibraryStore();
  const { selectFiles } = useFileSelector(appService, _);
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<BackupStatus>('idle');
  const [progress, setProgress] = useState<BackupProgress>({ current: 0, total: 0 });
  const [errorMessage, setErrorMessage] = useState('');
  const [result, setResult] = useState<BackupResult | null>(null);
  const [includeCredentials, setIncludeCredentials] = useState(false);
  const [includeCloudBooks, setIncludeCloudBooks] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const isProcessing = status === 'backing-up' || status === 'restoring';
  // Keep the screen on while a backup or restore runs, otherwise Android
  // suspends the app with it and the job stalls (#6291).
  useScreenWakeLock(isProcessing);

  const resetState = () => {
    setStatus('idle');
    setProgress({ current: 0, total: 0 });
    setErrorMessage('');
    setResult(null);
    setIncludeCredentials(false);
    setIncludeCloudBooks(true);
  };

  useEffect(() => {
    const handleCustomEvent = (event: CustomEvent) => {
      setIsOpen(event.detail.visible);
      if (event.detail.visible) {
        resetState();
      }
    };

    const el = document.getElementById('backup_window');
    if (el) {
      el.addEventListener('setDialogVisibility', handleCustomEvent as EventListener);
    }

    return () => {
      if (el) {
        el.removeEventListener('setDialogVisibility', handleCustomEvent as EventListener);
      }
    };
  }, []);

  const handleBackup = async () => {
    if (!appService) return;

    setStatus('backing-up');
    setErrorMessage('');
    setProgress({ current: 0, total: 0 });

    try {
      const timestamp = new Date().toISOString().slice(0, 10);
      const filename = `cognoscimus-backup-${timestamp}.zip`;
      const controller = new AbortController();
      abortRef.current = controller;
      let summary: BackupSummary | undefined;
      const extras = {
        signal: controller.signal,
        onSummary: (value: BackupSummary) => {
          summary = value;
        },
      };
      const onProgress = (current: number, total: number, currentFile?: string) => {
        setProgress({ current, total, currentFile });
      };
      const save = canStreamBackup() ? saveBackupStreaming : saveBackupFile;
      const saved = await save(
        appService,
        filename,
        { includeCredentials, includeCloudBooks },
        onProgress,
        extras,
      );
      if (saved) {
        setResult({ type: 'backup', ...(summary ? { summary } : {}) });
        setStatus('completed');
      } else {
        setStatus('idle');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setStatus('idle');
        return;
      }
      console.error('Backup failed:', error);
      setErrorMessage(_('Backup failed: {{error}}', { error: String(error) }));
      setStatus('error');
    } finally {
      abortRef.current = null;
    }
  };

  const handleRestore = async () => {
    if (!appService) return;

    try {
      const result = await selectFiles({
        type: 'generic',
        accept: '.zip',
        extensions: ['zip'],
        dialogTitle: _('Select Backup'),
      });
      if (!result.files.length) return;

      setStatus('restoring');
      setErrorMessage('');
      setProgress({ current: 0, total: 0 });

      const zipFile = result.files[0]?.file
        ? result.files[0].file
        : await appService.openFile(result.files[0]!.path!, 'None');

      const { booksAdded, booksUpdated, settingsRestored } = await restoreFromBackupZip(
        appService,
        zipFile,
        (current, total, currentFile) => {
          setProgress({ current, total, currentFile });
        },
      );

      const newLibrary = await appService.loadLibraryBooks();
      const booksCount = newLibrary.reduce((sum, book) => sum + (book.deletedAt ? 0 : 1), 0);
      setLibrary(newLibrary);
      setResult({
        type: 'restore',
        booksAdded: Math.min(booksAdded, booksCount),
        booksUpdated: Math.min(booksUpdated, booksCount),
        settingsRestored,
      });
      setStatus('completed');
      onPullLibrary(true);
    } catch (error) {
      console.error('Restore failed:', error);
      setErrorMessage(_('Restore failed: {{error}}', { error: String(error) }));
      setStatus('error');
    }
  };

  const handleClose = () => {
    if (status === 'backing-up' || status === 'restoring') {
      return;
    }
    setIsOpen(false);
    resetState();
  };

  const progressPercentage =
    progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <Dialog
      id='backup_window'
      isOpen={isOpen}
      title={_('Backup & Restore')}
      onClose={handleClose}
      snapHeight={appService?.isMobile ? 0.45 : undefined}
      dismissible={!isProcessing}
      boxClassName='sm:w-[520px]! sm:max-w-(--breakpoint-sm)! sm:h-auto'
    >
      {isOpen && (
        <div className='backup-content flex flex-col gap-6 px-6 py-4'>
          {/* Action Buttons */}
          {status === 'idle' && (
            <div className='space-y-3'>
              <p className='text-base-content/70 text-sm'>
                {_(
                  'Create a backup of your library and settings or restore from a previous backup. Restoring will merge with your current library.',
                )}
              </p>

              <label className='flex cursor-pointer items-start gap-2'>
                <input
                  type='checkbox'
                  checked={includeCredentials}
                  onChange={(e) => setIncludeCredentials(e.target.checked)}
                  className='checkbox checkbox-sm mt-0.5 shrink-0'
                />
                <span className='text-base-content/70 text-sm'>
                  {_(
                    'Include account credentials (sync tokens, passwords). The backup file is not encrypted.',
                  )}
                </span>
              </label>

              <label className='flex cursor-pointer items-start gap-2'>
                <input
                  type='checkbox'
                  checked={includeCloudBooks}
                  onChange={(e) => setIncludeCloudBooks(e.target.checked)}
                  className='checkbox checkbox-sm mt-0.5 shrink-0'
                />
                <span className='text-base-content/70 text-sm'>
                  {_(
                    'Also include books that are only in the cloud, with their reading position and notes (downloaded for the backup).',
                  )}
                </span>
              </label>

              {!canStreamBackup() && includeCloudBooks && (
                <p className='text-warning text-xs'>
                  {_(
                    'This browser builds the backup in memory. For a large library use Brave or Chrome.',
                  )}
                </p>
              )}

              <button className='btn btn-outline w-full gap-2' onClick={handleBackup}>
                <RiUploadCloud2Line className='h-5 w-5' />
                {_('Backup Library')}
              </button>

              <button className='btn btn-outline w-full gap-2' onClick={handleRestore}>
                <RiDownloadCloud2Line className='h-5 w-5' />
                {_('Restore Library')}
              </button>
            </div>
          )}

          {/* Progress */}
          {isProcessing && (
            <div className='space-y-3'>
              <div className='flex items-center gap-2'>
                <RiLoader2Line className='text-primary h-4 w-4 animate-spin' />
                <span className='text-base-content text-sm font-medium'>
                  {status === 'backing-up' ? _('Creating backup...') : _('Restoring library...')}
                </span>
                <span className='text-base-content/70 text-sm'>{progressPercentage}%</span>
              </div>

              <div className='bg-base-200 h-2 w-full rounded-full'>
                <div
                  className='bg-primary h-2 rounded-full transition-all duration-300'
                  style={{ width: `${progressPercentage}%` }}
                />
              </div>

              {progress.currentFile && (
                <p
                  className='text-base-content/60 overflow-hidden font-mono text-xs'
                  style={{
                    direction: 'rtl',
                    textAlign: 'left',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {progress.currentFile}
                </p>
              )}

              <p className='text-base-content/60 text-xs'>
                {_('{{current}} of {{total}} items', {
                  current: progress.current.toLocaleString(),
                  total: progress.total.toLocaleString(),
                })}
              </p>
            </div>
          )}

          {/* Success State */}
          {status === 'completed' && result && (
            <div className='space-y-3'>
              <div className='text-success flex items-center gap-2'>
                <RiCheckboxCircleFill className='h-5 w-5' />
                <span className='font-medium'>
                  {result.type === 'backup'
                    ? _('Backup completed successfully!')
                    : _('Restore completed successfully!')}
                </span>
              </div>
              <div className='bg-success/10 border-success/20 rounded-lg border p-3'>
                <p className='text-success/80 text-sm'>
                  {result.type === 'backup'
                    ? _('Your library and settings have been saved to the selected location.') +
                      (result.summary?.cloudBooks
                        ? ' ' +
                          _('{{count}} books came from the cloud.', {
                            count: result.summary.cloudBooks,
                          })
                        : '')
                    : _('{{added}} books added, {{updated}} books updated.', {
                        added: result.booksAdded ?? 0,
                        updated: result.booksUpdated ?? 0,
                      }) + (result.settingsRestored ? ' ' + _('Settings have been restored.') : '')}
                </p>
              </div>
              {result.summary?.configsFailed && (
                <div className='bg-warning/10 border-warning/20 rounded-lg border p-3'>
                  <p className='text-warning text-sm'>
                    {_(
                      'Reading positions and notes could not be read from the server. The files are saved, but notes of books that are not on this device are missing.',
                    )}
                  </p>
                </div>
              )}
              {result.summary && result.summary.skipped.length > 0 && (
                <div className='bg-warning/10 border-warning/20 rounded-lg border p-3'>
                  <p className='text-warning text-sm'>
                    {_('{{count}} books could not be fetched and are not in the file:', {
                      count: result.summary.skipped.length,
                    })}
                  </p>
                  <p className='text-base-content/70 mt-1 break-words text-xs'>
                    {result.summary.skipped.slice(0, 10).join(', ')}
                    {result.summary.skipped.length > 10 ? ', …' : ''}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Error State */}
          {status === 'error' && errorMessage && (
            <div className='space-y-2'>
              <div className='text-error flex items-center gap-2'>
                <RiErrorWarningFill className='h-5 w-5' />
                <span className='font-medium'>{_('Operation failed')}</span>
              </div>
              <div className='bg-error/10 border-error/20 rounded-lg border p-3'>
                <p className='text-error/80 break-all text-sm'>{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Footer Buttons */}
          <div className='flex gap-3 pt-2'>
            {status === 'completed' || status === 'error' ? (
              <>
                <button className='btn btn-outline flex-1' onClick={handleClose}>
                  {_('Close')}
                </button>
                {status === 'error' && (
                  <button className='btn btn-primary flex-1' onClick={resetState}>
                    {_('Try Again')}
                  </button>
                )}
              </>
            ) : (
              <button
                className='btn btn-outline flex-1'
                onClick={isProcessing ? () => abortRef.current?.abort() : handleClose}
                disabled={status === 'restoring'}
              >
                {_('Cancel')}
              </button>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
};
