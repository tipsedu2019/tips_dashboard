import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle, Info } from 'lucide-react';

import Toast from '../components/ui/tds/Toast';

const ToastContext = createContext(null);

function getToastIcon(type) {
  if (type === 'success') {
    return <CheckCircle size={20} />;
  }

  if (type === 'error') {
    return <AlertCircle size={20} />;
  }

  return <Info size={20} />;
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toastItem) => toastItem.id !== id));
  }, []);

  const addToast = useCallback((message, type = 'success', options = {}) => {
    const normalizedOptions = typeof options === 'number' ? { duration: options } : (options || {});
    const {
      duration = 3000,
      actionLabel = '',
      onAction = null,
    } = normalizedOptions;

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    setToasts((prev) => [
      ...prev,
      {
        id,
        message,
        type,
        actionLabel,
        onAction: typeof onAction === 'function' ? onAction : null,
      },
    ]);

    if (duration > 0) {
      setTimeout(() => removeToast(id), duration);
    }
  }, [removeToast]);

  const value = useMemo(() => ({
    toast: {
      success: (message, options) => addToast(message, 'success', options),
      error: (message, options) => addToast(message, 'error', options),
      info: (message, options) => addToast(message, 'info', options),
    },
  }), [addToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack">
        {toasts.map((toastItem) => (
          <div key={toastItem.id} className={`animate-toast toast-item is-${toastItem.type}`}>
            <Toast
              type={toastItem.type}
              text={toastItem.message}
              icon={getToastIcon(toastItem.type)}
              actionLabel={toastItem.actionLabel}
              onAction={() => {
                toastItem.onAction?.();
                removeToast(toastItem.id);
              }}
              onClose={() => removeToast(toastItem.id)}
            />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }

  return context.toast;
}
