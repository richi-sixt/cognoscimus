'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import {
  CARD_TEXT_MAX,
  type Card,
  type CardGroup,
  createGroup,
  deleteCard,
  deleteGroup,
  isLearnable,
  saveCard,
  setCardGroups,
  updateCard,
} from '@/libs/erinnern/cards';
import { formatInterval } from '@/libs/erinnern/srs';

interface Props {
  userId: string;
  cards: Card[];
  groups: CardGroup[];
  onChanged: () => void | Promise<void>;
  onError: (message: string) => void;
}

const GroupChips = ({
  groups,
  selected,
  onToggle,
}: {
  groups: CardGroup[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) => (
  <div className='flex flex-wrap gap-1'>
    {groups.map((g) => (
      <button
        key={g.id}
        type='button'
        onClick={() => onToggle(g.id)}
        aria-pressed={selected.has(g.id)}
        className={`badge badge-sm cursor-pointer ${selected.has(g.id) ? 'badge-primary' : 'badge-outline border-dashed opacity-60'}`}
      >
        {selected.has(g.id) ? '✓ ' : ''}
        {g.kind === 'book' ? `📖 ${g.name}` : g.name}
      </button>
    ))}
  </div>
);

const CardRow = ({
  card,
  groups,
  userId,
  run,
}: {
  card: Card;
  groups: CardGroup[];
  userId: string;
  run: (action: () => Promise<void>) => Promise<void>;
}) => {
  const _ = useTranslation();
  const [editing, setEditing] = useState(false);
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const memberIds = useMemo(
    () => new Set(card.card_group_members.map((m) => m.group_id)),
    [card.card_group_members],
  );

  const toggleGroup = (id: string) => {
    const next = new Set(memberIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    void run(() => setCardGroups(userId, card.id, [...next]));
  };

  return (
    <article className='border-base-300 bg-base-200/40 rounded-lg border p-3'>
      {editing ? (
        <div className='space-y-2'>
          <textarea
            value={front}
            onChange={(e) => setFront(e.target.value)}
            maxLength={CARD_TEXT_MAX}
            rows={3}
            aria-label={_('Question')}
            className='textarea textarea-bordered w-full'
          />
          <textarea
            value={back}
            onChange={(e) => setBack(e.target.value)}
            maxLength={CARD_TEXT_MAX}
            rows={3}
            aria-label={_('Answer')}
            className='textarea textarea-bordered w-full'
          />
          <div className='flex justify-end gap-2'>
            <button
              type='button'
              className='btn btn-ghost btn-xs'
              onClick={() => setEditing(false)}
            >
              {_('Cancel')}
            </button>
            <button
              type='button'
              className='btn btn-primary btn-xs'
              disabled={!front.trim()}
              onClick={() =>
                void run(async () => {
                  await updateCard(card.id, { front, back });
                  setEditing(false);
                })
              }
            >
              {_('Save')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className='whitespace-pre-line'>{card.front}</p>
          {isLearnable(card) ? (
            <p className='mt-2 text-sm whitespace-pre-line opacity-80'>{card.back}</p>
          ) : (
            <button
              type='button'
              className='badge badge-warning badge-sm mt-2'
              onClick={() => setEditing(true)}
            >
              {_('Answer missing')}
            </button>
          )}
        </>
      )}

      {groups.length > 0 &&
        (editing ? (
          <div className='mt-2'>
            <GroupChips groups={groups} selected={memberIds} onToggle={toggleGroup} />
          </div>
        ) : (
          memberIds.size > 0 && (
            <div className='mt-2 flex flex-wrap gap-1'>
              {groups
                .filter((g) => memberIds.has(g.id))
                .map((g) => (
                  <span key={g.id} className='badge badge-sm badge-ghost'>
                    {g.kind === 'book' ? `📖 ${g.name}` : g.name}
                  </span>
                ))}
            </div>
          )
        ))}

      {!editing && (
        <div className='mt-2 flex items-center justify-between gap-1'>
          <span className='text-xs opacity-60'>
            {isLearnable(card) && card.reps > 0
              ? _('Next: {{when}}', { when: formatInterval(new Date(card.due_at)) })
              : isLearnable(card)
                ? _('New')
                : ''}
          </span>
          <div className='flex gap-1'>
            <button type='button' className='btn btn-ghost btn-xs' onClick={() => setEditing(true)}>
              {_('Edit')}
            </button>
            {confirmDelete ? (
              <>
                <button
                  type='button'
                  className='btn btn-error btn-xs'
                  onClick={() => void run(() => deleteCard(card.id))}
                >
                  {_('Delete card')}
                </button>
                <button
                  type='button'
                  className='btn btn-ghost btn-xs'
                  onClick={() => setConfirmDelete(false)}
                >
                  {_('Cancel')}
                </button>
              </>
            ) : (
              <button
                type='button'
                className='btn btn-ghost btn-xs'
                onClick={() => setConfirmDelete(true)}
              >
                {_('Delete')}
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
};

const CardsManager = ({ userId, cards, groups, onChanged, onError }: Props) => {
  const _ = useTranslation();
  const [filter, setFilter] = useState<string>('');
  const [adding, setAdding] = useState(false);
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [newGroups, setNewGroups] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    try {
      await action();
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : _('Something went wrong'));
    }
  };

  const visible = cards.filter((c) => {
    if (filter === '__missing') return !isLearnable(c);
    if (filter) return c.card_group_members.some((m) => m.group_id === filter);
    return true;
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!front.trim()) return;
    setBusy(true);
    await run(async () => {
      await saveCard(userId, {
        front,
        back,
        groupIds: [...newGroups],
        source: { kind: 'manual' },
      });
      setFront('');
      setBack('');
      setAdding(false);
    });
    setBusy(false);
  };

  const addGroup = (event: FormEvent) => {
    event.preventDefault();
    if (!groupName.trim()) return;
    void run(async () => {
      await createGroup(userId, groupName);
      setGroupName('');
    });
  };

  const customGroups = groups.filter((g) => g.kind === 'custom');

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <select
          className='select select-bordered select-sm min-w-0 flex-1'
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label={_('Filter')}
        >
          <option value=''>{_('All cards')}</option>
          <option value='__missing'>{_('Answer missing')}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.kind === 'book' ? `📖 ${g.name}` : g.name}
            </option>
          ))}
        </select>
        <button type='button' className='btn btn-primary btn-sm' onClick={() => setAdding(true)}>
          {_('Add card')}
        </button>
      </div>

      {adding && (
        <form
          onSubmit={(e) => void submit(e)}
          className='border-base-300 bg-base-200/50 space-y-2 rounded-lg border p-3'
        >
          <textarea
            value={front}
            onChange={(e) => setFront(e.target.value)}
            maxLength={CARD_TEXT_MAX}
            rows={3}
            required
            autoFocus
            placeholder={_('Question')}
            aria-label={_('Question')}
            className='textarea textarea-bordered w-full'
          />
          <textarea
            value={back}
            onChange={(e) => setBack(e.target.value)}
            maxLength={CARD_TEXT_MAX}
            rows={3}
            placeholder={_('Answer')}
            aria-label={_('Answer')}
            className='textarea textarea-bordered w-full'
          />
          {groups.length > 0 && (
            <p className='text-xs opacity-70'>{_('Groups (optional, tap to choose)')}</p>
          )}
          {groups.length > 0 && (
            <GroupChips
              groups={groups}
              selected={newGroups}
              onToggle={(id) => {
                const next = new Set(newGroups);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                setNewGroups(next);
              }}
            />
          )}
          <div className='flex justify-end gap-2'>
            <button type='button' className='btn btn-ghost btn-sm' onClick={() => setAdding(false)}>
              {_('Cancel')}
            </button>
            <button
              type='submit'
              disabled={busy || !front.trim()}
              className='btn btn-primary btn-sm'
            >
              {_('Save')}
            </button>
          </div>
        </form>
      )}

      {visible.length === 0 && (
        <p className='py-8 text-center text-sm opacity-70'>
          {_('No cards yet. Add one here, or send a word, a sentence or a quote.')}
        </p>
      )}
      <ul className='space-y-3'>
        {visible.map((card) => (
          <li key={card.id}>
            <CardRow card={card} groups={groups} userId={userId} run={run} />
          </li>
        ))}
      </ul>

      <section className='border-base-300 space-y-2 border-t pt-4'>
        <h2 className='text-sm font-semibold'>{_('Groups')}</h2>
        <p className='text-xs opacity-70'>
          {_('A book becomes a group by itself when you send something from it.')}
        </p>
        <ul className='space-y-1 text-sm'>
          {groups.map((g) => (
            <li key={g.id} className='flex items-center justify-between gap-2'>
              <span>
                {g.kind === 'book' ? `📖 ${g.name}` : g.name}{' '}
                <span className='opacity-60'>
                  (
                  {
                    cards.filter((c) => c.card_group_members.some((m) => m.group_id === g.id))
                      .length
                  }
                  )
                </span>
              </span>
              <button
                type='button'
                className='btn btn-ghost btn-xs'
                onClick={() => {
                  if (window.confirm(_('Delete this group? The cards stay.'))) {
                    void run(() => deleteGroup(g.id));
                  }
                }}
              >
                {_('Delete')}
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={addGroup} className='flex gap-2'>
          <input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            maxLength={200}
            placeholder={customGroups.length ? _('New group') : _('New group (e.g. Languages)')}
            aria-label={_('New group')}
            className='input input-bordered input-sm min-w-0 flex-1'
          />
          <button type='submit' className='btn btn-sm' disabled={!groupName.trim()}>
            {_('Add group')}
          </button>
        </form>
      </section>
    </div>
  );
};

export default CardsManager;
