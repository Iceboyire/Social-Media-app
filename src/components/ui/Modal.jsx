import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export function Modal({ open, onClose, title, children, size = 'md' }) {
  useEffect(() => {
    if (!open) return undefined;
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="ui-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose?.();
    }}>
      <section className={`ui-modal ui-modal-${size}`} role="dialog" aria-modal="true" aria-labelledby="ui-modal-title">
        <header className="ui-modal-header">
          <h2 id="ui-modal-title">{title}</h2>
          <button className="ui-icon-button" type="button" aria-label="Close dialog" onClick={onClose}><X size={19} /></button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  );
}
