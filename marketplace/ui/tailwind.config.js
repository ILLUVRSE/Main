require('ts-node/register');
const { tokens } = require('./src/styles/tokens');

/** @type {import('tailwindcss').Config} */
module.exports = {
  important: true,
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
        primary: tokens.colors.primary,
        'primary-light': tokens.colors.primaryLight,
        'primary-dark': tokens.colors.primaryDark,
        accent: tokens.colors.accentGold,
        'accent-dark': tokens.colors.accentGoldDark,
        background: tokens.colors.backgroundLight,
        'background-dark': tokens.colors.backgroundDark,
        glow: tokens.colors.glow,
        text: tokens.colors.text,
        'text-muted': tokens.colors.textMuted,
        outline: tokens.colors.outline,
        surface: tokens.colors.surface,
        'surface-elevated': tokens.colors.surfaceElevated,
      },
      boxShadow: {
        card: tokens.shadows.card,
        header: tokens.shadows.header,
        focus: tokens.shadows.focus,
      },
      fontFamily: {
        heading: tokens.typography.fonts.heading
          .split(',')
          .map((part) => part.trim().replace(/^"|"$/g, '')),
        sans: tokens.typography.fonts.body
          .split(',')
          .map((part) => part.trim().replace(/^"|"$/g, '')),
        accent: tokens.typography.fonts.accent
          .split(',')
          .map((part) => part.trim().replace(/^"|"$/g, '')),
      },
      fontSize: {
        xs: tokens.typography.sizes.xs,
        sm: tokens.typography.sizes.sm,
        base: tokens.typography.sizes.md,
        lg: tokens.typography.sizes.lg,
        xl: tokens.typography.sizes.xl,
        '2xl': tokens.typography.sizes['2xl'],
        '3xl': tokens.typography.sizes['3xl'],
        display: tokens.typography.sizes.display,
        hero: tokens.typography.sizes.hero,
      },
      spacing: tokens.spacing,
      borderRadius: tokens.radii,
      container: {
        center: true,
        padding: {
          DEFAULT: tokens.spacing.md,
          lg: tokens.spacing.lg,
          xl: tokens.spacing.xl,
        },
      },
    },
  },
  plugins: [],
};
