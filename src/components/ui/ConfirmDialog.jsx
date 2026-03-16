import { AlertTriangle } from 'lucide-react';

export default function ConfirmDialog({
  open,
  title = '확인이 필요합니다.',
  description = '',
  confirmLabel = '확인',
  cancelLabel = '취소',
  tone = 'danger',
  onConfirm,
  onCancel
}) {
  if (!open) return null;

  const accent = tone === 'danger' ? '#ef4444' : 'var(--accent-color)';
  const accentBg = tone === 'danger' ? 'rgba(239, 68, 68, 0.08)' : 'var(--accent-light)';

  return (
    <div
      onClick={onCancel}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 2200,
          display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'rgba(15, 23, 42, 0.45)',
        backdropFilter: 'blur(10px)'
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="card-custom"
        style={{
          width: '100%',
          maxWidth: 420,
          padding: 28,
          display: 'flex',
          flexDirection: 'column',
          gap: 20
        }}
      >
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 14,
              background: accentBg,
              color: accent,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            <AlertTriangle size={20} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{title}</h3>
            {description && (
              <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                {description}
              </p>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button className="btn btn-secondary" type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className="btn btn-primary"
            type="button"
            onClick={onConfirm}
            style={{
              background: accent,
              boxShadow: tone === 'danger' ? '0 10px 24px rgba(239, 68, 68, 0.18)' : undefined
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
