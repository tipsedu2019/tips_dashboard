export default function DashboardMetricCard({
  icon = null,
  eyebrow = '',
  value,
  label = '',
  meta = '',
  right = null,
  className = '',
}) {
  return (
    <section
      className={['dashboard-metric-card', className].filter(Boolean).join(' ')}
    >
      <div className="dashboard-metric-card__head">
        <div className="dashboard-metric-card__icon">{icon}</div>
        {right ? (
          <div className="dashboard-metric-card__right">{right}</div>
        ) : null}
      </div>
      {eyebrow ? (
        <div className="dashboard-metric-card__eyebrow">{eyebrow}</div>
      ) : null}
      <div className="dashboard-metric-card__value">{value}</div>
      {label ? <div className="dashboard-metric-card__label">{label}</div> : null}
      {meta ? <div className="dashboard-metric-card__meta">{meta}</div> : null}
    </section>
  );
}
