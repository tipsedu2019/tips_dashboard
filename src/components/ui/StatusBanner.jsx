import { AlertCircle, Info, WifiOff } from 'lucide-react';

const VARIANT_META = {
  error: {
    icon: AlertCircle,
  },
  warning: {
    icon: WifiOff,
  },
  info: {
    icon: Info,
  },
};

export default function StatusBanner({
  title,
  message,
  variant = 'info',
  compact = false,
  eyebrow = '',
  actions = null,
}) {
  if (!title && !message) return null;

  const meta = VARIANT_META[variant] || VARIANT_META.info;
  const Icon = meta.icon;
  const rootClassName = [
    'status-banner',
    compact ? 'is-compact' : '',
    `is-${variant}`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClassName}>
      <div className="status-banner-icon">
        <Icon size={18} />
      </div>
      <div className="status-banner-copy">
        {eyebrow ? (
          <div className="status-banner-eyebrow">{eyebrow}</div>
        ) : null}
        {title && (
          <div className="status-banner-title">{title}</div>
        )}
        {message && (
          <div className="status-banner-message">{message}</div>
        )}
      </div>
      {actions ? (
        <div className="status-banner-actions">{actions}</div>
      ) : null}
    </div>
  );
}
