# Cognoscimus Later: browser extension

Saves the current page or a link to Later. The extension opens
`/later/add?url=…` on your own server in a small window; that page saves the
link and asks you to sign in if needed. The extension holds no token.

When you save the page in the current tab, the extension also reads its HTML as
the browser shows it and hands it to that window, so pages behind a login or a
paywall keep their text. This happens only on your click, only for that tab,
and the HTML goes nowhere but to your server, which extracts and sanitises it
like a page it fetched itself.

There is no build step. The folder is the extension.

## Setup

After loading, open the extension's options and enter the address of your
server (for example `https://books.example.com`). Saving the address asks for
access to that server; the extension needs it to hand over the page. If you
decline, only the link is sent and the server fetches the page itself.

Use the toolbar button, the context menu entry "Save to Later" (on a page or a
link) or the shortcut `Alt+Shift+L`.

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

## Safari (macOS)

    xcrun safari-web-extension-converter . --project-location ../extension-safari --macos-only

Build and run the generated app in Xcode, then switch the extension on in
Safari's settings. Without a paid developer account, "Allow unsigned
extensions" (Develop menu) has to be set again after each Safari restart.

## Limits

- A link saved from the context menu is fetched by the server, so content behind
  a login or a paywall is saved as a link only. The same goes for pages larger
  than 2 MB after scripts and styles are removed, and for Safari, where the
  hand-over is not tested.
- Images that only load when signed in are missing in the reader: the address
  is stored, not the image.
- Browser pages such as `chrome://…` cannot be saved.
