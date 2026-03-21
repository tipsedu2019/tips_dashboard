import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle, ChevronRight, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

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
            <div className="toast-item-icon">
              {toastItem.type === 'success' && <CheckCircle size={20} />}
              {toastItem.type === 'error' && <AlertCircle size={20} />}
              {toastItem.type === 'info' && <Info size={20} />}
            </div>

            <span className="toast-item-message">{toastItem.message}</span>

            {toastItem.actionLabel ? (
              <button
                type="button"
                className="toast-item-action"
                onClick={() => {
                  toastItem.onAction?.();
                  removeToast(toastItem.id);
                }}
              >
                <span>{toastItem.actionLabel}</span>
                <ChevronRight size={14} />
              </button>
            ) : null}

            {!toastItem.actionLabel ? (
              <button
                type="button"
                className="toast-item-close"
                onClick={() => removeToast(toastItem.id)}
                aria-label="닫기"
              >
                <X size={16} />
              </button>
            ) : null}
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
