import { AlertCircle, Info, WifiOff } from 'lucide-react';

import { Badge } from './tds';

const VARIANT_META = {
  error: {
    icon: AlertCircle,
    badgeType: 'red',
  },
  warning: {
    icon: WifiOff,
    badgeType: 'amber',
  },
  info: {
    icon: Info,
    badgeType: 'blue',
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
  if (!title && !message) {
    return null;
  }

  const meta = VARIANT_META[variant] || VARIANT_META.info;
  const Icon = meta.icon;
  const rootClassName = [
    'status-banner',
    'tds-surface',
    compact ? 'is-compact' : '',
    `is-${variant}`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClassName} role="status">
      <div className="status-banner-icon">
        <Icon size={18} />
      </div>
      <div className="status-banner-copy">
        {eyebrow ? (
          <Badge className="status-banner-badge" size="small" type={meta.badgeType} badgeStyle="weak">
            {eyebrow}
          </Badge>
        ) : null}
        {title ? <div className="status-banner-title">{title}</div> : null}
        {message ? <div className="status-banner-message">{message}</div> : null}
      </div>
      {actions ? <div className="status-banner-actions">{actions}</div> : null}
    </div>
  );
}
