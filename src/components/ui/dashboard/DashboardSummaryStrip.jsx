export default function DashboardSummaryStrip({
  items = [],
  className = '',
}) {
  if (!items.length) {
    return null;
  }

  return (
    <div
      className={['dashboard-summary-strip', className].filter(Boolean).join(' ')}
    >
      {items.map((item) => (
        <div key={item.label} className="dashboard-summary-strip__item">
          <span className="dashboard-summary-strip__label">{item.label}</span>
          <strong className="dashboard-summary-strip__value">{item.value}</strong>
        </div>
      ))}
    </div>
  );
}
