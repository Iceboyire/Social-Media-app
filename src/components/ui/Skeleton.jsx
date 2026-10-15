export function Skeleton({ className = '', circle = false }) {
  return <span className={`ui-skeleton${circle ? ' ui-skeleton-circle' : ''} ${className}`.trim()} aria-hidden="true" />;
}
