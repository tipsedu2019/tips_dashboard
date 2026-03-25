import { useEffect, useId } from 'react';
import { X } from 'lucide-react';
import useViewport from '../../hooks/useViewport';
import { IconButton } from './tds';

const activeBottomSheetEntries = [];
let activeBottomSheetCount = 0;
let previousBodyOverflow = '';
let escapeListenerAttached = false;

function handleBottomSheetEscape(event) {
  if (event.key !== 'Escape') {
    return;
  }

  activeBottomSheetEntries[activeBottomSheetEntries.length - 1]?.onClose?.();
}

export default function BottomSheet({
  open,
  onClose,
  title,
  subtitle,
  headerActions = null,
  children,
  actions = null,
  maxWidth = 620,
  fullHeightOnMobile = false,
  floatingOnMobile = false,
  closeLabel = '닫기',
  testId = '',
  sheetClassName = '',
  bodyClassName = '',
  showHandleOnMobile = true,
}) {
  const { isMobile } = useViewport();
  const sheetId = useId();
  const titleId = useId();
  const subtitleId = useId();

  useEffect(() => {
    if (!open || typeof document === 'undefined') {
      return undefined;
    }

    if (activeBottomSheetCount === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }

    activeBottomSheetCount += 1;
    activeBottomSheetEntries.push({ id: sheetId, onClose });

    if (!escapeListenerAttached) {
      window.addEventListener('keydown', handleBottomSheetEscape);
      escapeListenerAttached = true;
    }

    return () => {
      activeBottomSheetCount = Math.max(0, activeBottomSheetCount - 1);

      const entryIndex = activeBottomSheetEntries.findIndex((entry) => entry.id === sheetId);
      if (entryIndex >= 0) {
        activeBottomSheetEntries.splice(entryIndex, 1);
      }

      if (activeBottomSheetCount === 0) {
        document.body.style.overflow = previousBodyOverflow;
        previousBodyOverflow = '';

        if (escapeListenerAttached) {
          window.removeEventListener('keydown', handleBottomSheetEscape);
          escapeListenerAttached = false;
        }
      }
    };
  }, [onClose, open, sheetId]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      role="presentation"
      className={`bottom-sheet-overlay ${isMobile ? 'is-mobile' : 'is-desktop'} ${isMobile && floatingOnMobile ? 'is-floating' : ''}`}
    >
      <div
        className={`card animate-in bottom-sheet-shell ${isMobile ? 'is-mobile' : 'is-desktop'} ${isMobile && fullHeightOnMobile ? 'is-full-height' : ''} ${isMobile && floatingOnMobile ? 'is-floating' : ''} ${sheetClassName}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        data-testid={testId || undefined}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: isMobile ? '100%' : `min(${maxWidth}px, calc(100vw - 40px))`,
        }}
      >
        <div className={`bottom-sheet-header ${isMobile ? 'is-mobile' : 'is-desktop'}`}>
          <div className="bottom-sheet-header-copy">
            {isMobile && showHandleOnMobile ? <div className="bottom-sheet-handle" /> : null}
            <div className="bottom-sheet-title" id={titleId}>{title}</div>
            {subtitle ? (
              <div className="bottom-sheet-subtitle" id={subtitleId}>{subtitle}</div>
            ) : null}
          </div>

          <div className="bottom-sheet-header-actions">
            {headerActions}
            <IconButton
              className="bottom-sheet-close"
              variant="border"
              onClick={onClose}
              label={closeLabel}
              icon={<X size={20} />}
            />
          </div>
        </div>

        <div className={`bottom-sheet-body ${isMobile ? 'is-mobile' : 'is-desktop'} ${bodyClassName}`}>
          {children}
        </div>

        {actions ? (
          <div className={`bottom-sheet-footer ${isMobile ? 'is-mobile' : 'is-desktop'}`}>
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
