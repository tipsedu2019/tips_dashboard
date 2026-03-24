export default function DashboardDataSurface({
  header = null,
  summary = null,
  actions = null,
  children,
  variant = 'default',
  className = '',
  testId = '',
}) {
  return (
    <section
      className={[
        'dashboard-data-surface',
        `dashboard-data-surface--${variant}`,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid={testId || undefined}
    >
      {header || summary || actions ? (
        <div className="dashboard-data-surface__header">
          <div className="dashboard-data-surface__header-copy">
            {header}
            {summary ? (
              <div className="dashboard-data-surface__summary">{summary}</div>
            ) : null}
          </div>
          {actions ? (
            <div className="dashboard-data-surface__actions">{actions}</div>
          ) : null}
        </div>
      ) : null}
      <div className="dashboard-data-surface__body">{children}</div>
    </section>
  );
}
