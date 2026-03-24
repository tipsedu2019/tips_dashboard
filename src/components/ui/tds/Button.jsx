function resolveTypeClass(type) {
  return `tds-button--type-${type || 'primary'}`;
}

function resolveStyleClass(style) {
  return `tds-button--style-${style || 'fill'}`;
}

function resolveSizeClass(size) {
  return `tds-button--size-${size || 'big'}`;
}

export default function Button({
  children,
  onPress,
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
  const isDisabled = disabled || loading;
  const rootClassName = [
    'tds-button',
    resolveTypeClass(type),
    resolveStyleClass(style),
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
      onClick={onPress}
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
