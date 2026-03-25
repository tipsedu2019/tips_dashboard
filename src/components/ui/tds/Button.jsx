function resolveColorToken(color) {
  const normalizedColor = String(color || 'primary').trim().toLowerCase();

  if (normalizedColor === 'neutral' || normalizedColor === 'gray') {
    return 'light';
  }

  return normalizedColor || 'primary';
}

function resolveTypeClass(color) {
  return `tds-button--type-${resolveColorToken(color)}`;
}

function resolveVariantToken(variant) {
  return String(variant || 'fill').trim().toLowerCase() || 'fill';
}

function resolveStyleClass(variant) {
  return `tds-button--style-${resolveVariantToken(variant)}`;
}

function resolveSizeClass(size) {
  const normalizedSize = String(size || 'big').trim().toLowerCase();
  const mappedSize =
    {
      large: 'big',
      xlarge: 'big',
      small: 'tiny',
    }[normalizedSize] || normalizedSize;

  return `tds-button--size-${mappedSize || 'big'}`;
}

export default function Button({
  children,
  onClick,
  onPress,
  color = '',
  variant = '',
  type = 'primary',
  style = 'fill',
  size = 'big',
  display = 'block',
  loading = false,
  disabled = false,
  leftAccessory = null,
  className = '',
  viewStyle = null,
  textStyle = null,
  containerStyle = null,
  ...rest
}) {
  const resolvedColor = color || type || 'primary';
  const resolvedVariant = variant || style || 'fill';
  const clickHandler = onClick || onPress;
  const isDisabled = disabled || loading;
  const rootClassName = [
    'tds-button',
    resolveTypeClass(resolvedColor),
    resolveStyleClass(resolvedVariant),
    resolveSizeClass(size),
    display === 'full' ? 'tds-button--display-full' : 'tds-button--display-block',
    loading ? 'is-loading' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={rootClassName}
      onClick={clickHandler}
      disabled={isDisabled}
      style={{ width: display === 'full' ? '100%' : undefined, ...viewStyle, ...containerStyle, ...textStyle }}
      {...rest}
    >
      {leftAccessory}
      {loading ? (
        <span className="tds-loader-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      ) : null}
      <span>{children}</span>
    </button>
  );
}
