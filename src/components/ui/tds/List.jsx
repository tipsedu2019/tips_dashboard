import { ChevronRight } from 'lucide-react';

export function ListRow({
  left = null,
  contents = null,
  right = null,
  withArrow = false,
  onPress,
  className = '',
}) {
  const Comp = onPress ? 'button' : 'div';

  return (
    <Comp
      type={onPress ? 'button' : undefined}
      className={['tds-list-row', className].filter(Boolean).join(' ')}
      onClick={onPress}
      style={onPress ? { width: '100%', border: 0, background: 'transparent', textAlign: 'left' } : undefined}
    >
      <div>{left}</div>
      <div className="tds-list-row__content">{contents}</div>
      <div className="tds-inline">
        {right}
        {withArrow ? (
          <span className="tds-list-row__arrow" aria-hidden="true">
            <ChevronRight size={16} />
          </span>
        ) : null}
      </div>
    </Comp>
  );
}

export default function List({
  children,
  rowSeparator = 'indented',
  className = '',
}) {
  return (
    <div className={['tds-list', `tds-list--separator-${rowSeparator}`, className].filter(Boolean).join(' ')}>
      {children}
    </div>
  );
}
