/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        display: ['Inter', 'sans-serif'],
      },
      colors: {
        brand: {
          DEFAULT: '#4F46E5',
          hover: '#4338CA',
          soft: '#EEF2FF',
        },
        accent: '#EC4899',
        success: '#10B981',
        danger: '#EF4444',
        ink: '#111827',
        muted: '#6B7280',
        canvas: '#F5F7FB',
        surface: '#FFFFFF',
        border: '#E5E7EB',
      },
      boxShadow: {
        card: '0 2px 8px rgba(17, 24, 39, 0.04), 0 16px 40px rgba(17, 24, 39, 0.04)',
        float: '0 18px 48px rgba(17, 24, 39, 0.12)',
      },
      borderRadius: { card: '12px', modal: '16px' },
      fontSize: {
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['14px', { lineHeight: '20px' }],
        base: ['16px', { lineHeight: '24px' }],
        lg: ['18px', { lineHeight: '28px' }],
        xl: ['24px', { lineHeight: '32px' }],
        '2xl': ['32px', { lineHeight: '40px' }],
      },
    },
  },
  plugins: [],
};
