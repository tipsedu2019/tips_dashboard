import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

function normalizeValues(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

export default function CheckboxMenu({
  value = [],
  options = [],
  onChange,
  placeholder = '전체 선택',
  clearLabel = '전체 보기',
  clearDescription = '전체 항목을 다시 함께 보여줍니다.',
  label = '선택 메뉴',
  className = '',
  disabled = false,
  maxPreview = 2,
  showCountMeta = true,
  selectionMode = 'multiple',
  showResetOption = true,
  emptySelectionMeansAll = false,
}) {
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState('bottom');

  const normalizedSelected = useMemo(() => normalizeValues(value), [value]);
  const normalizedOptions = useMemo(
    () =>
      options
        .map((option) => {
          if (typeof option === 'string') {
            return { value: option, label: option };
          }
          return {
            value: String(option?.value || '').trim(),
            label: String(option?.label || option?.value || '').trim(),
          };
        })
        .filter((option) => option.value && option.label),
    [options],
  );
  const labelByValue = useMemo(
    () => Object.fromEntries(normalizedOptions.map((option) => [option.value, option.label])),
    [normalizedOptions],
  );
  const selectedLabels = useMemo(
    () => normalizedSelected.map((item) => labelByValue[item] || item),
    [labelByValue, normalizedSelected],
  );
  const effectiveSelected = useMemo(() => {
    if (selectionMode === 'multiple' && emptySelectionMeansAll && normalizedSelected.length === 0) {
      return normalizedOptions.map((option) => option.value);
    }
    return normalizedSelected;
  }, [emptySelectionMeansAll, normalizedOptions, normalizedSelected, selectionMode]);
  const selectedCountForMeta = useMemo(() => effectiveSelected.length, [effectiveSelected]);

  const summary = useMemo(() => {
    if (normalizedSelected.length === 0) {
      return placeholder;
    }

    if (selectedLabels.length <= maxPreview) {
      return selectedLabels.join(', ');
    }

    return `${selectedLabels.slice(0, maxPreview).join(', ')} 외 ${selectedLabels.length - maxPreview}개`;
  }, [maxPreview, normalizedSelected.length, placeholder, selectedLabels]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setPlacement('bottom');
      return;
    }

    const root = rootRef.current;
    const panel = panelRef.current;

    if (!root || !panel) {
      return;
    }

    const rootRect = root.getBoundingClientRect();
    const panelHeight = Math.min(panel.scrollHeight || 0, 256);
    const spaceBelow = window.innerHeight - rootRect.bottom;
    const spaceAbove = rootRect.top;

    if (spaceBelow < panelHeight + 16 && spaceAbove > spaceBelow) {
      setPlacement('top');
      return;
    }

    setPlacement('bottom');
  }, [normalizedOptions.length, open]);

  const toggleValue = (nextValue) => {
    if (disabled) {
      return;
    }

    if (selectionMode === 'single') {
      const isSelected = normalizedSelected.includes(nextValue);
      onChange?.(isSelected ? [] : [nextValue]);
      setOpen(false);
      return;
    }

    const baseSelected = emptySelectionMeansAll && normalizedSelected.length === 0
      ? normalizedOptions.map((option) => option.value)
      : normalizedSelected;
    const isSelected = baseSelected.includes(nextValue);
    const nextSelected = isSelected
      ? baseSelected.filter((item) => item !== nextValue)
      : [...baseSelected, nextValue];
    const normalizedNext = normalizeValues(nextSelected);
    const collapsedNext = emptySelectionMeansAll && normalizedNext.length === normalizedOptions.length
      ? []
      : normalizedNext;

    onChange?.(collapsedNext);
  };

  return (
    <div
      ref={rootRef}
      className={[
        'tds-checkbox-menu',
        open ? 'is-open' : '',
        placement === 'top' ? 'is-open-upward' : '',
        disabled ? 'is-disabled' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        type="button"
        className="tds-checkbox-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="tds-checkbox-menu__trigger-copy">
          <span className="tds-checkbox-menu__trigger-label">{summary}</span>
          {showCountMeta && selectedCountForMeta > 0 ? (
            <span className="tds-checkbox-menu__trigger-meta">{selectedCountForMeta}개 선택</span>
          ) : null}
        </span>
        <ChevronDown
          size={16}
          className={`tds-checkbox-menu__trigger-icon ${open ? 'is-open' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div ref={panelRef} className="tds-checkbox-menu__panel" role="menu" aria-label={label}>
          {showResetOption ? (
            <>
              <button
                type="button"
                className={`tds-checkbox-menu__option ${normalizedSelected.length === 0 ? 'is-selected' : ''}`}
                role="menuitemcheckbox"
                aria-checked={normalizedSelected.length === 0}
                onClick={() => {
                  onChange?.([]);
                  setOpen(false);
                }}
              >
                <span className="tds-checkbox-menu__check">
                  {normalizedSelected.length === 0 ? <Check size={14} /> : null}
                </span>
                <span className="tds-checkbox-menu__option-copy">
                  <strong>{clearLabel}</strong>
                  <span>{clearDescription}</span>
                </span>
              </button>

              <div className="tds-checkbox-menu__divider" />
            </>
          ) : null}

          <div className="tds-checkbox-menu__list">
            {normalizedOptions.map((option) => {
              const isSelected = effectiveSelected.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`tds-checkbox-menu__option ${isSelected ? 'is-selected' : ''}`}
                  role="menuitemcheckbox"
                  aria-checked={isSelected}
                  onClick={() => toggleValue(option.value)}
                >
                  <span className="tds-checkbox-menu__check">
                    {isSelected ? <Check size={14} /> : null}
                  </span>
                  <span className="tds-checkbox-menu__option-copy">
                    <strong>{option.label}</strong>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
