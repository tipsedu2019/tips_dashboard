export default function DashboardSectionIntro({
  eyebrow = '',
  title,
  description = '',
  right = null,
  compact = false,
  className = '',
}) {
  return (
    <div
      className={[
        'dashboard-section-intro',
        compact ? 'is-compact' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="dashboard-section-intro__copy">
        {eyebrow ? (
          <div className="dashboard-section-intro__eyebrow">{eyebrow}</div>
        ) : null}
        <div className="dashboard-section-intro__row">
          <div>
            <h2 className="dashboard-section-intro__title">{title}</h2>
            {description ? (
              <p className="dashboard-section-intro__description">
                {description}
              </p>
            ) : null}
          </div>
          {right ? (
            <div className="dashboard-section-intro__right">{right}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
