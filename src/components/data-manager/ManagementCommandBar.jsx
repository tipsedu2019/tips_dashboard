import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, Search, SlidersHorizontal } from 'lucide-react';

function CommandActionButton({
  label,
  icon,
  onClick,
  disabled,
  variant = 'secondary',
  className = '',
}) {
  return (
    <button
      type="button"
      className={[
        'management-command-bar__action-button',
        variant === 'primary'
          ? 'management-command-bar__action-button-primary'
          : 'management-command-bar__action-button-secondary',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={onClick}
      disabled={disabled}
    >
      {icon || null}
      <span>{label}</span>
    </button>
  );
}

function OverflowActionItem({ action, disabled, onClose }) {
  const content = (
    <>
      {action.icon || null}
      <span>{action.label}</span>
    </>
  );

  if (action.kind === 'file') {
    return (
      <label className={`management-command-bar__menu-item ${disabled ? 'is-disabled' : ''}`}>
        {content}
        <input
          type="file"
          accept={action.accept || '.xlsx,.xls,.csv'}
          className="management-toolbar-file-input"
          disabled={disabled}
          onChange={async (event) => {
            await action.onChange?.(event);
            onClose?.();
          }}
        />
      </label>
    );
  }

  return (
    <button
      type="button"
      className="management-command-bar__menu-item"
      onClick={() => {
        action.onClick?.();
        onClose?.();
      }}
      disabled={disabled}
    >
      {content}
    </button>
  );
}

export default function ManagementCommandBar({
  searchValue = '',
  onSearchChange,
  searchPlaceholder = '',
  filtersContent = null,
  filtersClassName = '',
  primaryAction = null,
  overflowActions = [],
  settingsContent = null,
  settingsBadge = 0,
  isBusy = false,
  testId = '',
  toolbarTestId = '',
}) {
  const overflowRef = useRef(null);
  const settingsRef = useRef(null);
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const hasActions = Boolean(primaryAction || overflowActions.length > 0 || settingsContent);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!overflowRef.current?.contains(event.target)) {
        setIsOverflowOpen(false);
      }
      if (!settingsRef.current?.contains(event.target)) {
        setIsSettingsOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsOverflowOpen(false);
        setIsSettingsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  return (
    <div className="management-command-bar" data-testid={testId || undefined}>
      <div className="management-command-bar__main">
        <label className="management-command-bar__search-shell">
          <Search size={16} className="management-command-bar__search-icon" />
          <input
            type="search"
            className="styled-input management-command-bar__search-input"
            value={searchValue}
            onChange={(event) => onSearchChange?.(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder || '검색'}
          />
        </label>

        {filtersContent ? (
          <div
            className={['management-command-bar__filters', filtersClassName]
              .filter(Boolean)
              .join(' ')}
          >
            {filtersContent}
          </div>
        ) : null}
      </div>

      {hasActions ? (
        <div className="management-command-bar__actions" data-testid={toolbarTestId || undefined}>
          {primaryAction ? (
            <CommandActionButton
              label={primaryAction.label}
              icon={primaryAction.icon}
              onClick={primaryAction.onClick}
              disabled={isBusy || primaryAction.disabled}
              variant="primary"
            />
          ) : null}

          {overflowActions.length > 0 ? (
            <div ref={overflowRef} className="management-command-bar__panel-anchor">
              <CommandActionButton
                label="더보기"
                icon={<MoreHorizontal size={16} />}
                onClick={() => {
                  setIsSettingsOpen(false);
                  setIsOverflowOpen((current) => !current);
                }}
                disabled={isBusy}
              />

              {isOverflowOpen ? (
                <div className="card-custom management-command-bar__panel management-command-bar__overflow-panel">
                  {overflowActions.map((action) => (
                    <OverflowActionItem
                      key={action.label}
                      action={action}
                      disabled={isBusy || action.disabled}
                      onClose={() => setIsOverflowOpen(false)}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {settingsContent ? (
            <div ref={settingsRef} className="management-command-bar__panel-anchor">
              <CommandActionButton
                label="보기 설정"
                icon={<SlidersHorizontal size={16} />}
                onClick={() => {
                  setIsOverflowOpen(false);
                  setIsSettingsOpen((current) => !current);
                }}
                disabled={isBusy}
                className={isSettingsOpen ? 'is-open' : ''}
              />

              {settingsBadge > 0 ? (
                <span className="management-command-bar__badge">{settingsBadge}</span>
              ) : null}

              {isSettingsOpen ? (
                <div className="card-custom management-command-bar__panel management-command-bar__settings-panel">
                  <div className="management-command-bar__panel-head">
                    <strong>보기 설정</strong>
                    <button
                      type="button"
                      className="management-inline-action"
                      onClick={() => setIsSettingsOpen(false)}
                    >
                      닫기
                    </button>
                  </div>
                  {settingsContent}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
