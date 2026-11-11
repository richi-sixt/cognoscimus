// Helpers shared by the background script, the popup, the options page and the
// content script. Loaded as a plain script, so everything hangs off one global.

(() => {
  const api = globalThis.browser ?? globalThis.chrome;

  const HANDOVER_ID = 'handover';
  // The server accepts no more; larger pages are fetched by the server instead.
  const CAPTURE_MAX = 2 * 1024 * 1024;

  const t = (key) => api.i18n.getMessage(key);

  const getServer = async () => {
    const { server } = await api.storage.sync.get('server');
    return typeof server === 'string' ? server : '';
  };

  // The token stays on this device: it is not synced with the browser account.
  const getToken = async () => {
    const { token } = await api.storage.local.get('token');
    return typeof token === 'string' ? token : '';
  };
  const setToken = (token) => api.storage.local.set({ token });
  const clearToken = () => api.storage.local.remove('token');

  const isWebUrl = (value) => {
    try {
      const { protocol } = new URL(value);
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  };

  // Match patterns carry no port, so permission and content script cover the host.
  const hostBase = (server) => {
    const { protocol, hostname } = new URL(server);
    return `${protocol}//${hostname}`;
  };

  /** Whether the user allowed access to the server; requests to it need that. */
  const hasAccess = async (server) => {
    try {
      return await api.permissions.contains({ origins: [`${hostBase(server)}/*`] });
    } catch {
      return false;
    }
  };

  // Keeps the content script on /later/connect in step with the server address.
  const syncHandover = async (server) => {
    try {
      const matches = [`${hostBase(server)}/later/connect*`];
      const granted = await hasAccess(server);
      const [current] = await api.scripting.getRegisteredContentScripts({ ids: [HANDOVER_ID] });
      if (current && (!granted || current.matches?.join() !== matches.join())) {
        await api.scripting.unregisterContentScripts({ ids: [HANDOVER_ID] });
      } else if (current) {
        return true;
      }
      if (!granted) return false;
      await api.scripting.registerContentScripts([
        { id: HANDOVER_ID, matches, js: ['lib.js', 'handover.js'], runAt: 'document_start' },
      ]);
      return true;
    } catch {
      return false;
    }
  };

  // Runs inside the page. Scripts, styles and embedded frames are of no use to
  // the reader and are left out to keep the size down; structured data stays
  // because it carries title and author.
  const readPage = () => {
    const copy = document.documentElement.cloneNode(true);
    const drop =
      'script:not([type="application/ld+json"]), style, svg, iframe, noscript, link, template';
    for (const node of copy.querySelectorAll(drop)) node.remove();
    return { url: location.href, html: `<!doctype html>${copy.outerHTML}` };
  };

  // The HTML of the tab as the browser shows it, or null when it cannot be read,
  // is too large or the tab has moved on to another page.
  const capture = async (tabId, url) => {
    try {
      const [injection] = await api.scripting.executeScript({ target: { tabId }, func: readPage });
      const page = injection?.result;
      if (!page || page.url !== url || typeof page.html !== 'string') return null;
      return page.html.length <= CAPTURE_MAX ? page.html : null;
    } catch {
      return null;
    }
  };

  class ApiError extends Error {
    constructor(status, code, message) {
      super(message || 'Request failed');
      this.status = status;
      this.code = code;
    }
  }

  // Calls a Later route on the user's server with the extension's token. No
  // cookies are sent. A refused token is forgotten, so the user is asked to
  // connect again.
  const request = async (path, { method = 'GET', body } = {}) => {
    const [server, token] = await Promise.all([getServer(), getToken()]);
    if (!server || !token) throw new ApiError(401, 'not_connected');
    const response = await fetch(`${server}/api/later${path}`, {
      method,
      cache: 'no-store',
      credentials: 'omit',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body && { 'Content-Type': 'application/json' }),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) await clearToken();
    if (!response.ok) throw new ApiError(response.status, data.code, data.error);
    return data;
  };

  // Opens the connect page on the server. The random value ties the token that
  // comes back to this request.
  const startConnect = async () => {
    const server = await getServer();
    if (!server || !(await syncHandover(server))) return false;
    const nonce = crypto.randomUUID();
    await api.storage.session.set({ connect: { nonce, at: Date.now() } });
    await api.tabs.create({ url: `${server}/later/connect?ext=${nonce}` });
    return true;
  };

  const browserName = () => {
    const agent = navigator.userAgent;
    if (agent.includes('Firefox/')) return 'Firefox';
    if (agent.includes('Edg/')) return 'Edge';
    if (navigator.brave) return 'Brave';
    if (agent.includes('Chrome/')) return 'Chrome';
    return 'Browser';
  };

  globalThis.later = {
    api,
    t,
    getServer,
    getToken,
    setToken,
    clearToken,
    isWebUrl,
    hostBase,
    hasAccess,
    capture,
    request,
    startConnect,
    browserName,
  };
})();
