import { Moon, Sun } from 'lucide-react';

export function ThemeToggle({ dark, onToggle }) {
  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={onToggle}
      aria-label={`Switch to ${dark ? 'light' : 'dark'} mode`}
      title={`Switch to ${dark ? 'light' : 'dark'} mode`}
    >
      {dark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
