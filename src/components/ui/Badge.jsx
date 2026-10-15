export function Badge({ children, variant = 'default', className = '' }) {
  return <span className={`ui-badge ui-badge-${variant} ${className}`.trim()}>{children}</span>;
}

export function CountBadge({ count }) {
  if (!count) return null;
  return <span className="ui-count-badge" role="img" aria-label={`${count} new items`}>{count > 99 ? '99+' : count}</span>;
}
