import { AlertCircle, Info, WifiOff } from 'lucide-react';

const VARIANT_META = {
  error: {
    icon: AlertCircle,
    color: '#ef4444',
    background: 'rgba(239, 68, 68, 0.08)',
    border: 'rgba(239, 68, 68, 0.18)'
  },
  warning: {
    icon: WifiOff,
    color: '#d97706',
    background: 'rgba(245, 158, 11, 0.10)',
    border: 'rgba(245, 158, 11, 0.18)'
  },
  info: {
    icon: Info,
    color: 'var(--accent-color)',
    background: 'var(--accent-light)',
    border: 'rgba(33, 110, 78, 0.16)'
  }
};

export default function StatusBanner({ title, message, variant = 'info', compact = false }) {
  if (!title && !message) return null;

  const meta = VARIANT_META[variant] || VARIANT_META.info;
  const Icon = meta.icon;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: compact ? '12px 14px' : '14px 16px',
        borderRadius: 16,
        background: meta.background,
        border: `1px solid ${meta.border}`
      }}
    >
      <div style={{ color: meta.color, marginTop: 1 }}>
        <Icon size={18} />
      </div>
      <div style={{ minWidth: 0 }}>
        {title && (
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>
            {title}
          </div>
        )}
        {message && (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {message}
          </div>
        )}
      </div>
    </div>
  );
}
