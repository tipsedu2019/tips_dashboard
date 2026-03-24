import { Search, X } from 'lucide-react';

function createSyntheticEvent(text) {
  return {
    nativeEvent: { text },
    target: { value: text },
    currentTarget: { value: text },
  };
}

export default function SearchField({
  placeholder = '',
  value,
  defaultValue,
  onChange,
  onChangeText,
  hasClearButton = false,
  autoFocus = false,
  editable = true,
  maxLength,
  className = '',
  style = null,
  inputClassName = '',
  'aria-label': ariaLabel,
  ...rest
}) {
  const showClearButton = hasClearButton && Boolean(String(value ?? '').trim());

  const handleChange = (event) => {
    const nextText = event.target.value;
    onChange?.({
      ...event,
      nativeEvent: { text: nextText },
    });
    onChangeText?.(nextText);
  };

  const handleClear = () => {
    if (!editable) {
      return;
    }

    const syntheticEvent = createSyntheticEvent('');
    onChange?.(syntheticEvent);
    onChangeText?.('');
  };

  return (
    <label
      className={['tds-search-field', !editable ? 'tds-search-field--disabled' : '', className].filter(Boolean).join(' ')}
      style={style || undefined}
    >
      <span className="tds-search-field__icon" aria-hidden="true">
        <Search size={18} />
      </span>
      <input
        type="search"
        className={['tds-search-field__input', inputClassName].filter(Boolean).join(' ')}
        placeholder={placeholder}
        value={value}
        defaultValue={defaultValue}
        onChange={handleChange}
        autoFocus={autoFocus}
        disabled={!editable}
        maxLength={maxLength}
        aria-label={ariaLabel || placeholder || '검색'}
        {...rest}
      />
      {showClearButton ? (
        <button
          type="button"
          className="tds-search-field__clear"
          aria-label="검색어 지우기"
          onClick={handleClear}
        >
          <X size={14} />
        </button>
      ) : null}
    </label>
  );
}
