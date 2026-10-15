import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

const icons = {
  error: AlertCircle,
  success: CheckCircle2,
  info: Info,
};

export function Toast({ message, type = 'error', onDismiss }) {
  const Icon = icons[type] ?? icons.info;
  return (
    <div className={`toast toast-${type}`} role={type === 'error' ? 'alert' : 'status'}>
      <Icon size={19} aria-hidden="true" />
      <p>{message}</p>
      <button className="toast-dismiss" type="button" aria-label="Dismiss notification" onClick={onDismiss}>
        <X size={16} />
      </button>
    </div>
  );
}
