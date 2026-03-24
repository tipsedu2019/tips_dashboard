export default function Switch({
  checked = false,
  onChange,
  label = '스위치',
  className = '',
  disabled = false,
  size = 'small',
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={[
        'tds-switch',
        `tds-switch--${size}`,
        checked ? 'is-checked' : '',
        disabled ? 'is-disabled' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => {
        if (!disabled) {
          onChange?.(!checked);
        }
      }}
    >
      <span className="tds-switch__track" aria-hidden="true">
        <span className="tds-switch__thumb" />
      </span>
    </button>
  );
}
