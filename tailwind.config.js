module.exports = {
  content: {
    relative: true,
    files: ['./views/**/*.ejs', './public/js/**/*.js']
  },
  theme: {
    extend: {
      colors: {
        navy: {
          950: '#111827',
          900: '#1E293B',
          800: '#172554'
        },
        brand: '#5558CC',
        ink: '#F8FAFC',
        muted: '#A5B4CC',
        stroke: '#334155',
        'input-bg': 'var(--input-bg)',
        success: '#34D399',
        warning: '#FBBF24',
        danger: '#F87171'
      },
      fontFamily: {
        sans: ['Segoe UI', 'Noto Sans Ethiopic', 'Noto Sans Arabic', 'sans-serif']
      },
      boxShadow: {
        panel: '0 16px 40px rgba(2, 6, 23, 0.26)',
        focus: '0 0 0 3px rgba(85, 88, 204, 0.32)'
      },
      borderRadius: {
        panel: '0.875rem'
      }
    }
  },
  plugins: [],
  corePlugins: {
    preflight: true
  }
};
