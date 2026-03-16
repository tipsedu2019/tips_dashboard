import { useEffect, useState } from 'react';

export const MOBILE_BREAKPOINT = 768;
export const TABLET_BREAKPOINT = 1024;

function getViewportState() {
  if (typeof window === 'undefined') {
    return {
      width: TABLET_BREAKPOINT + 1,
      isMobile: false,
      isTablet: false,
      isCompact: false,
      isDesktop: true,
    };
  }

  const width = window.innerWidth;
  const isMobile = width <= MOBILE_BREAKPOINT;
  const isTablet = width > MOBILE_BREAKPOINT && width <= TABLET_BREAKPOINT;

  return {
    width,
    isMobile,
    isTablet,
    isCompact: isMobile || isTablet,
    isDesktop: width > TABLET_BREAKPOINT,
  };
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
