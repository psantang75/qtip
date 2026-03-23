/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: 'var(--color-primary-blue)',
        'neutral-900': 'var(--color-neutral-900)',
        'neutral-700': 'var(--color-neutral-700)',
        'neutral-600': 'var(--color-neutral-600)',
        'neutral-100': 'var(--color-neutral-100)',
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        danger: 'var(--color-danger)',
      },
      borderRadius: {
        DEFAULT: '6px',
        'md': '8px',
        'lg': '10px',
        'xl': '12px',
      },
      boxShadow: {
        'sm': '0 2px 6px rgba(0,0,0,0.06)',
      },
      spacing: {
        '2': '2px',
        '4': '4px',
        '8': '8px',
        '12': '12px',
        '16': '16px',
        '24': '24px',
        '32': '32px',
        '40': '40px',
        '48': '48px',
        '64': '64px',
      },
      fontSize: {
        'xs': '12px',    // Caption
        'sm': '14px',    // Body-Small
        'base': '16px',  // Body-Large
        'xl': '20px',    // H3
        '2xl': '24px',   // H2
        '3xl': '32px',   // H1/Display
      },
      fontWeight: {
        normal: '400',
        medium: '500',
        semibold: '600',
        bold: '700',
      },
      transitionDuration: {
        '120': '120ms',
      },
      scale: {
        '98': '0.98',
      },
    },
  },
  plugins: [],
} 