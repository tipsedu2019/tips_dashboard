import { ChevronRight } from 'lucide-react';

export default function TextButton({
  children,
  onPress,
  typography = 't5',
  variant = 'clear',
  disabled = false,
  color = '',
  className = '',
  fontWeight = 'bold',
  ...rest
}) {
  const sizeMap = {
    t1: 'var(--tds-typo-t1-size)',
    t3: 'var(--tds-typo-t3-size)',
    t4: 'var(--tds-typo-t4-size)',
    t5: 'var(--tds-typo-t5-size)',
    t6: 'var(--tds-typo-t6-size)',
    t7: 'var(--tds-typo-t7-size)',
  };

  return (
    <button
      type="button"
      className={['tds-text-button', `tds-text-button--variant-${variant}`, className].filter(Boolean).join(' ')}
      onClick={onPress}
      disabled={disabled}
      style={{
        color: color || undefined,
        fontSize: sizeMap[typography] || sizeMap.t5,
        fontWeight,
      }}
      {...rest}
    >
      <span>{children}</span>
      {variant === 'arrow' ? (
        <span className="tds-text-button__arrow" aria-hidden="true">
          <ChevronRight size={16} />
        </span>
      ) : null}
    </button>
  );
}
