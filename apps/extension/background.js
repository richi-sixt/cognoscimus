// Saves from the context menu without opening anything, and takes the token
// from the connect page. The toolbar button opens the popup (popup.js), which
// saves the current page itself.

// Chrome runs this file alone as a service worker; Firefox loads lib.js first.
if (typeof importScripts === 'function') importScripts('lib.js');

const { api, t, getServer, getToken, setToken, isWebUrl, capture, request } = globalThis.later;

const MENU_ID = 'save-to-later';
const TOKEN_RE = /^cgl_[A-Za-z0-9_-]{43}$/;
const CONNECT_MAX_AGE_MS = 15 * 60 * 1000;

// Shows the outcome on the toolbar button for a moment.
const flagTab = async (tabId, text) => {
  if (tabId === undefined) return;
  await api.action.setBadgeText({ text, tabId });
  setTimeout(() => void api.action.setBadgeText({ text: '', tabId }), 3000);
};

// `ownPage` is true when the page in the tab is saved, not a link on it; only
// then the visible HTML goes along.
const saveQuietly = async (url, tab, ownPage) => {
  if (!url || !isWebUrl(url)) return flagTab(tab?.id, '!');
  if (!(await getServer()) || !(await getToken())) return api.runtime.openOptionsPage();
  const html = ownPage && tab?.id !== undefined ? await capture(tab.id, url) : null;
  try {
    await request('/save', { method: 'POST', body: { url, html: html ?? undefined } });
    await flagTab(tab?.id, '✓');
  } catch (error) {
    await flagTab(tab?.id, '!');
    if (error?.status === 401) await api.runtime.openOptionsPage();
  }
};

// Accepts the token only from the connect page of the configured server, and
// only for a connect request this extension started.
const storeToken = async (message, sender) => {
  const server = await getServer();
  if (!server || !sender.url) return false;
  const page = new URL(sender.url);
  if (page.origin !== server || !page.pathname.startsWith('/later/connect')) return false;
  const { connect } = await api.storage.session.get('connect');
  if (!connect || connect.nonce !== message.nonce) return false;
  if (Date.now() - connect.at > CONNECT_MAX_AGE_MS) return false;
  if (typeof message.token !== 'string' || !TOKEN_RE.test(message.token)) return false;
  await setToken(message.token);
  await api.storage.session.remove('connect');
  return true;
};

api.runtime.onInstalled.addListener(async () => {
  await api.contextMenus.removeAll();
  api.contextMenus.create({ id: MENU_ID, title: t('save'), contexts: ['page', 'link'] });
  if (!(await getServer())) await api.runtime.openOptionsPage();
});

api.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  if (info.linkUrl) void saveQuietly(info.linkUrl, tab, false);
  else void saveQuietly(tab?.url || info.pageUrl, tab, true);
});

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'store-token' || sender.id !== api.runtime.id) return undefined;
  storeToken(message, sender).then(sendResponse, () => sendResponse(false));
  return true;
});
