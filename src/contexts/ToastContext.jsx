import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((message, type = 'success', duration = 3000) => {
    const id = Date.now().toString() + Math.random().toString(36).substring(7);
    setToasts((prev) => [...prev, { id, message, type }]);

    if (duration > 0) {
      setTimeout(() => removeToast(id), duration);
    }
  }, [removeToast]);

  const value = useMemo(() => ({
    toast: {
      success: (msg) => addToast(msg, 'success'),
      error: (msg) => addToast(msg, 'error'),
      info: (msg) => addToast(msg, 'info'),
    }
  }), [addToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div 
        style={{ 
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999, 
          display: 'flex', flexDirection: 'column', gap: 10, pointerEvents: 'none' 
        }}
      >
        {toasts.map((t) => (
          <div 
            key={t.id} 
            className="animate-toast"
            style={{ 
              background: 'var(--bg-surface)', 
              color: 'var(--text-primary)',
              padding: '12px 16px', 
              borderRadius: 12, 
              boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
              display: 'flex', 
              alignItems: 'center', 
              gap: 12,
              border: `1px solid var(--border-color)`,
              minWidth: 280,
              pointerEvents: 'auto'
            }}
          >
            {t.type === 'success' && <CheckCircle size={20} color="#10b981" />}
            {t.type === 'error' && <AlertCircle size={20} color="#ef4444" />}
            {t.type === 'info' && <Info size={20} color="#3b82f6" />}
            <span style={{ fontSize: 14, fontWeight: 500, flex: 1 }}>{t.message}</span>
            <button 
              onClick={() => removeToast(t.id)} 
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
            >
              <X size={16} />
            </button>
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
