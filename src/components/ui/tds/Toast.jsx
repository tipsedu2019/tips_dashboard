import { X } from 'lucide-react';

import IconButton from './IconButton';
import TextButton from './TextButton';

export default function Toast({
  icon = null,
  text,
  type = 'info',
  actionLabel = '',
  onAction = null,
  onClose = null,
}) {
  return (
    <div className={`tds-toast tds-toast--${type}`}>
      {icon ? <div className="tds-toast__icon">{icon}</div> : null}
      <div className="tds-toast__message">{text}</div>
      {actionLabel ? (
        <TextButton
          className="tds-toast__action"
          color="#ffffff"
          variant="arrow"
          typography="t6"
          onPress={onAction}
        >
          {actionLabel}
        </TextButton>
      ) : null}
      {!actionLabel && onClose ? (
        <IconButton
          className="tds-toast__close"
          variant="clear"
          label="Close toast"
          onPress={onClose}
          color="#ffffff"
          icon={<X size={18} />}
          iconSize={18}
        />
      ) : null}
    </div>
  );
}
