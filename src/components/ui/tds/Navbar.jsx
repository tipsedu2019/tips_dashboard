export default function Navbar({
  left = null,
  title = null,
  right = null,
  className = '',
}) {
  return (
    <div className={['tds-navbar', className].filter(Boolean).join(' ')}>
      <div className="tds-navbar__side">{left}</div>
      <div className="tds-navbar__title">{title}</div>
      <div className="tds-navbar__side" style={{ justifyContent: 'flex-end' }}>{right}</div>
    </div>
  );
}
