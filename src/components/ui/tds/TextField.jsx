function renderLabel(label, value, labelOption) {
  if (!label) {
    return null;
  }
  if (labelOption === 'appear' && !String(value || '').trim()) {
    return null;
  }
  return <span className="tds-text-field__label">{label}</span>;
}

export default function TextField({
  as = 'input',
  children = null,
  variant = 'box',
  value,
  defaultValue,
  onChangeText,
  label = '',
  labelOption = 'appear',
  help = null,
  hasError = false,
  disabled = false,
  prefix = '',
  suffix = '',
  right = null,
  placeholder = '',
  type = 'text',
  className = '',
  containerStyle = null,
  ...rest
}) {
  const TagName = as;
  const rootClassName = [
    'tds-text-field',
    `tds-text-field--variant-${variant}`,
    hasError ? 'tds-text-field--error' : '',
    disabled ? 'tds-text-field--disabled' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const controlProps = {
    className: 'tds-text-field__control',
    placeholder,
    disabled,
    defaultValue,
    value,
    onChange: onChangeText ? (event) => onChangeText(event.target.value) : undefined,
    ...rest,
  };

  if (TagName === 'input') {
    controlProps.type = type;
  }

  return (
    <label className={rootClassName} style={containerStyle || undefined}>
      {renderLabel(label, value ?? defaultValue, labelOption)}
      <span className="tds-text-field__shell">
        {prefix ? <span className="tds-text-field__prefix">{prefix}</span> : null}
        <TagName {...controlProps}>
          {children}
        </TagName>
        {suffix ? <span className="tds-text-field__suffix">{suffix}</span> : null}
        {right}
      </span>
      {help ? <span className="tds-text-field__help">{help}</span> : null}
    </label>
  );
}
