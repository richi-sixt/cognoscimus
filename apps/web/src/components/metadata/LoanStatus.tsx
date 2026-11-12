import React, { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { type BookLoan, getOpenLoan, lendBook, returnLoan } from '@/libs/loans';

const day = (iso: string) => new Date(iso).toLocaleDateString();

/**
 * Who has the printed copy of a book: shows the open loan with a button for
 * its return, or a small form to note a new one. Needs an account, because
 * loans live on the server; it stays hidden when they cannot be read.
 */
const LoanStatus: React.FC<{ bookHash: string }> = ({ bookHash }) => {
  const _ = useTranslation();
  const { user } = useAuth();
  const [loan, setLoan] = useState<BookLoan | null>(null);
  const [ready, setReady] = useState(false);
  const [lending, setLending] = useState(false);
  const [name, setName] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setReady(false);
    setLending(false);
    setError(null);
    if (!user) return;
    getOpenLoan(user.id, bookHash)
      .then((found) => {
        if (!current) return;
        setLoan(found);
        setReady(true);
      })
      .catch(() => {
        // Loans are not set up on this server (yet): show nothing.
      });
    return () => {
      current = false;
    };
  }, [user, bookHash]);

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? _(err.message) : _('Something went wrong'));
    } finally {
      setBusy(false);
    }
  };

  const lend = () =>
    run(async () => {
      const saved = await lendBook({
        bookHash,
        borrowerName: name,
        ...(dueDate ? { dueDate } : {}),
      });
      setLoan(saved);
      setLending(false);
      setName('');
      setDueDate('');
    });

  const takeBack = () =>
    run(async () => {
      if (!loan) return;
      await returnLoan(loan.id);
      setLoan(null);
    });

  if (!user || !ready) return null;

  return (
    <div className='flex flex-col gap-2'>
      {loan ? (
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <span>
            {loan.due_at
              ? _('Lent to {{name}} since {{date}}, back by {{due}}', {
                  name: loan.borrower_name,
                  date: day(loan.lent_at),
                  due: day(loan.due_at),
                })
              : _('Lent to {{name}} since {{date}}', {
                  name: loan.borrower_name,
                  date: day(loan.lent_at),
                })}
          </span>
          <button
            type='button'
            className='btn btn-xs'
            disabled={busy}
            onClick={() => void takeBack()}
          >
            {_('It is back')}
          </button>
        </div>
      ) : lending ? (
        <form
          className='flex flex-wrap items-end gap-2'
          onSubmit={(event) => {
            event.preventDefault();
            void lend();
          }}
        >
          <label className='flex min-w-0 flex-1 flex-col gap-1'>
            <span className='text-base-content/70 text-xs'>{_('Lent to')}</span>
            <input
              type='text'
              autoFocus
              className='input input-sm input-bordered w-full'
              value={name}
              maxLength={80}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className='flex flex-col gap-1'>
            <span className='text-base-content/70 text-xs'>{_('Back by (optional)')}</span>
            <input
              type='date'
              className='input input-sm input-bordered'
              value={dueDate}
              disabled={busy}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </label>
          <button type='submit' className='btn btn-primary btn-sm' disabled={busy || !name.trim()}>
            {_('Save')}
          </button>
          <button
            type='button'
            className='btn btn-ghost btn-sm'
            disabled={busy}
            onClick={() => setLending(false)}
          >
            {_('Cancel')}
          </button>
        </form>
      ) : (
        <button type='button' className='btn btn-xs w-fit' onClick={() => setLending(true)}>
          {_('Lend it to someone')}
        </button>
      )}
      {error && (
        <p className='text-error text-xs' role='alert'>
          {error}
        </p>
      )}
    </div>
  );
};

export default LoanStatus;
