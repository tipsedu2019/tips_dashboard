import { useEffect, useId } from 'react';
import { X } from 'lucide-react';
import useViewport from '../../hooks/useViewport';

export default function BottomSheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  actions = null,
  maxWidth = 620,
  fullHeightOnMobile = false,
  closeLabel = '닫기',
  testId = '',
}) {
  const { isMobile } = useViewport();
  const titleId = useId();
  const subtitleId = useId();

  useEffect(() => {
    if (!open || typeof document === 'undefined') {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      role="presentation"
      className={`bottom-sheet-overlay ${isMobile ? 'is-mobile' : 'is-desktop'}`}
    >
      <div
        className={`card animate-in bottom-sheet-shell ${isMobile ? 'is-mobile' : 'is-desktop'} ${isMobile && fullHeightOnMobile ? 'is-full-height' : ''}`}
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
            {isMobile ? <div className="bottom-sheet-handle" /> : null}
            <div className="bottom-sheet-title" id={titleId}>{title}</div>
            {subtitle ? (
              <div className="bottom-sheet-subtitle" id={subtitleId}>{subtitle}</div>
            ) : null}
          </div>

          <button
            type="button"
            className="btn-icon bottom-sheet-close"
            onClick={onClose}
            aria-label={closeLabel}
            title={closeLabel}
          >
            <X size={20} />
          </button>
        </div>

        <div className={`bottom-sheet-body ${isMobile ? 'is-mobile' : 'is-desktop'}`}>
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
