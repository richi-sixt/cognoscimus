'use client';

import { type ChangeEvent, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { importEntries } from '@/libs/later/client';
import { type ParsedImport, parseRaindropExport } from '@/libs/later/importRaindrop';

// Imports the HTML backup from Raindrop.io: the links are stored at once and
// the page owner (see LaterPage) loads their article text afterwards.
const ImportRaindrop = ({ onImported }: { onImported: () => void }) => {
  const _ = useTranslation();
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [folderLabels, setFolderLabels] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tagCount = parsed
    ? new Set(parsed.entries.flatMap((e) => e.tags.map((t) => t.toLowerCase()))).size
    : 0;

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setMessage(null);
    setError(null);
    setParsed(null);
    if (!file) return;
    try {
      const result = parseRaindropExport(await file.text());
      if (result.entries.length === 0) setError(_('No links found in this file.'));
      else setParsed(result);
    } catch {
      setError(_('This file could not be read.'));
    }
  };

  const start = async () => {
    if (!parsed || progress !== null) return;
    setError(null);
    setProgress(0);
    try {
      const result = await importEntries(parsed.entries, { folderLabels, onProgress: setProgress });
      setMessage(
        _('Imported {{imported}} links, {{existing}} were already saved.', {
          imported: result.imported,
          existing: result.existing,
        }),
      );
      setParsed(null);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : _('The import failed.'));
    } finally {
      setProgress(null);
    }
  };

  return (
    <details className='bg-base-200/60 rounded-2xl px-4 py-3 text-sm'>
      <summary className='cursor-pointer font-medium'>{_('Import from Raindrop')}</summary>
      <div className='text-base-content/70 mt-3 flex flex-col gap-3'>
        <p>
          {_(
            'In Raindrop open Settings, Import and Export, and export as HTML. Choose that file here.',
          )}
        </p>
        <input
          type='file'
          accept='.html,text/html'
          onChange={onFile}
          disabled={progress !== null}
          className='file-input file-input-bordered file-input-sm w-full max-w-xs'
          aria-label={_('Raindrop export file')}
        />
        {parsed && (
          <>
            <p className='text-base-content'>
              {_('{{links}} links, {{folders}} folders, {{tags}} tags', {
                links: parsed.entries.length,
                folders: parsed.folders.length,
                tags: tagCount,
              })}
            </p>
            <label className='flex cursor-pointer items-center gap-2'>
              <input
                type='checkbox'
                checked={folderLabels}
                onChange={(e) => setFolderLabels(e.target.checked)}
                className='checkbox checkbox-sm'
              />
              <span>{_('Keep folders as labels (for example Coding/Python)')}</span>
            </label>
            <button
              type='button'
              onClick={start}
              disabled={progress !== null}
              className='btn btn-primary btn-sm w-fit'
            >
              {progress === null ? _('Import') : `${progress} / ${parsed.entries.length}`}
            </button>
          </>
        )}
        {message && <p className='text-success'>{message}</p>}
        {error && (
          <p className='text-error' role='alert'>
            {error}
          </p>
        )}
      </div>
    </details>
  );
};

export default ImportRaindrop;
