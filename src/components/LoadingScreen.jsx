import { Sprout } from 'lucide-react';

export function LoadingScreen({ message = 'Just a moment…' }) {
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <span className="loading-mark"><Sprout size={22} /></span>
      <span className="loading-spinner" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}
