/**
 * NEXUS design tokens.
 *
 * Neutrals are warm (a hint of brown in every grey) so the canvas reads as
 * graphite rather than navy. Colour is reserved for state:
 *
 *   amber   deadlines and warnings
 *   red     critical and overdue
 *   green   verified and completed
 *   blue    informational only
 *   violet  evidence links, the one secondary accent
 *
 * Contrast is checked, not assumed: ink, ink-2 and ink-3 clear 4.5:1 on every
 * surface; ink-4 is for decoration and disabled states only.
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/client/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#0B0B0A',
        s1: '#111110',
        s2: '#171715',
        s3: '#1E1E1B',
        s4: '#262622',
        ink: { DEFAULT: '#ECE7DD', 2: '#B3ADA2', 3: '#8C867C', 4: '#6A655D' },
        line: { DEFAULT: 'rgba(236,231,221,0.07)', strong: 'rgba(236,231,221,0.12)', bright: 'rgba(236,231,221,0.22)' },
        amber: { DEFAULT: '#E7A24A', soft: 'rgba(231,162,74,0.12)', line: 'rgba(231,162,74,0.35)' },
        red: { DEFAULT: '#EC6A58', soft: 'rgba(236,106,88,0.12)', line: 'rgba(236,106,88,0.38)' },
        green: { DEFAULT: '#72C495', soft: 'rgba(114,196,149,0.11)', line: 'rgba(114,196,149,0.32)' },
        blue: { DEFAULT: '#8FAACB', soft: 'rgba(143,170,203,0.11)', line: 'rgba(143,170,203,0.32)' },
        violet: { DEFAULT: '#AE9FE0', soft: 'rgba(174,159,224,0.11)', line: 'rgba(174,159,224,0.32)' },
        paper: { DEFAULT: '#F3F0EA', ink: '#1C1B19', 2: '#5E5A53', line: '#DDD8CF' },
      },
      fontFamily: {
        sans: ['"Geist Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono Variable"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        micro: ['10.5px', { lineHeight: '14px', letterSpacing: '0.12em' }],
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['13px', { lineHeight: '19px' }],
        base: ['14px', { lineHeight: '21px' }],
        md: ['15px', { lineHeight: '22px' }],
        lg: ['17px', { lineHeight: '24px' }],
        xl: ['20px', { lineHeight: '26px', letterSpacing: '-0.01em' }],
        '2xl': ['26px', { lineHeight: '32px', letterSpacing: '-0.015em' }],
        '3xl': ['34px', { lineHeight: '40px', letterSpacing: '-0.02em' }],
        '4xl': ['46px', { lineHeight: '50px', letterSpacing: '-0.03em' }],
        clock: ['76px', { lineHeight: '76px', letterSpacing: '-0.045em' }],
      },
      borderRadius: {
        xs: '6px',
        sm: '8px',
        md: '10px',
        lg: '14px',
        xl: '16px',
        '2xl': '20px',
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.025) inset, 0 12px 32px -18px rgba(0,0,0,0.7)',
        raise: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 18px 40px -16px rgba(0,0,0,0.75)',
        overlay: '0 1px 0 0 rgba(255,255,255,0.05) inset, 0 32px 80px -24px rgba(0,0,0,0.85)',
        focus: '0 0 0 2px #0B0B0A, 0 0 0 4px rgba(231,162,74,0.7)',
      },
      maxWidth: {
        page: '1440px',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
}
