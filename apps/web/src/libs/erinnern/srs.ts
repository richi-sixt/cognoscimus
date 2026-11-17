import { type Card, type Grade, Rating, State, createEmptyCard, fsrs } from 'ts-fsrs';

// Spaced repetition (verteiltes Wiederholen) with FSRS. The scheduler decides
// from the answer (again / hard / good / easy) when a card is due next.

export const GRADES = [
  { grade: Rating.Again, key: 'again' },
  { grade: Rating.Hard, key: 'hard' },
  { grade: Rating.Good, key: 'good' },
  { grade: Rating.Easy, key: 'easy' },
] as const;

/** The scheduling columns of a `cards` row. */
export interface SrsFields {
  due_at: string;
  stability: number;
  difficulty: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review_at: string | null;
}

const scheduler = fsrs();

const toCard = (row: SrsFields): Card => ({
  due: new Date(row.due_at),
  stability: row.stability,
  difficulty: row.difficulty,
  elapsed_days: 0,
  scheduled_days: row.scheduled_days,
  learning_steps: row.learning_steps,
  reps: row.reps,
  lapses: row.lapses,
  state: row.state as State,
  last_review: row.last_review_at ? new Date(row.last_review_at) : undefined,
});

const toFields = (card: Card): SrsFields => ({
  due_at: card.due.toISOString(),
  stability: card.stability,
  difficulty: card.difficulty,
  scheduled_days: card.scheduled_days,
  learning_steps: card.learning_steps,
  reps: card.reps,
  lapses: card.lapses,
  state: card.state,
  last_review_at: card.last_review ? card.last_review.toISOString() : null,
});

/** The fields of a card that has never been learned. */
export const newCardFields = (now = new Date()): SrsFields => toFields(createEmptyCard(now));

/** The card's new schedule after `grade`. */
export const reviewCard = (row: SrsFields, grade: Grade, now = new Date()): SrsFields =>
  toFields(scheduler.next(toCard(row), now, grade).card);

/** When the card would be due after each answer, for the labels on the buttons. */
export const previewIntervals = (row: SrsFields, now = new Date()): Record<Grade, Date> => {
  const log = scheduler.repeat(toCard(row), now);
  return {
    [Rating.Again]: log[Rating.Again].card.due,
    [Rating.Hard]: log[Rating.Hard].card.due,
    [Rating.Good]: log[Rating.Good].card.due,
    [Rating.Easy]: log[Rating.Easy].card.due,
  };
};

/** "10 min", "3 d", "2 mo": a short length of time from `now` to `due`. */
export const formatInterval = (due: Date, now = new Date()): string => {
  const minutes = Math.max(1, Math.round((due.getTime() - now.getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} mo`;
  return `${Math.round((months / 12) * 10) / 10} y`;
};

export const isDue = (row: Pick<SrsFields, 'due_at'>, now = new Date()): boolean =>
  new Date(row.due_at).getTime() <= now.getTime();
