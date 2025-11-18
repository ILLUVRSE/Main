/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    // Next.js app router + src
    './app/**/*.{js,ts,jsx,tsx}',
    './src/**/*.{js,ts,jsx,tsx}',
    // include any top-level components/pages you might add
    './components/**/*.{js,ts,jsx,tsx}',
    './pages/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // convenience mapping to your tokens (you still use CSS tokens)
        illuvrse: {
          500: '#1C8174',
          600: '#0F7466',
          700: '#0C5B4F',
        },
        gold: {
          DEFAULT: '#E2B443',
        },
      },
      boxShadow: {
        // allows `shadow-illuvrse-soft` to be used via @apply in your CSS
        'illuvrse-soft': 'var(--card-shadow)',
      },
      fontFamily: {
        heading: ['"Playfair Display"', 'Georgia', 'Times New Roman', 'serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto'],
      },
    },
  },
  plugins: [],
};

