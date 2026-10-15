import { forwardRef } from 'react';

export const FormField = forwardRef(function FormField({
  label,
  id,
  error,
  hint,
  leading,
  trailing,
  ...inputProps
}, ref) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className={`input-wrap${leading ? ' has-leading' : ''}${trailing ? ' has-trailing' : ''}${error ? ' input-invalid' : ''}`}>
        {leading && <span className="input-leading" aria-hidden="true">{leading}</span>}
        <input
          ref={ref}
          id={id}
          className="text-input"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          {...inputProps}
        />
        {trailing && <span className="input-trailing">{trailing}</span>}
      </div>
      {error
        ? <p className="field-error" id={`${id}-error`}>{error}</p>
        : hint && <p className="field-hint" id={`${id}-hint`}>{hint}</p>}
    </div>
  );
});
