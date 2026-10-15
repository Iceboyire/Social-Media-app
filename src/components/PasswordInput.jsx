import { Eye, EyeOff, LockKeyhole } from 'lucide-react';
import { useState } from 'react';
import { FormField } from './FormField';

export function PasswordInput({
  id = 'password',
  label = 'Password',
  error,
  autoComplete = 'current-password',
  value,
  onChange,
  showStrength = false,
}) {
  const [visible, setVisible] = useState(false);
  const score = [value?.length >= 8, /[A-Z]/.test(value ?? ''), /[0-9]/.test(value ?? ''), /[^A-Za-z0-9]/.test(value ?? '')]
    .filter(Boolean).length;
  const strengthLabel = ['Add a little more strength', 'A start', 'Getting stronger', 'Looking good', 'Strong password'][score];

  return (
    <>
      <FormField
        id={id}
        label={label}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        value={value}
        onChange={onChange}
        error={error}
        leading={<LockKeyhole size={17} />}
        trailing={
          <button
            className="password-toggle"
            type="button"
            onClick={() => setVisible((current) => !current)}
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
          >
            {visible ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        }
      />
      {showStrength && value && (
        <div className="strength-meter" aria-live="polite">
          <div className="strength-bars" aria-hidden="true">
            {[1, 2, 3, 4].map((step) => (
              <span className={score >= step ? `strength-on strength-${score}` : ''} key={step} />
            ))}
          </div>
          <span>{strengthLabel}</span>
        </div>
      )}
    </>
  );
}
