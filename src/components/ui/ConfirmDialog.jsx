import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  loading = false,
  destructive = false,
}) {
  return (
    <Modal open={open} onClose={loading ? undefined : onClose} title={title} size="sm">
      <div className="ui-confirm-body">
        <span className={`ui-confirm-icon${destructive ? ' ui-confirm-icon-danger' : ''}`}><AlertTriangle size={21} /></span>
        <p>{message}</p>
      </div>
      <footer className="ui-modal-actions">
        <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
        <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
      </footer>
    </Modal>
  );
}
