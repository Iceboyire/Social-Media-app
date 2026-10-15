export function Dropdown({ open, children, className = '', ...props }) {
  if (!open) return null;
  return <div className={`ui-dropdown ${className}`.trim()} {...props}>{children}</div>;
}
