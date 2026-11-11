const api = globalThis.browser ?? globalThis.chrome;

const input = document.getElementById('server');
const status = document.getElementById('status');

for (const node of document.querySelectorAll('[data-i18n]')) {
  node.textContent = api.i18n.getMessage(node.dataset.i18n);
}

// Returns the origin of a usable server address, or null. Plain http is only
// accepted for a server on this machine.
const normalize = (value) => {
  try {
    const url = new URL(value.trim());
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol === 'https:' || (url.protocol === 'http:' && local)) return url.origin;
  } catch {
    // Falls through to null.
  }
  return null;
};

api.storage.sync.get('server').then(({ server }) => {
  if (typeof server === 'string') input.value = server;
});

document.getElementById('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const server = normalize(input.value);
  if (!server) {
    status.textContent = api.i18n.getMessage('invalidServer');
    return;
  }
  await api.storage.sync.set({ server });
  input.value = server;
  status.textContent = api.i18n.getMessage('saved');
});
