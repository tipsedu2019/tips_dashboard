export default function ListHeader({
  upper = null,
  title,
  right = null,
  lower = null,
  className = '',
}) {
  return (
    <div className={['tds-list-header', className].filter(Boolean).join(' ')}>
      {upper}
      <div className="tds-list-header__top">
        <div style={{ minWidth: 0 }}>{title}</div>
        {right ? <div>{right}</div> : null}
      </div>
      {lower ? <div className="tds-list-header__description">{lower}</div> : null}
    </div>
  );
}
