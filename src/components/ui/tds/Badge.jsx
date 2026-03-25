function resolveColorToken(color) {
  const normalizedColor = String(color || 'blue').trim().toLowerCase();

  return (
    {
      primary: 'blue',
      accent: 'teal',
      success: 'green',
      warning: 'amber',
      danger: 'red',
      neutral: 'gray',
      light: 'gray',
    }[normalizedColor] ||
    normalizedColor ||
    'blue'
  );
}

function resolveVariantToken(variant) {
  return String(variant || 'fill').trim().toLowerCase() || 'fill';
}

export default function Badge({
  children,
  size = 'small',
  color = '',
  variant = '',
  type = 'blue',
  badgeStyle = 'fill',
  className = '',
  style = null,
}) {
  const resolvedColor = color || type || 'blue';
  const resolvedVariant = variant || badgeStyle || 'fill';
  const sizeStyle = {
    tiny: { minHeight: 20, paddingInline: 8 },
    small: { minHeight: 24, paddingInline: 10 },
    medium: { minHeight: 28, paddingInline: 12 },
    large: { minHeight: 32, paddingInline: 14 },
  }[size] || {};

  return (
    <span
      className={[
        'tds-badge',
        `tds-badge--type-${resolveColorToken(resolvedColor)}`,
        `tds-badge--style-${resolveVariantToken(resolvedVariant)}`,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ ...sizeStyle, ...(style || {}) }}
    >
      {children}
    </span>
  );
}
