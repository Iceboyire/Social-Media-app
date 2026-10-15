import { Link } from 'react-router-dom';
import { Sprout } from 'lucide-react';

export function Brand({ light = false, to = '/' }) {
  return (
    <Link className={`brand${light ? ' brand-light' : ''}`} to={to} aria-label="Gather home">
      <span className="brand-mark"><Sprout size={20} strokeWidth={2.2} /></span>
      <span>gather<span className="brand-period">.</span></span>
    </Link>
  );
}
