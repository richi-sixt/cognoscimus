import { redirect, useRouter } from 'next/navigation';
import { isPWA, isWebAppPlatform } from '@/services/environment';
import { BOOK_IDS_SEPARATOR } from '@/services/constants';

export const navigateToReader = (
  router: ReturnType<typeof useRouter>,
  bookIds: string[],
  queryParams?: string,
  navOptions?: { scroll?: boolean },
) => {
  const ids = bookIds.join(BOOK_IDS_SEPARATOR);
  if (isWebAppPlatform() && !isPWA()) {
    router.push(`/reader/${ids}${queryParams ? `?${queryParams}` : ''}`, navOptions);
  } else {
    const params = new URLSearchParams(queryParams || '');
    params.set('ids', ids);
    router.push(`/reader?${params.toString()}`, navOptions);
  }
};

export const navigateToLogin = (router: ReturnType<typeof useRouter>) => {
  const pathname = window.location.pathname;
  const search = window.location.search;
  const currentPath = pathname !== '/auth' ? pathname + search : '/';
  router.push(`/auth?redirect=${encodeURIComponent(currentPath)}`);
};

// Remember the opener so leaving the profile returns to it, e.g. the book
// being read when Plans was opened from the reader settings (#6607). The
// direction picks the slide of the route view transition (useAppRouter).
export const navigateToProfile = (router: ReturnType<typeof useRouter>) => {
  const { pathname, search } = window.location;
  document.documentElement.setAttribute('data-nav-direction', 'forward');
  router.push(`/user?redirect=${encodeURIComponent(pathname + search)}`);
};

export const navigateBackFromProfile = (
  router: ReturnType<typeof useRouter>,
  redirect: string | null | undefined,
) => {
  document.documentElement.setAttribute('data-nav-direction', 'back');
  // Browsers read a backslash as '/', so a redirect like '/\host' leaves the app.
  if (redirect?.startsWith('/') && !redirect.startsWith('//') && !redirect.includes('\\')) {
    router.replace(redirect);
  } else {
    navigateToLibrary(router);
  }
};

export const navigateToLibrary = (
  router: ReturnType<typeof useRouter>,
  queryParams?: string,
  navOptions?: { scroll?: boolean },
  navBack?: boolean,
) => {
  const lastLibraryParams =
    typeof window !== 'undefined' ? sessionStorage.getItem('lastLibraryParams') : null;
  if (navBack && lastLibraryParams) {
    queryParams = lastLibraryParams;
  }

  router.replace(`/library${queryParams ? `?${queryParams}` : ''}`, navOptions);
};

export const redirectToLibrary = () => {
  redirect('/library');
};

export const navigateToResetPassword = (router: ReturnType<typeof useRouter>) => {
  const pathname = window.location.pathname;
  const search = window.location.search;
  const currentPath = pathname !== '/auth' ? pathname + search : '/';
  router.push(`/auth/recovery?redirect=${encodeURIComponent(currentPath)}`);
};

export const navigateToUpdatePassword = (router: ReturnType<typeof useRouter>) => {
  const pathname = window.location.pathname;
  const search = window.location.search;
  const currentPath = pathname !== '/auth' ? pathname + search : '/';
  router.push(`/auth/update?redirect=${encodeURIComponent(currentPath)}`);
};
