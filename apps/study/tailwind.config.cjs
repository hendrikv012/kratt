/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "app-bg": "rgb(var(--bg) / <alpha-value>)",
        "app-panel": "rgb(var(--panel) / <alpha-value>)",
        "app-border": "rgb(var(--border) / <alpha-value>)",
        "app-text": "rgb(var(--text) / <alpha-value>)",
        "app-muted": "rgb(var(--muted) / <alpha-value>)",
        "app-accent": "rgb(var(--accent) / <alpha-value>)",
        "app-accent-fg": "rgb(var(--accent-fg) / <alpha-value>)",
        "app-titlebar": "rgb(var(--app-titlebar) / <alpha-value>)",
        "st-background": "hsl(var(--st-c-background) / <alpha-value>)",
        "st-foreground": "hsl(var(--st-c-foreground) / <alpha-value>)",
        "st-card": "hsl(var(--st-c-card) / <alpha-value>)",
        "st-card-foreground": "hsl(var(--st-c-card-foreground) / <alpha-value>)",
        "st-popover": "hsl(var(--st-c-popover) / <alpha-value>)",
        "st-popover-foreground": "hsl(var(--st-c-popover-foreground) / <alpha-value>)",
        "st-primary": "hsl(var(--st-c-primary) / <alpha-value>)",
        "st-primary-foreground": "hsl(var(--st-c-primary-foreground) / <alpha-value>)",
        "st-secondary": "hsl(var(--st-c-secondary) / <alpha-value>)",
        "st-secondary-foreground": "hsl(var(--st-c-secondary-foreground) / <alpha-value>)",
        "st-muted": "hsl(var(--st-c-muted) / <alpha-value>)",
        "st-muted-foreground": "hsl(var(--st-c-muted-foreground) / <alpha-value>)",
        "st-accent": "hsl(var(--st-c-accent) / <alpha-value>)",
        "st-accent-foreground": "hsl(var(--st-c-accent-foreground) / <alpha-value>)",
        "st-destructive": "hsl(var(--st-c-destructive) / <alpha-value>)",
        "st-destructive-foreground": "hsl(var(--st-c-destructive-foreground) / <alpha-value>)",
        "st-border": "hsl(var(--st-c-border) / <alpha-value>)",
        "st-input": "hsl(var(--st-c-input) / <alpha-value>)",
        "st-ring": "hsl(var(--st-c-ring) / <alpha-value>)",
        "st-sidebar": "hsl(var(--st-c-sidebar) / <alpha-value>)",
        "st-sidebar-foreground": "hsl(var(--st-c-sidebar-foreground) / <alpha-value>)",
        "st-sidebar-accent": "hsl(var(--st-c-sidebar-accent) / <alpha-value>)",
        "st-sidebar-border": "hsl(var(--st-c-sidebar-border) / <alpha-value>)",
      },
      borderRadius: {
        md: "8px",
        lg: "10px",
        st: "var(--st-radius)",
        "st-sm": "calc(var(--st-radius) - 1px)",
      },
      fontFamily: {
        "st-sans": "var(--st-font-sans)",
        "st-display": "var(--st-font-display)",
        "st-mono": "var(--st-font-mono)",
        "st-reading": "var(--st-font-reading)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      typography: ({ theme }) => ({
        DEFAULT: {
          css: {
            color: "rgb(var(--app-text))",
            h1: {
              color: "rgb(var(--app-text))",
            },
            h2: {
              color: "rgb(var(--app-text))",
            },
            h3: {
              color: "rgb(var(--app-text))",
            },
            h4: {
              color: "rgb(var(--app-text))",
            },
            h5: {
              color: "rgb(var(--app-text))",
            },
            h6: {
              color: "rgb(var(--app-text))",
            },
            strong: {
              color: "rgb(var(--app-text))",
            },
            code: {
              color: "rgb(var(--app-text))",
            },
            blockquote: {
              color: "rgb(var(--app-muted))",
            },
          },
        },
      }),
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
