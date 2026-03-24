export default function IconButton({
  children,
  icon = null,
  label = '',
  onPress,
  variant = 'clear',
  color = '',
  bgColor = '',
  iconSize = 20,
  className = '',
  disabled = false,
  ...rest
}) {
  const rootClassName = [
    'tds-icon-button',
    `tds-icon-button--variant-${variant}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={rootClassName}
      onClick={onPress}
      aria-label={label}
      title={label}
      disabled={disabled}
      style={{
        color: color || undefined,
        background: bgColor || undefined,
      }}
      {...rest}
    >
      <span style={{ display: 'inline-flex', fontSize: iconSize, lineHeight: 0 }}>
        {icon || children}
      </span>
    </button>
  );
}
