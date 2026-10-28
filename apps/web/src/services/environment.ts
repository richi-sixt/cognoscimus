import { AppService } from '@/types/system';
import { COGNOSCIMUS_NODE_BASE_URL, COGNOSCIMUS_WEB_BASE_URL } from './constants';
import { getRuntimeConfig } from './runtimeConfig';

declare global {
  interface Window {
    __COGNOSCIMUS_CLI_ACCESS?: boolean;
  }
}

export const isWebAppPlatform = () => process.env['NEXT_PUBLIC_APP_PLATFORM'] === 'web';
export const hasCli = () => window.__COGNOSCIMUS_CLI_ACCESS === true;
export const isPWA = () => window.matchMedia('(display-mode: standalone)').matches;
export const getBaseUrl = () =>
  getRuntimeConfig()?.apiBaseUrl ??
  process.env['API_BASE_URL'] ??
  process.env['NEXT_PUBLIC_API_BASE_URL'] ??
  COGNOSCIMUS_WEB_BASE_URL;
export const getNodeBaseUrl = () =>
  process.env['NEXT_PUBLIC_NODE_BASE_URL'] ?? COGNOSCIMUS_NODE_BASE_URL;

export const isMacPlatform = () =>
  typeof window !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export const getCommandPaletteShortcut = () => (isMacPlatform() ? '⌘⇧P' : 'Ctrl+Shift+P');

const isWebDevMode = () => process.env['NODE_ENV'] === 'development' && isWebAppPlatform();

// Dev API only in development mode and web platform
// with command `pnpm dev-web`
// for production build use the production Web API
export const getAPIBaseUrl = () => (isWebDevMode() ? '/api' : `${getBaseUrl()}/api`);

// Cognoscimus Voice synthesizes on the production GPU service, which a local dev
// server cannot reach: its routes use the production Web API even under
// `pnpm dev-web` (a self-hosted apiBaseUrl still applies).
export const getCognoscimusVoiceAPIBaseUrl = () => `${getBaseUrl()}/api`;

// For Node.js API that currently not supported in some edge runtimes
export const getNodeAPIBaseUrl = () => (isWebDevMode() ? '/api' : `${getNodeBaseUrl()}/api`);

export interface EnvConfigType {
  getAppService: () => Promise<AppService>;
}

let webAppService: AppService | null = null;
const getWebAppService = async () => {
  if (!webAppService) {
    const { WebAppService } = await import('@/services/webAppService');
    const service = new WebAppService();
    await service.init();
    webAppService = service;
  }
  return webAppService;
};

const environmentConfig: EnvConfigType = {
  getAppService: async () => getWebAppService(),
};

/**
 * Synchronously returns the app service if it has already been created by
 * {@link environmentConfig.getAppService}; null before first init. The async
 * getter is preferred everywhere — use this only from synchronous code paths
 * that run well after startup (e.g. capability checks during reader render),
 * where the singleton is guaranteed to exist.
 */
export const getInitializedAppService = (): AppService | null => webAppService;

export default environmentConfig;
