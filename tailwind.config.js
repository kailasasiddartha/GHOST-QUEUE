import forms from "@tailwindcss/forms";
import containerQueries from "@tailwindcss/container-queries";

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "tertiary-fixed-dim": "#4edea3",
        "primary-fixed-dim": "#d2bbff",
        "on-error-container": "#ffdad6",
        "secondary-fixed": "#acedff",
        "inverse-on-surface": "#303036",
        "on-secondary": "#003640",
        "tertiary-fixed": "#6ffbbe",
        "on-primary-fixed-variant": "#5a00c6",
        "outline-variant": "#4a4455",
        "surface-container-high": "#2a292f",
        "on-error": "#690005",
        "error-container": "#93000a",
        "surface-dim": "#131318",
        "surface-bright": "#39383e",
        "error": "#ffb4ab",
        "on-tertiary": "#003824",
        "primary-container": "#7c3aed",
        "on-secondary-container": "#00424e",
        "on-secondary-fixed-variant": "#004e5c",
        "outline": "#958da1",
        "on-tertiary-fixed-variant": "#005236",
        "on-primary-container": "#ede0ff",
        "on-tertiary-fixed": "#002113",
        "surface-container": "#1f1f25",
        "tertiary": "#4edea3",
        "surface-tint": "#d2bbff",
        "surface-container-highest": "#35343a",
        "secondary": "#4cd7f6",
        "inverse-surface": "#e4e1e9",
        "primary": "#d2bbff",
        "surface-container-lowest": "#0e0e13",
        "primary-fixed": "#eaddff",
        "secondary-container": "#03b5d3",
        "on-surface": "#e4e1e9",
        "on-primary-fixed": "#25005a",
        "surface": "#131318",
        "tertiary-container": "#007650",
        "on-tertiary-container": "#76ffc2",
        "inverse-primary": "#732ee4",
        "on-primary": "#3f008e",
        "on-secondary-fixed": "#001f26",
        "surface-container-low": "#1b1b20",
        "surface-variant": "#35343a",
        "background": "#131318",
        "on-surface-variant": "#ccc3d8",
        "secondary-fixed-dim": "#4cd7f6",
        "on-background": "#e4e1e9"
      },
      fontFamily: {
        "headline": ["Space Grotesk", "sans-serif"],
        "body": ["Inter", "sans-serif"],
        "label": ["Space Grotesk", "sans-serif"]
      },
      height: {
        "svh": "100svh",
      },
      minHeight: {
        "svh": "100svh",
      },
      keyframes: {
        "pulse-slow": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.8", transform: "scale(1.05)" },
        },
      },
      animation: {
        "pulse-slow": "pulse-slow 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
      borderRadius: {"DEFAULT": "0.25rem", "lg": "0.5rem", "xl": "0.75rem", "full": "9999px"},
    },
  },
  plugins: [
    forms,
    containerQueries,
  ],
}
