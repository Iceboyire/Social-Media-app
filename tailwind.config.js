/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'sans-serif'],
        display: ['Manrope', 'sans-serif'],
      },
      colors: {
        ink: '#1b2922',
        forest: '#183d31',
        sage: '#e9eee7',
        lime: '#d5ed8b',
      },
      boxShadow: {
        card: '0 24px 70px rgba(26, 49, 39, 0.10)',
      },
    },
  },
  plugins: [],
};
