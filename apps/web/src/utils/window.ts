import { AppService } from '@/types/system';

// Fullscreen is the browser's Fullscreen API: on a phone there is no F11 to
// reach it otherwise (#6892).
export const canToggleFullScreen = (appService: AppService | null) =>
  appService?.appPlatform === 'web' && !!document.fullscreenEnabled;

export const toggleFullScreen = async () => {
  try {
    // Requested before any await, while the tap still counts as user activation.
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (error) {
    console.warn('Failed to toggle fullscreen:', error);
  }
};
