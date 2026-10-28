import { useEffect } from 'react';
import { useThemeStore } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSafeAreaInsets } from './useSafeAreaInsets';
import { applyCustomTheme, Palette, ThemeScope } from '@/styles/themes';
import { getOverlayerBlendMode } from '@/utils/style';

type UseThemeProps = {
  /** Has no effect on the web (there is no system UI to show or hide). */
  systemUIVisible?: boolean;
  appThemeColor?: keyof Palette;
  /**
   * Which page's theme this route paints (issue #5945). Only the reader owns
   * its own scope; the library, OPDS, player, auth and user pages all share
   * the library's so no route paints a third look.
   */
  themeScope?: ThemeScope;
};

export const useTheme = ({
  appThemeColor = 'base-100',
  themeScope = 'library',
}: UseThemeProps = {}) => {
  const { settings } = useSettingsStore();
  const isEink = settings?.globalViewSettings?.isEink;
  const isColorEink = settings?.globalViewSettings?.isColorEink;
  const isBwEink = isEink && !isColorEink;
  const highlightOpacity = settings?.globalViewSettings?.highlightOpacity ?? 0.4;
  const { themeColor, isDarkMode, updateAppTheme, setThemeScope } = useThemeStore();
  useSafeAreaInsets();

  // Point the store at this route's scope. `themeColor`/`isDarkMode` below
  // are the resolved values for whichever scope is active, so the data-theme
  // effect repaints for free when the user moves between library and reader.
  useEffect(() => {
    setThemeScope(themeScope);
  }, [themeScope, setThemeScope]);

  useEffect(() => {
    updateAppTheme(appThemeColor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const customThemes = settings.globalReadSettings?.customThemes ?? [];
    customThemes.forEach((customTheme) => {
      applyCustomTheme(customTheme);
    });
    localStorage.setItem('customThemes', JSON.stringify(customThemes));
  }, [settings.globalReadSettings?.customThemes]);

  useEffect(() => {
    const colorScheme = isDarkMode ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', `${themeColor}-${colorScheme}`);
    document.documentElement.style.setProperty('color-scheme', colorScheme);
    document.documentElement.style.setProperty('--scroll-bg-opacity', isBwEink ? '1.0' : '0.5');
    document.documentElement.style.setProperty(
      '--overlayer-highlight-opacity',
      isBwEink ? '1.0' : String(highlightOpacity),
    );
    // The global default assumes a page painted in the theme colors. Books that
    // keep their own page (PDFs, comics) override it per view in FoliateViewer.
    document.documentElement.style.setProperty(
      '--overlayer-highlight-blend-mode',
      getOverlayerBlendMode({ isDarkMode, isBwEink: !!isBwEink }),
    );
    document.documentElement.style.setProperty(
      '--bg-texture-blend-mode',
      isDarkMode ? 'lighten' : 'multiply',
    );
  }, [themeColor, isDarkMode, isBwEink, highlightOpacity]);
};
