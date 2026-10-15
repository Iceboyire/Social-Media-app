import { Check, CircleAlert, LoaderCircle, AtSign } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FormField } from './FormField';
import { checkUsernameAvailability } from '../lib/profile';
import { isSupabaseConfigured } from '../lib/supabase';

export function UsernameField({ value, onChange, error, onAvailability }) {
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value.trim().toLowerCase()), 350);
    return () => window.clearTimeout(timer);
  }, [value]);

  const valid = /^[a-z0-9_]{3,24}$/.test(debounced);
  const query = useQuery({
    queryKey: ['username-availability', debounced],
    queryFn: () => checkUsernameAvailability(debounced),
    enabled: valid && isSupabaseConfigured,
    staleTime: 10_000,
    retry: false,
  });

  useEffect(() => {
    const isCurrentValue = value.trim().toLowerCase() === debounced;
    onAvailability(isCurrentValue && valid && query.data === true, query.isError);
  }, [value, debounced, valid, query.data, query.isError, onAvailability]);

  let hint = '3–24 characters. Letters, numbers, and underscores.';
  let trailing = null;
  if (debounced && valid && value.trim().toLowerCase() === debounced) {
    if (query.isFetching) {
      trailing = <LoaderCircle size={17} className="spin-icon" aria-label="Checking username" />;
      hint = 'Checking availability…';
    } else if (query.isError) {
      trailing = <CircleAlert size={17} className="username-error-icon" />;
      hint = 'Could not check availability. Try again in a moment.';
    } else if (query.data === true) {
      trailing = <Check size={17} className="username-success-icon" />;
      hint = 'That username is yours.';
    } else if (query.data === false) {
      trailing = <CircleAlert size={17} className="username-error-icon" />;
      hint = 'That username is already taken.';
    }
  }

  return (
    <FormField
      id="username"
      label="Username"
      placeholder="yourname"
      autoComplete="username"
      autoCapitalize="none"
      spellCheck="false"
      maxLength={24}
      value={value}
      onChange={onChange}
      error={error}
      hint={hint}
      leading={<AtSign size={17} />}
      trailing={trailing}
    />
  );
}
