export default function Badge({
  children,
  size = 'small',
  type = 'blue',
  badgeStyle = 'fill',
  className = '',
  style = null,
}) {
  const sizeStyle = {
    tiny: { minHeight: 20, paddingInline: 8 },
    small: { minHeight: 24, paddingInline: 10 },
    medium: { minHeight: 28, paddingInline: 12 },
    large: { minHeight: 32, paddingInline: 14 },
  }[size] || {};

  return (
    <span
      className={['tds-badge', `tds-badge--type-${type}`, `tds-badge--style-${badgeStyle}`, className].filter(Boolean).join(' ')}
      style={{ ...sizeStyle, ...(style || {}) }}
    >
      {children}
    </span>
  );
}
