import { useState } from 'react';

export function Avatar({ src, name = 'Member', size = 'md', online = false, className = '' }) {
  const [imageFailed, setImageFailed] = useState(false);
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
  return (
    <span className={`ui-avatar ui-avatar-${size} ${className}`.trim()}>
      {src && !imageFailed
        ? <img src={src} alt={`${name}'s profile`} onError={() => setImageFailed(true)} />
        : <span aria-hidden="true">{initials}</span>}
      {online && <i className="ui-avatar-online" role="img" aria-label="Online" />}
    </span>
  );
}
