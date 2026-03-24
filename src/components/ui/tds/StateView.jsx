export default function StateView({
  icon = null,
  title,
  description = '',
  center = false,
  className = '',
  children = null,
}) {
  return (
    <div className={['tds-state-view', center ? 'tds-state-view--center' : '', className].filter(Boolean).join(' ')}>
      {icon}
      {title ? <div className="tds-state-view__title">{title}</div> : null}
      {description ? <div className="tds-state-view__description">{description}</div> : null}
      {children}
    </div>
  );
}
