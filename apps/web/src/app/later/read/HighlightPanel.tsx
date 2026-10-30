'use client';

import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { IoClose, IoTrashOutline } from 'react-icons/io5';
import { useTranslation } from '@/hooks/useTranslation';
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_DOT_CLASS,
  type HighlightColor,
} from '@/libs/later/highlights';
import type { HighlightsApi } from './useHighlights';

const ColorDots = ({
  current,
  onPick,
  label,
}: {
  current?: HighlightColor;
  onPick: (color: HighlightColor) => void;
  label: (color: HighlightColor) => string;
}) => (
  <div className='flex items-center gap-1.5'>
    {HIGHLIGHT_COLORS.map((color) => (
      <button
        key={color}
        type='button'
        // Keep the text selection alive while the button is pressed.
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => onPick(color)}
        aria-label={label(color)}
        aria-pressed={current === color}
        className={clsx(
          'h-7 w-7 rounded-full border-2 transition-transform',
          HIGHLIGHT_DOT_CLASS[color],
          current === color ? 'border-base-content scale-110' : 'border-transparent',
        )}
      />
    ))}
  </div>
);

// The floating bar for a new selection, the editor for one highlight, the undo
// toast and the list of all highlights in the article.
const HighlightPanel = ({
  api,
  listOpen,
  onCloseList,
}: {
  api: HighlightsApi;
  listOpen: boolean;
  onCloseList: () => void;
}) => {
  const _ = useTranslation();
  const active = api.highlights.find((h) => h.id === api.activeId) ?? null;
  const [note, setNote] = useState('');

  useEffect(() => setNote(active?.annotation ?? ''), [active?.id, active?.annotation]);

  const colorLabel = (color: HighlightColor) =>
    ({ yellow: _('Yellow'), green: _('Green'), blue: _('Blue'), pink: _('Pink') })[color];

  const saveNote = () => {
    if (!active) return;
    const next = note.trim() || null;
    if (next !== (active.annotation ?? null)) void api.update(active.id, { annotation: next });
  };

  const closeEditor = () => {
    saveNote();
    api.setActiveId(null);
  };

  const addWithNote = async () => {
    const id = await api.create('yellow');
    if (id) api.setActiveId(id);
  };

  return (
    <>
      {api.hasSelection && !active && (
        <div className='fixed inset-x-0 bottom-4 z-20 flex justify-center px-4'>
          <div className='bg-base-300 flex items-center gap-3 rounded-full px-4 py-2 shadow-lg'>
            <ColorDots onPick={(c) => void api.create(c)} label={colorLabel} />
            <button
              type='button'
              onPointerDown={(e) => e.preventDefault()}
              onClick={addWithNote}
              className='btn btn-ghost btn-xs'
            >
              {_('Note')}
            </button>
          </div>
        </div>
      )}

      {active && (
        <div className='fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-4'>
          <div className='bg-base-300 flex w-full max-w-2xl flex-col gap-3 rounded-2xl p-4 shadow-xl'>
            <div className='flex items-start justify-between gap-3'>
              <p className='line-clamp-2 text-sm italic'>“{active.quote}”</p>
              <button
                type='button'
                onClick={closeEditor}
                className='btn btn-ghost btn-circle btn-xs'
                aria-label={_('Close')}
              >
                <IoClose className='h-4 w-4' />
              </button>
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={saveNote}
              maxLength={5000}
              rows={3}
              placeholder={_('Add a note')}
              aria-label={_('Note')}
              className='textarea textarea-bordered w-full text-sm'
            />
            <div className='flex items-center justify-between'>
              <ColorDots
                current={active.color}
                onPick={(c) => void api.update(active.id, { color: c })}
                label={colorLabel}
              />
              <button
                type='button'
                onClick={() => void api.remove(active.id)}
                className='btn btn-ghost btn-sm text-error gap-1'
              >
                <IoTrashOutline className='h-4 w-4' />
                {_('Delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {api.undoable && !active && (
        <div className='fixed inset-x-0 bottom-4 z-30 flex justify-center px-4'>
          <div className='bg-neutral text-neutral-content flex items-center gap-3 rounded-full px-4 py-2 text-sm shadow-lg'>
            <span>{_('Highlight deleted')}</span>
            <button
              type='button'
              onClick={() => void api.undo()}
              className='font-semibold underline'
            >
              {_('Undo')}
            </button>
          </div>
        </div>
      )}

      {listOpen && (
        <div className='fixed inset-0 z-40 flex justify-end'>
          <button
            type='button'
            aria-label={_('Close')}
            onClick={onCloseList}
            className='bg-base-content/30 flex-1 cursor-default'
          />
          <aside className='bg-base-100 flex h-full w-full max-w-sm flex-col gap-3 overflow-y-auto p-4 shadow-xl'>
            <div className='flex items-center justify-between'>
              <h2 className='font-semibold'>{_('Highlights')}</h2>
              <button
                type='button'
                onClick={onCloseList}
                className='btn btn-ghost btn-circle btn-sm'
                aria-label={_('Close')}
              >
                <IoClose className='h-5 w-5' />
              </button>
            </div>
            {api.highlights.length === 0 && (
              <p className='text-base-content/60 text-sm'>
                {_('Select text in the article to highlight it.')}
              </p>
            )}
            <ul className='flex flex-col gap-3'>
              {api.highlights.map((h) => (
                <li key={h.id} className='flex gap-2'>
                  <span
                    className={clsx('w-1 shrink-0 rounded-full', HIGHLIGHT_DOT_CLASS[h.color])}
                  />
                  <div className='min-w-0 flex-1'>
                    <button
                      type='button'
                      disabled={api.lost.has(h.id)}
                      onClick={() => {
                        api.jumpTo(h.id);
                        onCloseList();
                      }}
                      className='text-left text-sm'
                    >
                      {h.quote}
                    </button>
                    {h.annotation && (
                      <p className='text-base-content/70 mt-1 text-sm whitespace-pre-wrap'>
                        {h.annotation}
                      </p>
                    )}
                    {api.lost.has(h.id) && (
                      <p className='text-warning mt-1 text-xs'>{_('No longer in the text')}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      )}
    </>
  );
};

export default HighlightPanel;
