// Loopback media proxy for streaming audiobook tracks on native platforms.
//
// The WebView's <audio> element enforces the platform's TLS trust, so a track
// from a server with a self-signed certificate never loads. Routing the element
// at a Rust-side loopback proxy that fetches upstream with a lenient client
// fixes that. Native platforms only; on the web there is nothing to bridge.
//
// The proxy is started lazily by the `get_media_proxy_base` command, which
// returns its base (`http://127.0.0.1:<port>/<per-launch secret>`). The command
// only reaches the origins passed to it, so a leaked secret cannot make it an
// open relay.

import { invoke } from '@tauri-apps/api/core';
import { stat } from '@tauri-apps/plugin-fs';
import { getInitializedAppService, isTauriAppPlatform } from '@/services/environment';
import { allowsSelfSignedCert } from '@/utils/tls';

/** A server the proxy may reach. */
export interface MediaProxyGrant {
  /** `scheme://host:port` of the upstream server. */
  origin: string;
  /**
   * `Authorization` header to send there, for a server that authenticates by
   * header rather than by a token in the URL. Held proxy-side, so it never
   * reaches the DOM and a refreshed token leaves the track URL untouched.
   */
  authorization?: string;
  /** The server accepts a self-signed certificate (see `allowsSelfSignedCert`). */
  allowSelfSignedCert?: boolean;
}

/**
 * Base URL of the loopback media proxy, or null where the direct URL is the
 * right one: the web (fetch and media share one TLS policy, nothing to
 * bridge), iOS (its AVPlayer clocks - NativeAudiobookClock and the narration
 * player - take the direct URL), and a proxy that failed to start. Callers
 * then stream directly, as before.
 *
 * `grant` adds one more origin for this call, for a source that is not
 * Audiobookshelf. The allowlist is merged on every call, so granting again
 * with a fresh credential replaces the one it supersedes.
 */
export const getMediaProxyBase = async (grant?: MediaProxyGrant): Promise<string | null> => {
  if (!isTauriAppPlatform() || getInitializedAppService()?.isIOSApp) return null;
  try {
    // A certificate belongs to the origin, so servers sharing one share its
    // policy: an origin verified for any grant stays verified for all of them.
    const origins = new Set<string>();
    const strict = new Set<string>();
    if (grant) {
      origins.add(grant.origin);
      if (!allowsSelfSignedCert(grant)) strict.add(grant.origin);
    }
    const selfSigned = [...origins].filter((origin) => !strict.has(origin));
    const auth = grant?.authorization ? { [grant.origin]: grant.authorization } : undefined;
    return await invoke<string>('get_media_proxy_base', {
      origins: [...origins],
      auth,
      selfSigned,
    });
  } catch (error) {
    console.warn('media proxy unavailable, streaming tracks directly:', error);
    return null;
  }
};

/** The proxied form of an absolute track URL (token query included). */
export const proxiedMediaUrl = (base: string, upstreamUrl: string): string =>
  `${base}/media?u=${encodeURIComponent(upstreamUrl)}`;

/**
 * A loopback URL serving bytes [start, end) of a local file, with `Range`
 * support, so a media element can stream and seek audio stored inside a book
 * without the file being read into the WebView first. Null where there is no
 * proxy (see getMediaProxyBase) or the file is outside the asset scope.
 */
export const getMediaFileUrl = async (
  path: string,
  start: number,
  end: number,
  contentType: string,
): Promise<string | null> => {
  if (!isTauriAppPlatform() || getInitializedAppService()?.isIOSApp) return null;
  try {
    return await invoke<string>('get_media_file_url', { path, start, end, contentType });
  } catch (error) {
    console.warn('media proxy cannot serve the book file:', error);
    return null;
  }
};

/**
 * getMediaFileUrl for a whole local audio file. On desktop the asset protocol
 * answers a range request with at most 1,000 KiB, and macOS WebKit gives up on
 * a recording whose index is bigger than that: a long M4B reports "The
 * operation is not supported" and stays silent (#6848).
 */
export const getLocalMediaUrl = async (
  path: string,
  contentType: string,
): Promise<string | null> => {
  const size = await stat(path).then(
    (info) => info.size,
    () => null,
  );
  return size === null ? null : await getMediaFileUrl(path, 0, size, contentType);
};
