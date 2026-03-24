export default function DashboardFilterBar({
  children,
  summaryTokens = [],
  compact = false,
  className = '',
}) {
  return (
    <div
      className={[
        'dashboard-filter-bar',
        compact ? 'is-compact' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="dashboard-filter-bar__content">{children}</div>
      {summaryTokens.length > 0 ? (
        <div className="dashboard-filter-bar__summary">
          {summaryTokens.map((token) => (
            <span key={token} className="dashboard-filter-bar__token">
              {token}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
