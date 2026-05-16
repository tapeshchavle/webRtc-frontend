import React, { useState, useCallback, useRef, useEffect } from 'react';

let toastIdCounter = 0;
let globalAddToast = null;

// Hook to use the toast system from any component
export function useToast() {
  return useCallback((message, type = 'info', duration = 4000) => {
    if (globalAddToast) {
      globalAddToast(message, type, duration);
    }
  }, []);
}

// Standalone function to trigger toasts from outside React components
export function showToast(message, type = 'info', duration = 4000) {
  if (globalAddToast) {
    globalAddToast(message, type, duration);
  }
}

function ToastItem({ toast, onRemove }) {
  const [isExiting, setIsExiting] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setIsExiting(true);
      setTimeout(() => onRemove(toast.id), 300);
    }, toast.duration);

    return () => clearTimeout(timerRef.current);
  }, [toast, onRemove]);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => onRemove(toast.id), 300);
  };

  const typeStyles = {
    info: { borderColor: '#8ab4f8', icon: 'ℹ' },
    success: { borderColor: '#81c995', icon: '✓' },
    warning: { borderColor: '#fdd663', icon: '⚠' },
    error: { borderColor: '#f28b82', icon: '✕' },
  };

  const config = typeStyles[toast.type] || typeStyles.info;

  return (
    <div
      className={`toast-item ${isExiting ? 'toast-exit' : 'toast-enter'}`}
      style={{ borderLeft: `3px solid ${config.borderColor}` }}
    >
      <span className="toast-icon" style={{ color: config.borderColor }}>{config.icon}</span>
      <span className="toast-message">{toast.message}</span>
      <button className="toast-close" onClick={handleClose}>×</button>
      <div className="toast-progress" style={{
        animationDuration: `${toast.duration}ms`,
        background: config.borderColor,
      }} />
    </div>
  );
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type, duration) => {
    const id = ++toastIdCounter;
    setToasts(prev => [...prev.slice(-4), { id, message, type, duration }]);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    globalAddToast = addToast;
    return () => { globalAddToast = null; };
  }, [addToast]);

  return (
    <div className="toast-container">
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
      ))}
    </div>
  );
}
