export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className = '',
  children,
  disabled,
  ...props
}) {
  return (
    <button
      className={`ui-button ui-button-${variant} ui-button-${size} ${className}`.trim()}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <span className="ui-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
