// Runs only on /later/add of the user's own server. When that page asks for it,
// this fetches the HTML the background script captured and passes it on. The
// page sends it to the server together with the link.

const api = globalThis.browser ?? globalThis.chrome;

const REQUEST = 'cognoscimus-later:request';
const REPLY = 'cognoscimus-later:html';

const key = new URLSearchParams(location.search).get('ext');

window.addEventListener('message', async (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  if (event.data?.type !== REQUEST) return;
  let html = null;
  try {
    if (key) html = await api.runtime.sendMessage({ type: 'take-capture', key });
  } catch {
    // Without an answer the page saves the link alone.
  }
  window.postMessage(
    { type: REPLY, html: typeof html === 'string' ? html : null },
    location.origin,
  );
});
