import { useEffect, useState } from 'react';

export const MOBILE_BREAKPOINT = 768;
export const TABLET_BREAKPOINT = 1024;

function isDesktopPlatform(platform = '', userAgent = '') {
  const platformValue = String(platform || '').toLowerCase();
  const userAgentValue = String(userAgent || '').toLowerCase();

  if (/android|iphone|ipad|ipod/.test(userAgentValue)) {
    return false;
  }

  return (
    /win|mac|linux/.test(platformValue) ||
    /windows nt|macintosh|cros|x11|linux/.test(userAgentValue)
  );
}

export function getViewportStateFromMetrics({
  width = TABLET_BREAKPOINT + 1,
  devicePixelRatio = 1,
  hasCoarsePointer = false,
  platform = '',
  userAgent = '',
} = {}) {
  const safeWidth = Number.isFinite(width) && width > 0
    ? width
    : TABLET_BREAKPOINT + 1;
  const safeDevicePixelRatio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? devicePixelRatio
    : 1;
  const desktopPlatform = isDesktopPlatform(platform, userAgent);
  const layoutWidth = (desktopPlatform || !hasCoarsePointer) && safeDevicePixelRatio > 1
    ? safeWidth * safeDevicePixelRatio
    : safeWidth;
  const isMobile = layoutWidth <= MOBILE_BREAKPOINT;
  const isTablet = layoutWidth > MOBILE_BREAKPOINT && layoutWidth <= TABLET_BREAKPOINT;

  return {
    width: safeWidth,
    layoutWidth,
    isMobile,
    isTablet,
    isCompact: isMobile || isTablet,
    isDesktop: layoutWidth > TABLET_BREAKPOINT,
  };
}

function getViewportState() {
  if (typeof window === 'undefined') {
    return getViewportStateFromMetrics();
  }

  const width = window.innerWidth;
  const devicePixelRatio = window.devicePixelRatio || 1;
  const hasCoarsePointer =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;
  const platform =
    window.navigator?.userAgentData?.platform || window.navigator?.platform || '';
  const userAgent = window.navigator?.userAgent || '';

  return getViewportStateFromMetrics({
    width,
    devicePixelRatio,
    hasCoarsePointer,
    platform,
    userAgent,
  });
}

export function useViewport() {
  const [viewport, setViewport] = useState(getViewportState);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleResize = () => {
      setViewport(getViewportState());
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return viewport;
}

export default useViewport;
