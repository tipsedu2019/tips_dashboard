import { ArrowLeft } from 'lucide-react';

export default function ViewHeader({
  icon,
  title,
  description,
  eyebrow = '',
  actions = null,
  align = 'top',
  onBack = null,
  backLabel = '이전 화면으로 돌아가기',
  backTitle = '',
}) {
  return (
    <div className={`view-header-shell ${align === 'center' ? 'is-center' : ''}`}>
      <div className="view-header-copy">
        <div className="view-header-title-row">
          {onBack ? (
            <button
              type="button"
              className="view-header-back"
              onClick={onBack}
              title={backTitle || backLabel}
              aria-label={backTitle || backLabel}
            >
              <ArrowLeft size={18} />
            </button>
          ) : null}
          {icon ? <div className="view-header-icon">{icon}</div> : null}
          <div>
            {eyebrow ? <div className="view-header-eyebrow">{eyebrow}</div> : null}
            <h1 className="view-title">{title}</h1>
          </div>
        </div>
        {description ? <p className="view-subtitle">{description}</p> : null}
      </div>

      {actions ? <div className="view-header-actions">{actions}</div> : null}
    </div>
  );
}
