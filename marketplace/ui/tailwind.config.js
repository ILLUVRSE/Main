/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{ts,tsx,js,jsx}',
    './src/**/*.{ts,tsx,js,jsx}',
    './components/**/*.{ts,tsx,js,jsx}',
    './pages/**/*.{ts,tsx,js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        illuvrse: {
          DEFAULT: '#1C8174',          // primary
          light: '#49B2A2',            // primary-light
          dark: '#0CFD44',             // primary-dark (use cautiously)
          gold: '#E2B443',             // accent gold
          gold2: '#C89C2E',            // accent gold 2
          glow: '#7FFFD4',             // glowing highlight
          bg: '#FFFFFF',
          bgDark: '#0A1A1A',
          muted: '#6B7A78',
          text: '#042A2A'
        }
      },
      borderRadius: {
        'md-lg': '10px',
        'lg-xl': '14px'
      },
      boxShadow: {
        'illuvrse-soft': '0 8px 30px rgba(10, 20, 20, 0.06)',
        'illuvrse-strong': '0 12px 40px rgba(10, 20, 20, 0.12)'
      },
      fontFamily: {
        heading: ['"Playfair Display"', 'serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif']
      },
      spacing: {
        '9': '2.25rem',
        '18': '4.5rem'
      }
    }
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography')
  ]
};

