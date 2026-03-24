export default function DashboardInlineNotice({
  tone = 'info',
  variant = '',
  title,
  message = '',
  description = '',
  actions = null,
  className = '',
}) {
  const resolvedTone = variant || tone;
  const resolvedMessage = message || description;

  return (
    <div
      className={[
        'dashboard-inline-notice',
        `dashboard-inline-notice--${resolvedTone}`,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      role="status"
    >
      <div className="dashboard-inline-notice__copy">
        <strong className="dashboard-inline-notice__title">{title}</strong>
        {resolvedMessage ? (
          <span className="dashboard-inline-notice__message">
            {resolvedMessage}
          </span>
        ) : null}
      </div>
      {actions ? (
        <div className="dashboard-inline-notice__actions">{actions}</div>
      ) : null}
    </div>
  );
}
