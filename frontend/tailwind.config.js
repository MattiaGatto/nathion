/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        nathion: {
          bg: "#0b0d12",
          panel: "#13161d",
          accent: "#5eead4",
        },
      },
    },
  },
  plugins: [],
};
