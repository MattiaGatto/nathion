/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "media",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Space Grotesk", "Inter", "ui-sans-serif", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      colors: {
        nathion: {
          bg: "#07080c",
          surface: "#0e1117",
          panel: "#141822",
          "panel-hover": "#1a2030",
          border: "#232938",
          accent: "#5eead4",
          "accent-dim": "#2dd4bf",
          violet: "#8b7cf6",
          text: "#e8eaf0",
          muted: "#8891a7",
        },
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(94,234,212,0.15), 0 0 24px -4px rgba(94,234,212,0.35)",
        "glow-violet": "0 0 0 1px rgba(139,124,246,0.15), 0 0 24px -4px rgba(139,124,246,0.35)",
        panel: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 30px -12px rgba(0,0,0,0.6)",
      },
      backgroundImage: {
        "grid-fade":
          "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(94,234,212,0.08), transparent)",
        "noise-sheen":
          "linear-gradient(135deg, rgba(94,234,212,0.06) 0%, rgba(139,124,246,0.04) 50%, transparent 100%)",
      },
      keyframes: {
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-dot": {
          "0%, 100%": { opacity: "0.3" },
          "50%": { opacity: "1" },
        },
        "slide-in": {
          "0%": { opacity: "0", transform: "translateX(-8px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 0.35s ease-out",
        "pulse-dot": "pulse-dot 1.4s ease-in-out infinite",
        "slide-in": "slide-in 0.25s ease-out",
      },
    },
  },
  plugins: [],
};
