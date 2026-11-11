# Cognoscimus Later: browser extension

Saves the current page or a link to Later on your own Cognoscimus server. The
toolbar button opens a small panel: the page is saved at once, and you can add
a note, pick a collection and set labels.

The page is sent as the browser shows it, so pages behind a login or a paywall
keep their text. That happens only when you click, only for that tab, and the
content goes nowhere but to your server, which extracts and sanitises it like a
page it fetched itself.

There is no build step. The folder is the extension. Chrome, Brave, Edge and
Firefox are supported; Safari is not tested.

## Setup

1. Load the extension (see below).
2. Open its options, enter the address of your server (for example
   `https://books.example.com`) and allow access to it. The extension talks to
   no other site.
3. Click "Connect". Your server opens; sign in if needed and confirm. The
   server creates a token for the extension and hands it over.

The token is valid for saving to Later only: saving a link, reading the names
of your collections and labels, and setting an item's note, collection and
labels. It cannot read your library or touch your account. It stays in this
browser and is not synced. Remove it with "Disconnect" in the options, or in
the Later settings on the server.

## Use

- Toolbar button or `Alt+Shift+L`: save the page and open the panel.
- Context menu "Save to Later" on a page or a link: save without the panel; the
  button shows a check mark, or an exclamation mark if it failed.

## Chrome, Brave, Edge

1. Open `chrome://extensions` and switch on "Developer mode".
2. "Load unpacked" and choose this folder.

## Firefox

Try it out (gone after a restart): open `about:debugging#/runtime/this-firefox`,
"Load Temporary Add-on" and choose `manifest.json`.

To keep it, Firefox needs a signed file. Signing for your own use is free and
does not list the extension publicly:

    npx web-ext sign --source-dir . --channel unlisted --api-key <key> --api-secret <secret>

The key and secret come from your account at addons.mozilla.org. Change the
`gecko.id` in `manifest.json` to an id of your own first.

## Permissions

- `activeTab`, `scripting`: read the page in the tab you click on.
- `contextMenus`: the "Save to Later" entry.
- `storage`: the server address and the token.
- Access to your server (asked for when you save its address): send what you
  save, and receive the token on the connect page.

## Limits

- A link saved from the context menu is fetched by the server, so content behind
  a login or a paywall is saved as a link only. The same goes for pages larger
  than 2 MB after scripts and styles are removed.
- Images that only load when signed in are missing in the reader: the address
  is stored, not the image.
- Browser pages such as `chrome://…` cannot be saved.
