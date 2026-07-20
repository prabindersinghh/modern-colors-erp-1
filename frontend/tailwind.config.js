/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        // The brand accent (red). Separate from `primary` (warm ink) so ordinary
        // actions are calm and red stays meaningful, and separate from
        // `critical` so "branded" never reads as "broken".
        'accent-brand': {
          DEFAULT: 'hsl(var(--accent-brand))',
          foreground: 'hsl(var(--accent-brand-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          border: 'hsl(var(--sidebar-border))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
          surface: 'hsl(var(--warning-surface))',
          border: 'hsl(var(--warning-border))',
        },

        /* --- Paint Chip additions ---------------------------------------- */
        // Raw brand hues — logo-adjacent accents and chart series.
        brand: {
          red: 'hsl(var(--brand-red))',
          yellow: 'hsl(var(--brand-yellow))',
          violet: 'hsl(var(--brand-violet))',
          amber: 'hsl(var(--brand-amber))',
        },
        // Warm neutral ramp — the "paper stock" greys.
        chip: {
          50: 'hsl(var(--chip-50))',
          100: 'hsl(var(--chip-100))',
          200: 'hsl(var(--chip-200))',
          300: 'hsl(var(--chip-300))',
          400: 'hsl(var(--chip-400))',
          500: 'hsl(var(--chip-500))',
          600: 'hsl(var(--chip-600))',
          700: 'hsl(var(--chip-700))',
          800: 'hsl(var(--chip-800))',
          900: 'hsl(var(--chip-900))',
          950: 'hsl(var(--chip-950))',
        },
        // Severity language. Each level ships a solid, a foreground, a tinted
        // surface and a border, so an alert never needs a one-off colour.
        critical: {
          DEFAULT: 'hsl(var(--critical))',
          foreground: 'hsl(var(--critical-foreground))',
          surface: 'hsl(var(--critical-surface))',
          border: 'hsl(var(--critical-border))',
        },
        healthy: {
          DEFAULT: 'hsl(var(--healthy))',
          foreground: 'hsl(var(--healthy-foreground))',
          surface: 'hsl(var(--healthy-surface))',
          border: 'hsl(var(--healthy-border))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          foreground: 'hsl(var(--info-foreground))',
          surface: 'hsl(var(--info-surface))',
          border: 'hsl(var(--info-border))',
        },
        chart: {
          add: 'hsl(var(--chart-add))',
          deduct: 'hsl(var(--chart-deduct))',
          discard: 'hsl(var(--chart-discard))',
          grid: 'hsl(var(--chart-grid))',
          axis: 'hsl(var(--chart-axis))',
        },
      },
      borderRadius: {
        xl: 'var(--radius-xl)',
        lg: 'var(--radius-lg)',
        DEFAULT: 'var(--radius)',
        md: 'var(--radius)',
        sm: 'var(--radius-sm)',
      },
      boxShadow: {
        'elev-1': 'var(--elev-1)',
        'elev-2': 'var(--elev-2)',
        'elev-3': 'var(--elev-3)',
        'elev-4': 'var(--elev-4)',
        'elev-5': 'var(--elev-5)',
        glow: 'var(--glow-primary)',
      },
      fontFamily: {
        // Inter was declared here before but never actually loaded, so the app
        // silently rendered in system-ui. It is now self-hosted via @fontsource.
        sans: ['Inter var', 'Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // Type scale with line-height and tracking baked in, so headings stay
        // consistent without per-callsite tuning.
        display: ['2.75rem', { lineHeight: '1.05', letterSpacing: '-0.03em', fontWeight: '800' }],
        'title-1': ['2rem', { lineHeight: '1.15', letterSpacing: '-0.025em', fontWeight: '700' }],
        'title-2': ['1.5rem', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '700' }],
        'title-3': ['1.125rem', { lineHeight: '1.3', letterSpacing: '-0.015em', fontWeight: '600' }],
        metric: ['2.25rem', { lineHeight: '1', letterSpacing: '-0.03em', fontWeight: '700' }],
        label: ['0.6875rem', { lineHeight: '1.2', letterSpacing: '0.08em', fontWeight: '600' }],
      },
      transitionTimingFunction: {
        out: 'var(--ease-out)',
        'in-out': 'var(--ease-in-out)',
        spring: 'var(--ease-spring)',
        exit: 'var(--ease-exit)',
      },
      transitionDuration: {
        instant: 'var(--dur-instant)',
        fast: 'var(--dur-fast)',
        base: 'var(--dur-base)',
        slow: 'var(--dur-slow)',
        deliberate: 'var(--dur-deliberate)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
