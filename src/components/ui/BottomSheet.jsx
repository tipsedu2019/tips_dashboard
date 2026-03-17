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
  fullHeightOnMobile = true,
}) {
  const { isMobile } = useViewport();

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      role="presentation"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1700,
        background: 'rgba(15, 23, 42, 0.42)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent: 'center',
        padding: isMobile ? 0 : 20,
      }}
    >
      <div
        className="card animate-in"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: isMobile ? '100%' : `min(${maxWidth}px, calc(100vw - 40px))`,
          maxWidth: '100%',
          maxHeight: isMobile ? '100vh' : 'min(88vh, 920px)',
          height: isMobile && fullHeightOnMobile ? 'min(96vh, 100vh)' : 'auto',
          borderRadius: isMobile ? '28px 28px 0 0' : 28,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: isMobile ? '12px 18px 14px' : '18px 22px',
            borderBottom: '1px solid var(--border-color)',
            background: 'var(--bg-surface)',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            alignItems: 'flex-start',
          }}
        >
          <div style={{ minWidth: 0 }}>
            {isMobile ? (
              <div
                style={{
                  width: 48,
                  height: 5,
                  borderRadius: 999,
                  background: 'rgba(15, 23, 42, 0.12)',
                  margin: '0 auto 12px',
                }}
              />
            ) : null}
            <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--text-primary)' }}>{title}</div>
            {subtitle ? (
              <div style={{ marginTop: 4, fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                {subtitle}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            className="btn-icon bottom-sheet-close"
            onClick={onClose}
            aria-label="닫기"
            title="닫기"
          >
            <X size={20} />
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: isMobile ? 16 : 20 }}>
          {children}
        </div>

        {actions ? (
          <div
            style={{
              padding: isMobile ? 16 : 18,
              borderTop: '1px solid var(--border-color)',
              background: 'var(--bg-surface)',
            }}
          >
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
