import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  EphemeralPassphraseStore,
  __resetPassphraseStoreForTests,
  createPassphraseStore,
} from '@/libs/crypto/passphrase';

beforeEach(() => {
  __resetPassphraseStoreForTests();
});

afterEach(() => {
  __resetPassphraseStoreForTests();
});

describe('EphemeralPassphraseStore', () => {
  test('set then get returns the same passphrase', async () => {
    const store = new EphemeralPassphraseStore();
    await store.set('correct horse battery staple');
    expect(await store.get()).toBe('correct horse battery staple');
  });

  test('initial state: get returns null', async () => {
    const store = new EphemeralPassphraseStore();
    expect(await store.get()).toBe(null);
  });

  test('clear empties the store', async () => {
    const store = new EphemeralPassphraseStore();
    await store.set('abc');
    await store.clear();
    expect(await store.get()).toBe(null);
  });

  test('isAvailable returns true (always)', () => {
    const store = new EphemeralPassphraseStore();
    expect(store.isAvailable()).toBe(true);
  });

  test('two instances are independent (per-tab semantic)', async () => {
    const a = new EphemeralPassphraseStore();
    const b = new EphemeralPassphraseStore();
    await a.set('alpha');
    await b.set('beta');
    expect(await a.get()).toBe('alpha');
    expect(await b.get()).toBe('beta');
  });

  test('set replaces previous value', async () => {
    const store = new EphemeralPassphraseStore();
    await store.set('first');
    await store.set('second');
    expect(await store.get()).toBe('second');
  });
});

describe('createPassphraseStore', () => {
  test('returns one shared ephemeral store', () => {
    const store = createPassphraseStore();
    expect(store).toBeInstanceOf(EphemeralPassphraseStore);
    expect(createPassphraseStore()).toBe(store);
  });
});
