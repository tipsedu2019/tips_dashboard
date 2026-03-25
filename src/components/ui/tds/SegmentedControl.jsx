import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const DEFAULT_SCROLL_STATE = {
  isScrollable: false,
  canScrollLeft: false,
  canScrollRight: false,
};

export default function SegmentedControl({
  value,
  onValueChange,
  items = [],
  size = 'small',
  alignment = 'fixed',
  selectionMode = 'single',
  className = '',
  showArrowButtons = true,
}) {
  const viewportRef = useRef(null);
  const [scrollState, setScrollState] = useState(DEFAULT_SCROLL_STATE);

  const syncScrollState = useCallback(() => {
    if (alignment !== 'fluid') {
      setScrollState(DEFAULT_SCROLL_STATE);
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      setScrollState(DEFAULT_SCROLL_STATE);
      return;
    }

    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const nextState = {
      isScrollable: maxScrollLeft > 4,
      canScrollLeft: viewport.scrollLeft > 4,
      canScrollRight: viewport.scrollLeft < maxScrollLeft - 4,
    };

    setScrollState((current) => {
      if (
        current.isScrollable === nextState.isScrollable &&
        current.canScrollLeft === nextState.canScrollLeft &&
        current.canScrollRight === nextState.canScrollRight
      ) {
        return current;
      }
      return nextState;
    });
  }, [alignment]);

  useEffect(() => {
    if (alignment !== 'fluid') {
      return undefined;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return undefined;
    }

    const handleSync = () => syncScrollState();

    handleSync();
    viewport.addEventListener('scroll', handleSync, { passive: true });
    window.addEventListener('resize', handleSync);

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(handleSync);
      resizeObserver.observe(viewport);
    }

    return () => {
      viewport.removeEventListener('scroll', handleSync);
      window.removeEventListener('resize', handleSync);
      resizeObserver?.disconnect();
    };
  }, [alignment, syncScrollState]);

  useEffect(() => {
    if (alignment !== 'fluid') {
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const activeItem = viewport.querySelector('[data-segmented-active="true"]');
    if (activeItem instanceof HTMLElement) {
      activeItem.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: 'smooth',
      });
    }

    const frame = window.requestAnimationFrame(() => {
      syncScrollState();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [alignment, items.length, syncScrollState, value]);

  const scrollViewportBy = (direction) => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const offset = Math.max(120, Math.round(viewport.clientWidth * 0.72)) * direction;
    viewport.scrollBy({ left: offset, behavior: 'smooth' });
  };

  const rootClassName = [
    'tds-segmented',
    `tds-segmented--${size}`,
    `tds-segmented--alignment-${alignment}`,
    scrollState.isScrollable ? 'is-scrollable' : '',
    scrollState.canScrollLeft ? 'can-scroll-left' : '',
    scrollState.canScrollRight ? 'can-scroll-right' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const selectedValues = selectionMode === 'multiple'
    ? (Array.isArray(value) ? value : [])
    : [value];

  const itemsMarkup = items.map((item) => {
    const isActive = selectedValues.includes(item.value);
    const resolvedStyle = {
      ...(item.style || {}),
      ...(isActive ? item.activeStyle || {} : {}),
    };

    return (
      <button
        key={item.value}
        type="button"
        role={selectionMode === 'multiple' ? 'checkbox' : 'radio'}
        aria-checked={isActive}
        aria-label={item.ariaLabel || item.label}
        data-testid={item.testId}
        title={item.title}
        disabled={item.disabled}
        data-segmented-active={isActive ? 'true' : 'false'}
        className={[
          'tds-segmented__item',
          item.disabled ? 'is-disabled' : '',
          isActive ? 'is-active' : '',
          item.className || '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={Object.keys(resolvedStyle).length > 0 ? resolvedStyle : undefined}
        onClick={() => {
          if (!item.disabled) {
            onValueChange?.(item.value);
          }
        }}
      >
        {item.icon || null}
        <span>{item.label}</span>
      </button>
    );
  });

  if (alignment === 'fluid') {
    return (
      <div className={rootClassName}>
        {showArrowButtons && scrollState.isScrollable ? (
          <>
            <button
              type="button"
              className="tds-segmented__arrow tds-segmented__arrow--left"
              aria-label="이전 항목 보기"
              disabled={!scrollState.canScrollLeft}
              onClick={() => scrollViewportBy(-1)}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              className="tds-segmented__arrow tds-segmented__arrow--right"
              aria-label="다음 항목 보기"
              disabled={!scrollState.canScrollRight}
              onClick={() => scrollViewportBy(1)}
            >
              <ChevronRight size={16} />
            </button>
          </>
        ) : null}

        <div className="tds-segmented__viewport" ref={viewportRef}>
          <div
            className="tds-segmented__track"
            role={selectionMode === 'multiple' ? 'group' : 'radiogroup'}
          >
            {itemsMarkup}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={rootClassName}
      role={selectionMode === 'multiple' ? 'group' : 'radiogroup'}
    >
      {itemsMarkup}
    </div>
  );
}
