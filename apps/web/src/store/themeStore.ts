import { create } from 'zustand';
import { AppService } from '@/types/system';
import { getThemeCode, ThemeCode } from '@/utils/style';
import {
  isValidThemeMode,
  readStoredAmbientIsDarkMode,
  resolveThemeIsDarkMode,
} from '@/utils/ambientLight';
import { CustomTheme, Palette, ThemeMode, ThemeScope } from '@/styles/themes';
import { EnvConfigType, isWebAppPlatform } from '@/services/environment';
import { SystemSettings } from '@/types/settings';
import { Insets } from '@/types/misc';
import { StatusBarHiddenInsets } from '@/utils/insets';

declare global {
  interface Window {
    __COGNOSCIMUS_IS_EINK?: boolean;
  }
}

interface ThemeState {
  /**
   * The theme currently painted on screen — the resolved values for
   * `themeScope`, not raw storage. Everything that just wants to know "what
   * does the UI look like right now" reads these (issue #5945).
   */
  themeMode: ThemeMode;
  themeColor: string;
  /** Which page's theme is applied. Every non-reader route is 'library'. */
  themeScope: ThemeScope;
  /**
   * The reader pair, persisted under the original `themeMode`/`themeColor`
   * keys. `getThemeCode` reads those same keys, so book content and reader
   * overlays follow this pair without any coupling to the scope machinery.
   */
  readerThemeMode: ThemeMode;
  readerThemeColor: string;
  /**
   * Library overrides; null means "inherit the reader pair", exactly like the
   * undefined `libraryBackgroundTextureId` fields (#4743). Absent until the
   * user picks a library value in Settings → Theme, so an upgrade changes
   * nothing about how the app looks or how the quick toggles behave.
   */
  libraryThemeMode: ThemeMode | null;
  libraryThemeColor: string | null;
  systemIsDarkMode: boolean;
  ambientIsDarkMode: boolean;
  themeCode: ThemeCode;
  isDarkMode: boolean;
  systemUIVisible: boolean;
  statusBarHeight: number;
  systemUIAlwaysHidden: boolean;
  safeAreaInsets: Insets | null;
  // iPhone Duo: side insets seen with the status bar hidden; the reading page
  // keeps them while the toolbar shows the status bar (see getReadingScreenInsets).
  statusBarHiddenInsets: StatusBarHiddenInsets | null;
  // Radius (px) of the rounded bottom screen corners, 0 when unknown.
  screenCornerRadius: number;
  // iPhone Duo, whose vertical status strip is a large left/right inset (#6307).
  // Every horizontal-inset rule is gated on it, so no other device changes.
  isIPhoneDuo: boolean;
  isRoundedWindow: boolean;
  setSystemUIAlwaysHidden: (hidden: boolean) => void;
  setStatusBarHeight: (height: number) => void;
  showSystemUI: () => void;
  dismissSystemUI: () => void;
  getIsDarkMode: () => boolean;
  setThemeMode: (mode: ThemeMode) => void;
  setThemeColor: (color: string) => void;
  setThemeScope: (scope: ThemeScope) => void;
  setScopedThemeMode: (scope: ThemeScope, mode: ThemeMode) => void;
  setScopedThemeColor: (scope: ThemeScope, color: string) => void;
  getScopedTheme: (scope: ThemeScope) => { themeMode: ThemeMode; themeColor: string };
  resetThemeScopes: () => void;
  updateAppTheme: (color: keyof Palette) => void;
  saveCustomTheme: (
    envConfig: EnvConfigType,
    settings: SystemSettings,
    theme: CustomTheme,
    isDelete?: boolean,
  ) => void;
  handleSystemThemeChange: (isDark: boolean) => void;
  updateSafeAreaInsets: (insets: Insets) => void;
  recordStatusBarHiddenInsets: (insets: Insets) => void;
  updateScreenCornerRadius: (radius: number) => void;
  setIsIPhoneDuo: (isIPhoneDuo: boolean) => void;
}

const LIBRARY_THEME_MODE_KEY = 'libraryThemeMode';
const LIBRARY_THEME_COLOR_KEY = 'libraryThemeColor';

const getInitialThemeMode = (): ThemeMode => {
  if (typeof window !== 'undefined' && localStorage) {
    const stored = localStorage.getItem('themeMode');
    if (isValidThemeMode(stored)) return stored;
  }
  return 'auto';
};

const getInitialThemeColor = (): string => {
  if (typeof window !== 'undefined' && localStorage) {
    const defaultColor = window.__COGNOSCIMUS_IS_EINK ? 'contrast' : 'default';
    return localStorage.getItem('themeColor') || defaultColor;
  }
  return 'default';
};

const getInitialLibraryThemeMode = (): ThemeMode | null => {
  if (typeof window !== 'undefined' && localStorage) {
    const stored = localStorage.getItem(LIBRARY_THEME_MODE_KEY);
    if (isValidThemeMode(stored)) return stored;
  }
  return null;
};

const getInitialLibraryThemeColor = (): string | null => {
  if (typeof window !== 'undefined' && localStorage) {
    return localStorage.getItem(LIBRARY_THEME_COLOR_KEY) || null;
  }
  return null;
};

const getInitialAmbientIsDarkMode = (systemIsDarkMode: boolean): boolean => {
  if (typeof window !== 'undefined' && localStorage) {
    return readStoredAmbientIsDarkMode(localStorage.getItem('ambientIsDarkMode'), systemIsDarkMode);
  }
  return systemIsDarkMode;
};

const applyDataTheme = (themeColor: string, isDarkMode: boolean) => {
  document.documentElement.setAttribute(
    'data-theme',
    `${themeColor}-${isDarkMode ? 'dark' : 'light'}`,
  );
};

/**
 * Resolve one scope's pair from the raw stored values. The reader pair is the
 * base; the library falls back to it per field, so a user who only overrides
 * the mode keeps following the reader's color.
 */
const resolveScopedTheme = (
  scope: ThemeScope,
  raw: Pick<
    ThemeState,
    'readerThemeMode' | 'readerThemeColor' | 'libraryThemeMode' | 'libraryThemeColor'
  >,
): { themeMode: ThemeMode; themeColor: string } => {
  if (scope === 'reader') {
    return { themeMode: raw.readerThemeMode, themeColor: raw.readerThemeColor };
  }
  return {
    themeMode: raw.libraryThemeMode ?? raw.readerThemeMode,
    themeColor: raw.libraryThemeColor ?? raw.readerThemeColor,
  };
};

/**
 * The reader owns `/reader`; everything else (library, settings, OPDS, player,
 * auth) shares the library scope so no route paints a third look.
 */
export const getThemeScopeForPath = (pathname?: string): ThemeScope => {
  const path = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '');
  return path.startsWith('/reader') ? 'reader' : 'library';
};

export const useThemeStore = create<ThemeState>((set, get) => {
  const initialThemeMode = getInitialThemeMode();
  const initialThemeColor = getInitialThemeColor();
  const initialLibraryThemeMode = getInitialLibraryThemeMode();
  const initialLibraryThemeColor = getInitialLibraryThemeColor();
  const systemIsDarkMode =
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const ambientIsDarkMode = getInitialAmbientIsDarkMode(systemIsDarkMode);
  const initialScope = getThemeScopeForPath();
  const initialEffective = resolveScopedTheme(initialScope, {
    readerThemeMode: initialThemeMode,
    readerThemeColor: initialThemeColor,
    libraryThemeMode: initialLibraryThemeMode,
    libraryThemeColor: initialLibraryThemeColor,
  });
  const isDarkMode = resolveThemeIsDarkMode(
    initialEffective.themeMode,
    systemIsDarkMode,
    ambientIsDarkMode,
  );
  const themeCode = getThemeCode();

  /**
   * Recompute the active scope's pair after a change and paint it. Writes that
   * land on the scope the user is NOT looking at resolve to the same effective
   * values, so this is a no-op repaint for them — which is what keeps editing
   * the library theme from repainting an open book (the rule the background
   * texture scope already follows, #4743).
   *
   * `refreshThemeCode` is set only when the reader pair or the system/ambient
   * flags moved. `themeCode` feeds the CSS injected into the book iframe, and
   * handing it a fresh object identity re-runs the reader's style effects.
   */
  const applyActiveScope = (patch: Partial<ThemeState>, refreshThemeCode: boolean) => {
    const next = { ...get(), ...patch };
    const effective = resolveScopedTheme(next.themeScope, next);
    const nextIsDarkMode = resolveThemeIsDarkMode(
      effective.themeMode,
      next.systemIsDarkMode,
      next.ambientIsDarkMode,
    );
    applyDataTheme(effective.themeColor, nextIsDarkMode);
    set({
      ...patch,
      themeMode: effective.themeMode,
      themeColor: effective.themeColor,
      isDarkMode: nextIsDarkMode,
      ...(refreshThemeCode ? { themeCode: getThemeCode() } : {}),
    });
    return effective.themeMode;
  };

  return {
    themeMode: initialEffective.themeMode,
    themeColor: initialEffective.themeColor,
    themeScope: initialScope,
    readerThemeMode: initialThemeMode,
    readerThemeColor: initialThemeColor,
    libraryThemeMode: initialLibraryThemeMode,
    libraryThemeColor: initialLibraryThemeColor,
    systemIsDarkMode,
    ambientIsDarkMode,
    isDarkMode,
    themeCode,
    systemUIVisible: false,
    statusBarHeight: 24,
    systemUIAlwaysHidden: false,
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    statusBarHiddenInsets: null,
    screenCornerRadius: 0,
    isIPhoneDuo: false,
    isRoundedWindow: true,
    showSystemUI: () => set({ systemUIVisible: true }),
    dismissSystemUI: () => set({ systemUIVisible: false }),
    setStatusBarHeight: (height: number) => set({ statusBarHeight: height }),
    setSystemUIAlwaysHidden: (hidden: boolean) => set({ systemUIAlwaysHidden: hidden }),
    getIsDarkMode: () => get().isDarkMode,
    getScopedTheme: (scope) => resolveScopedTheme(scope, get()),
    setThemeScope: (scope) => {
      if (get().themeScope === scope) return;
      applyActiveScope({ themeScope: scope }, false);
    },
    // The quick toggles (library settings menu, reader view menu, reader color
    // panel, command palette) route through here. While the library is still
    // inheriting, a toggle from either page writes the shared reader pair so
    // both pages move together exactly as they did before #5945 — only an
    // explicit library edit in Settings → Theme decouples the two.
    setThemeMode: (mode) => {
      const { themeScope, libraryThemeMode } = get();
      const target: ThemeScope =
        themeScope === 'library' && libraryThemeMode !== null ? 'library' : 'reader';
      get().setScopedThemeMode(target, mode);
    },
    setThemeColor: (color) => {
      const { themeScope, libraryThemeColor } = get();
      const target: ThemeScope =
        themeScope === 'library' && libraryThemeColor !== null ? 'library' : 'reader';
      get().setScopedThemeColor(target, color);
    },
    setScopedThemeMode: (scope, mode) => {
      const isReader = scope === 'reader';
      if (typeof window !== 'undefined' && localStorage) {
        localStorage.setItem(isReader ? 'themeMode' : LIBRARY_THEME_MODE_KEY, mode);
      }
      applyActiveScope(isReader ? { readerThemeMode: mode } : { libraryThemeMode: mode }, isReader);
    },
    setScopedThemeColor: (scope, color) => {
      const isReader = scope === 'reader';
      if (typeof window !== 'undefined' && localStorage) {
        localStorage.setItem(isReader ? 'themeColor' : LIBRARY_THEME_COLOR_KEY, color);
      }
      applyActiveScope(
        isReader ? { readerThemeColor: color } : { libraryThemeColor: color },
        isReader,
      );
    },
    // "Reset to defaults" has to drop the library override too, otherwise a
    // decoupled library keeps its old look and the reset looks broken.
    resetThemeScopes: () => {
      if (typeof window !== 'undefined' && localStorage) {
        localStorage.setItem('themeMode', 'auto');
        localStorage.setItem('themeColor', 'default');
        localStorage.removeItem(LIBRARY_THEME_MODE_KEY);
        localStorage.removeItem(LIBRARY_THEME_COLOR_KEY);
      }
      applyActiveScope(
        {
          readerThemeMode: 'auto',
          readerThemeColor: 'default',
          libraryThemeMode: null,
          libraryThemeColor: null,
        },
        true,
      );
    },
    updateAppTheme: (color) => {
      if (isWebAppPlatform()) {
        const { palette } = get().themeCode;
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', palette[color]);
      }
    },
    saveCustomTheme: async (envConfig, settings, theme, isDelete) => {
      const customThemes = settings.globalReadSettings.customThemes || [];
      const index = customThemes.findIndex((t) => t.name === theme.name);
      if (isDelete) {
        if (index > -1) {
          customThemes.splice(index, 1);
        }
      } else {
        if (index > -1) {
          customThemes[index] = theme;
        } else {
          customThemes.push(theme);
        }
      }
      settings.globalReadSettings.customThemes = customThemes;
      localStorage.setItem('customThemes', JSON.stringify(customThemes));
      const appService = await envConfig.getAppService();
      await appService.saveSettings(settings);
    },
    handleSystemThemeChange: (systemIsDarkMode) => {
      applyActiveScope({ systemIsDarkMode }, true);
    },
    updateSafeAreaInsets: (insets) => {
      set({ safeAreaInsets: insets });
    },
    recordStatusBarHiddenInsets: ({ left, right }) => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const prev = get().statusBarHiddenInsets;
      if (
        prev &&
        prev.width === width &&
        prev.height === height &&
        prev.left === left &&
        prev.right === right
      ) {
        return;
      }
      set({ statusBarHiddenInsets: { width, height, left, right } });
    },
    updateScreenCornerRadius: (radius) => {
      if (get().screenCornerRadius !== radius) set({ screenCornerRadius: radius });
    },
    setIsIPhoneDuo: (isIPhoneDuo) => {
      if (get().isIPhoneDuo !== isIPhoneDuo) set({ isIPhoneDuo });
    },
  };
});

export const loadDataTheme = (scope: ThemeScope = getThemeScopeForPath()) => {
  if (typeof localStorage === 'undefined' || typeof document === 'undefined') return;

  const themeMode = localStorage.getItem('themeMode');
  const themeColor = localStorage.getItem('themeColor');
  const libraryThemeMode = getInitialLibraryThemeMode();
  const libraryThemeColor = getInitialLibraryThemeColor();
  // Nothing configured at all: leave the attribute alone and let useTheme
  // paint the default. A library-only override still counts as configured —
  // decoupling the library writes only its own key, so a user who never
  // touched the reader theme has no reader keys to gate on, and checking
  // those alone would skip the early paint in exactly that case.
  if (!(themeMode && themeColor) && !libraryThemeMode && !libraryThemeColor) return;

  const systemIsDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const ambientIsDarkMode = getInitialAmbientIsDarkMode(systemIsDarkMode);
  const effective = resolveScopedTheme(scope, {
    // Via the same helpers the store initializes from, so an absent reader key
    // resolves to the implicit default rather than a null in the attribute.
    readerThemeMode: getInitialThemeMode(),
    readerThemeColor: getInitialThemeColor(),
    libraryThemeMode,
    libraryThemeColor,
  });
  const isDarkMode = resolveThemeIsDarkMode(
    effective.themeMode,
    systemIsDarkMode,
    ambientIsDarkMode,
  );
  applyDataTheme(effective.themeColor, isDarkMode);
};

export const initSystemThemeListener = (appService: AppService) => {
  if (typeof window === 'undefined' || !appService) return;

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const applySystemTheme = (systemIsDarkMode: boolean) => {
    if (typeof window !== 'undefined' && localStorage) {
      localStorage.setItem('systemIsDarkMode', systemIsDarkMode ? 'true' : 'false');
    }
    useThemeStore.getState().handleSystemThemeChange(systemIsDarkMode);
  };
  const updateColorTheme = () => {
    applySystemTheme(mediaQuery.matches);
  };

  mediaQuery?.addEventListener('change', updateColorTheme);
  document.addEventListener('visibilitychange', updateColorTheme);

  updateColorTheme();

  // Ambient Mode needs a light sensor, which the web has no access to.
  if (useThemeStore.getState().themeMode === 'ambient') {
    useThemeStore.getState().setThemeMode('auto');
  }
};
