import { Search } from 'lucide-react';
import { TextField } from '../tds';

function renderSearch(search) {
  if (!search) {
    return null;
  }

  if (typeof search !== 'object' || Array.isArray(search) || search.$$typeof) {
    return search;
  }

  return (
    <TextField
      variant={search.variant || 'big'}
      value={search.value}
      onChangeText={search.onChangeText}
      placeholder={search.placeholder || ''}
      label={search.label || ''}
      labelOption={search.labelOption || 'appear'}
      help={search.help || null}
      hasError={search.hasError || false}
      prefix={search.prefix || <Search size={16} aria-hidden="true" />}
      right={search.right || null}
      className={search.className || ''}
    />
  );
}

export default function DashboardTopRail({
  title = '',
  description = '',
  eyebrow = '',
  summary = null,
  actions = null,
  search = null,
  contextTabs = null,
  filterBar = null,
  sticky = true,
  className = '',
  children = null,
  testId = '',
}) {
  return (
    <section
      className={['dashboard-top-rail', sticky ? 'is-sticky' : '', className]
        .filter(Boolean)
        .join(' ')}
      data-testid={testId || undefined}
    >
      <div className="dashboard-top-rail__inner">
        {search || actions ? (
          <div className="dashboard-top-rail__row dashboard-top-rail__row--primary">
            {search ? (
              <div className="dashboard-top-rail__search">{renderSearch(search)}</div>
            ) : (
              <div />
            )}
            {actions ? (
              <div className="dashboard-top-rail__actions">{actions}</div>
            ) : null}
          </div>
        ) : null}

        {title ? (
          <div className="dashboard-top-rail__hero">
            <div className="dashboard-top-rail__hero-copy">
              {eyebrow ? (
                <div className="dashboard-top-rail__eyebrow">{eyebrow}</div>
              ) : null}
              <h1 className="dashboard-top-rail__title">{title}</h1>
              {description ? (
                <p className="dashboard-top-rail__description">{description}</p>
              ) : null}
            </div>
            {summary ? (
              <div className="dashboard-top-rail__summary">{summary}</div>
            ) : null}
          </div>
        ) : null}

        {contextTabs ? (
          <div className="dashboard-top-rail__row dashboard-top-rail__row--tabs">
            {contextTabs}
          </div>
        ) : null}

        {filterBar ? (
          <div className="dashboard-top-rail__row dashboard-top-rail__row--filters">
            {filterBar}
          </div>
        ) : null}

        {children ? (
          <div className="dashboard-top-rail__row dashboard-top-rail__row--extra">
            {children}
          </div>
        ) : null}
      </div>
    </section>
  );
}
