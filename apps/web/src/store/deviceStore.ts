import { create } from 'zustand';

// The browser has no native device to control: no hardware keys to intercept
// and no system brightness to set. The store keeps its shape so the reader
// code that asks for those things stays unchanged, and every action is a no-op.

type DeviceControlState = {
  volumeKeysIntercepted: boolean;
  backKeyIntercepted: boolean;
  volumeKeysInterceptionCount: number;
  backKeyInterceptionCount: number;
  getScreenBrightness: () => Promise<number>; // 0.0 to 1.0
  // brightness: 0.0 to 1.0. `persist` writes through to the system brightness
  // (system mode) instead of a reader-only override handed back on background.
  setScreenBrightness: (brightness: number, persist?: boolean) => Promise<void>;
  lastScreenBrightness: number | null; // 0.0 to 1.0, null once released
  syncScreenBrightness: () => Promise<void>;
  acquireVolumeKeyInterception: () => void;
  releaseVolumeKeyInterception: () => void;
  acquireBackKeyInterception: () => void;
  releaseBackKeyInterception: () => void;
  pageTurnerKeysIntercepted: boolean;
  pageTurnerKeysInterceptionCount: number;
  acquirePageTurnerKeyInterception: () => void;
  releasePageTurnerKeyInterception: () => void;
  setKeyLearnMode: (enabled: boolean) => void;
  ensureKeyForwarding: () => void;
  listenToNativeTouchEvents: () => void;
};

export const useDeviceControlStore = create<DeviceControlState>((set) => ({
  lastScreenBrightness: null,
  volumeKeysIntercepted: false,
  backKeyIntercepted: false,
  volumeKeysInterceptionCount: 0,
  backKeyInterceptionCount: 0,
  pageTurnerKeysIntercepted: false,
  pageTurnerKeysInterceptionCount: 0,

  acquireVolumeKeyInterception: () => {},
  releaseVolumeKeyInterception: () => {},
  acquireBackKeyInterception: () => {},
  releaseBackKeyInterception: () => {},
  acquirePageTurnerKeyInterception: () => {},
  releasePageTurnerKeyInterception: () => {},
  setKeyLearnMode: () => {},
  ensureKeyForwarding: () => {},
  listenToNativeTouchEvents: () => {},

  getScreenBrightness: async () => 1,
  setScreenBrightness: async (brightness: number) => {
    set({ lastScreenBrightness: brightness >= 0 ? brightness : null });
  },
  syncScreenBrightness: async () => {},
}));
