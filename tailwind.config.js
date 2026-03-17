/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  safelist: [
    // Dynamic classes used in JS template literals
    'badge-rr-ok', 'badge-rr-warn', 'badge-weight',
    'check-label', 'checked', 'checked-warn',
    'alert-danger', 'alert-warn', 'alert-info',
    'btn-primary', 'saved',
    'section-card', 'section-title',
  ],
  plugins: [],
}
