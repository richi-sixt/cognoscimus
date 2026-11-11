const { api, t, getServer, getToken, clearToken, hostBase, hasAccess, request, startConnect } =
  globalThis.later;

const input = document.getElementById('server');
const status = document.getElementById('status');
const connectionState = document.getElementById('connection-state');
const connectButton = document.getElementById('connect');
const disconnectButton = document.getElementById('disconnect');

for (const node of document.querySelectorAll('[data-i18n]')) {
  node.textContent = t(node.dataset.i18n);
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

const showConnection = async () => {
  const server = await getServer();
  const ready = Boolean(server) && (await hasAccess(server));
  const connected = ready && Boolean(await getToken());
  connectionState.textContent = !ready
    ? t('connectionNeedsServer')
    : connected
      ? t('connected')
      : t('notConnected');
  connectButton.hidden = !ready || connected;
  disconnectButton.hidden = !connected;
};

getServer().then((server) => {
  if (server) input.value = server;
});
void showConnection();
api.storage.onChanged.addListener(() => void showConnection());

document.getElementById('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const server = normalize(input.value);
  if (!server) {
    status.textContent = t('invalidServer');
    return;
  }
  // The extension talks to this server only. Access has to be asked for first,
  // while the click still counts.
  let granted = false;
  try {
    granted = await api.permissions.request({ origins: [`${hostBase(server)}/*`] });
  } catch {
    granted = false;
  }
  // A token belongs to the server that issued it.
  if (server !== (await getServer())) await clearToken();
  await api.storage.sync.set({ server });
  input.value = server;
  status.textContent = t(granted ? 'saved' : 'savedNoAccess');
  await showConnection();
});

connectButton.addEventListener('click', async () => {
  if (!(await startConnect())) connectionState.textContent = t('connectionNeedsServer');
});

// Removes the token on the server too, so it cannot be used any more.
disconnectButton.addEventListener('click', async () => {
  disconnectButton.disabled = true;
  await request('/ext/token', { method: 'DELETE' }).catch(() => undefined);
  await clearToken();
  disconnectButton.disabled = false;
  await showConnection();
});
