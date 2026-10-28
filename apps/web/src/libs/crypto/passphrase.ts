export interface PassphraseStore {
  set(passphrase: string): Promise<void>;
  get(): Promise<string | null>;
  clear(): Promise<void>;
  isAvailable(): boolean;
}

/**
 * In-memory passphrase store. Lifetime is "this page load" — every
 * hard refresh wipes it. This is the default on web; the cipher
 * fingerprint heuristic in replicaPullAndApply.applyRow makes sure a
 * fresh page doesn't re-prompt on pull as long as the local copy's
 * lastSeenCipher matches the row's incoming cipher.
 *
 * The only path that still re-prompts after refresh is adding a new
 * credentialed catalog (the encrypt path needs an unlocked session).
 * That's an infrequent action; not worth the XSS surface of
 * persisting the passphrase to localStorage / sessionStorage.
 *
 */
export class EphemeralPassphraseStore implements PassphraseStore {
  private value: string | null = null;

  async set(passphrase: string): Promise<void> {
    this.value = passphrase;
  }

  async get(): Promise<string | null> {
    return this.value;
  }

  async clear(): Promise<void> {
    this.value = null;
  }

  isAvailable(): boolean {
    return true;
  }
}

let cached: PassphraseStore | null = null;

export const createPassphraseStore = (): PassphraseStore => {
  if (cached) return cached;
  cached = new EphemeralPassphraseStore();
  return cached;
};

/** Test seam — reset the cached backend between specs. */
export const __resetPassphraseStoreForTests = (): void => {
  cached = null;
};
