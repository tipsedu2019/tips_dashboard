import { ArrowLeft } from 'lucide-react';

import { IconButton } from './tds';

export default function ViewHeader({
  icon,
  title,
  description,
  eyebrow = '',
  actions = null,
  align = 'top',
  onBack = null,
  backLabel = 'Go back',
  backTitle = '',
}) {
  return (
    <div className={`view-header-shell tds-list-header ${align === 'center' ? 'is-center' : ''}`}>
      <div className="view-header-copy">
        <div className="view-header-title-row">
          <div className="view-header-leading">
            <div className="tds-inline" style={{ alignItems: align === 'center' ? 'center' : 'flex-start' }}>
              {onBack ? (
                <IconButton
                  variant="border"
                  className="view-header-back"
                  onPress={onBack}
                  label={backTitle || backLabel}
                  icon={<ArrowLeft size={18} />}
                />
              ) : null}
              {icon ? <div className="view-header-icon">{icon}</div> : null}
            </div>

            <div className="view-header-title-group">
              {eyebrow ? <div className="view-header-eyebrow">{eyebrow}</div> : null}
              <h1 className="view-title">{title}</h1>
            </div>
          </div>
        </div>

        {description ? <p className="view-subtitle">{description}</p> : null}
      </div>

      {actions ? <div className="view-header-actions">{actions}</div> : null}
    </div>
  );
}
