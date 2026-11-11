// Runs only on /later/connect of the user's own server (after lib.js). It tells
// that page the extension is there and passes the token the page creates on to
// the background script. The token goes nowhere else.

(() => {
  const { api, browserName } = globalThis.later;

  const HELLO = 'cognoscimus-later:hello';
  const PRESENT = 'cognoscimus-later:present';
  const TOKEN = 'cognoscimus-later:token';
  const STORED = 'cognoscimus-later:stored';

  const nonce = new URLSearchParams(location.search).get('ext');

  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const type = event.data?.type;
    if (type === HELLO) {
      window.postMessage({ type: PRESENT, name: browserName() }, location.origin);
    } else if (type === TOKEN) {
      let ok = false;
      try {
        ok = await api.runtime.sendMessage({ type: 'store-token', token: event.data.token, nonce });
      } catch {
        ok = false;
      }
      window.postMessage({ type: STORED, ok: ok === true }, location.origin);
    }
  });
})();
