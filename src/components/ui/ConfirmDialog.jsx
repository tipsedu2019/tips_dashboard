import { AlertTriangle } from 'lucide-react';
import { Button } from './tds';

export default function ConfirmDialog({
  open,
  title = '확인이 필요합니다.',
  description = '',
  confirmLabel = '확인',
  cancelLabel = '취소',
  tone = 'danger',
  onConfirm,
  onCancel
}) {
  if (!open) return null;

  const dialogClassName = [
    'confirm-dialog-card',
    tone === 'danger' ? 'is-danger' : 'is-accent',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div onClick={onCancel} className="confirm-dialog-overlay">
      <div
        onClick={(event) => event.stopPropagation()}
        className={dialogClassName}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <div className="confirm-dialog-header">
          <div className="confirm-dialog-icon">
            <AlertTriangle size={20} />
          </div>
          <div className="confirm-dialog-copy">
            <h3 id="confirm-dialog-title" className="confirm-dialog-title">{title}</h3>
            {description && (
              <p className="confirm-dialog-description">{description}</p>
            )}
          </div>
        </div>

        <div className="confirm-dialog-actions">
          <Button style="weak" type="dark" size="medium" onPress={onCancel}>
            {cancelLabel}
          </Button>
          <Button className="confirm-dialog-confirm" type={tone === 'danger' ? 'danger' : 'primary'} size="medium" onPress={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
