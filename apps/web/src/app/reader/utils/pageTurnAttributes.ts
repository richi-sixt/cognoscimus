import type { ViewSettings } from '@/types/book';
import type { FoliateView } from '@/types/view';
import { detectViewTransitionGroup } from '@/utils/viewTransition';

/**
 * Single source of truth for the page-turn renderer attributes. Layered
 * `turn-style` values are withheld from engines without full View Transitions
 * support — iOS 18 WebKit crashes on them — leaving those on push.
 */
export const applyPageTurnAttributes = (view: FoliateView, viewSettings: ViewSettings) => {
  const style = viewSettings.pageTurnStyle;
  if (style && style !== 'push' && detectViewTransitionGroup()) {
    view.renderer.setAttribute('turn-style', style);
  } else {
    view.renderer.removeAttribute('turn-style');
  }
  if (viewSettings.disableSwipe) {
    view.renderer.setAttribute('no-swipe', '');
  } else {
    view.renderer.removeAttribute('no-swipe');
  }
};
