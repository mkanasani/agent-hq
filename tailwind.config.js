const path = require("path");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    path.join(__dirname, "index.html"),
    path.join(__dirname, "src/**/*.{ts,tsx}"),
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0A0A0F",
        primary: "#00BFFF",
        accent: "#FF6B35",
        success: "#00E676",
        purple: "#A855F7",
        amber: "#F59E0B",
        danger: "#FF4D6D",
      },
      fontFamily: {
        display: ['"Orbitron"', "sans-serif"],
        body: ['"Rajdhani"', "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
      boxShadow: {
        glow: "0 0 24px rgba(0,191,255,0.35)",
        "glow-accent": "0 0 24px rgba(255,107,53,0.35)",
        "glow-success": "0 0 24px rgba(0,230,118,0.35)",
        "inset-glass": "inset 0 1px 0 0 rgba(255,255,255,0.06)",
      },
    },
  },
  plugins: [],
};
