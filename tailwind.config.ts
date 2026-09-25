import type { Config } from "tailwindcss";

/**
 * Palette (DockDrop family):
 * - Ocean blue for dark surfaces (sidebar, banners, hero), coral for the main
 *   action on a page, warm cream for the page, pale blue-grey for lines.
 * - Money is coloured by who receives it: violet ("treasury") for government
 *   charges, teal for Kencole's fees. Neither hue is used for anything else,
 *   and coral is never used for money.
 * - Fraunces (serif) for headings and big figures, DM Sans for everything else.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#0D1F2D", 700: "#0A3350", 500: "#5A7A8A", 300: "#9DB3BF" },
        ocean: { DEFAULT: "#0B3D59", 600: "#0F5276", 900: "#082D42" },
        sky: { DEFAULT: "#1585B5", light: "#7DD4F5", 100: "#E3F1F8" },
        coral: { DEFAULT: "#E8501A", 600: "#CF4412", 100: "#FCE7DF" },
        paper: { DEFAULT: "#FDFAF4", card: "#FFFFFF", sunk: "#E4EEF3" },
        line: { DEFAULT: "#E4EEF3", strong: "#DDE6EB", hover: "#B8D4E2" },
        success: { DEFAULT: "#1A8C5E", 100: "#E1F2EA" },
        warn: { DEFAULT: "#D4830A", 100: "#FBF0DD" },
        teal: { DEFAULT: "#0E6E6B", 600: "#0A5654", 100: "#D6E8E7" },
        treasury: { DEFAULT: "#6B3FA0", 100: "#EFE8F7" },
        alert: { DEFAULT: "#9B2C2C", 100: "#F6DEDE" },
      },
      fontFamily: {
        sans: ["var(--font-dm-sans)", "system-ui", "sans-serif"],
        serif: ["var(--font-fraunces)", "Georgia", "serif"],
      },
      fontSize: {
        display: ["clamp(2.4rem, 5.5vw, 4rem)", { lineHeight: "1.08", letterSpacing: "-0.02em" }],
        title: ["clamp(1.5rem, 2.6vw, 2rem)", { lineHeight: "1.15", letterSpacing: "-0.02em" }],
      },
      borderRadius: { card: "14px", field: "10px" },
      boxShadow: { card: "0 2px 20px rgba(11,61,89,.10)", lift: "0 8px 40px rgba(11,61,89,.15)" },
    },
  },
  plugins: [],
};
export default config;
