import { useEffect, useRef } from 'react';

export default function Tab({
  value,
  onChange,
  items = [],
  size = 'large',
  fluid = false,
  className = '',
  scrollerRef = null,
  ...rest
}) {
  const internalScrollerRef = useRef(null);
  const resolvedScrollerRef = scrollerRef || internalScrollerRef;

  useEffect(() => {
    const scroller = resolvedScrollerRef.current;
    if (!scroller) {
      return;
    }

    const activeItem = scroller.querySelector('[data-tab-active="true"]');
    if (activeItem instanceof HTMLElement) {
      activeItem.scrollIntoView({
        block: 'nearest',
        inline: fluid ? 'center' : 'nearest',
        behavior: 'smooth',
      });
    }
  }, [fluid, items.length, resolvedScrollerRef, value]);

  return (
    <div
      className={[
        'tds-tab',
        `tds-tab--size-${size}`,
        fluid ? 'tds-tab--fluid' : 'tds-tab--fixed',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      <div className="tds-tab__scroller" ref={resolvedScrollerRef}>
        <div className="tds-tab__track" role="tablist">
          {items.map((item) => {
            const isActive = item.value === value;

            return (
              <button
                key={item.value}
                type="button"
                role="tab"
                className={[
                  'tds-tab__item',
                  isActive ? 'is-active' : '',
                  item.className || '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-selected={isActive}
                aria-pressed={isActive}
                aria-label={item.ariaLabel || item.label}
                title={item.title || item.label}
                data-tab-active={isActive ? 'true' : 'false'}
                data-testid={item.testId}
                disabled={item.disabled}
                onClick={() => {
                  if (!item.disabled) {
                    onChange?.(item.value);
                  }
                }}
              >
                {item.icon || null}
                <span>{item.label}</span>
                {item.redBean ? <span className="tds-tab__red-bean" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
