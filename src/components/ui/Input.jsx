export function Input({ label, id, error, hint, className = '', ...props }) {
  return (
    <div className="ui-input-field">
      {label && <label className="ui-input-label" htmlFor={id}>{label}</label>}
      <input
        className={`ui-input ${error ? 'ui-input-error' : ''} ${className}`.trim()}
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...props}
      />
      {error
        ? <span className="ui-input-message ui-input-message-error" id={`${id}-error`}>{error}</span>
        : hint && <span className="ui-input-message" id={`${id}-hint`}>{hint}</span>}
    </div>
  );
}
