import Button from './Button';

export function AlertDialog({
  open,
  title,
  description = '',
  buttonText = 'OK',
  onButtonPress,
  onClose,
  content = null,
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="confirm-dialog-overlay" onClick={onClose}>
      <div className="tds-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="tds-dialog__content">
          <div className="tds-dialog__title">{title}</div>
          {description ? <div className="tds-dialog__description">{description}</div> : null}
          {content}
        </div>
        <div className="tds-dialog__actions">
          <Button onPress={onButtonPress || onClose}>{buttonText}</Button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description = '',
  leftButton = null,
  rightButton = null,
  onClose,
  content = null,
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="confirm-dialog-overlay" onClick={onClose}>
      <div className="tds-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="tds-dialog__content">
          <div className="tds-dialog__title">{title}</div>
          {description ? <div className="tds-dialog__description">{description}</div> : null}
          {content}
        </div>
        <div className="tds-dialog__actions">
          {leftButton}
          {rightButton}
        </div>
      </div>
    </div>
  );
}
