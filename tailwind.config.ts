import type { Config } from "tailwindcss";

/**
 * Palette rationale (see docs/ARCHITECTURE.md § Design):
 * Colour encodes *who receives the money*. Ochre = government charges,
 * teal = Kencole charges. Never use these two hues decoratively.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#0C1B2A", 700: "#16324B", 500: "#3D5A73", 300: "#8FA3B4" },
        paper: { DEFAULT: "#EEF1F0", card: "#FFFFFF", sunk: "#E2E7E6" },
        teal: { DEFAULT: "#0E6E6B", 600: "#0A5654", 100: "#D6E8E7" },
        ochre: { DEFAULT: "#A9791C", 100: "#F2E7CE" },
        alert: { DEFAULT: "#9B2C2C", 100: "#F6DEDE" },
      },
      fontFamily: { sans: ["var(--font-archivo)", "system-ui", "sans-serif"] },
      fontSize: {
        display: ["clamp(2.5rem, 6vw, 4.25rem)", { lineHeight: "0.98", letterSpacing: "-0.03em" }],
        title: ["clamp(1.6rem, 3vw, 2.25rem)", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
      },
      borderRadius: { card: "10px" },
      boxShadow: { card: "0 1px 2px rgba(12,27,42,.06), 0 8px 24px -16px rgba(12,27,42,.35)" },
    },
  },
  plugins: [],
};
export default config;
