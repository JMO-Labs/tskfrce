import localFont from "next/font/local";

// Self-hosted so builds work offline and the box never calls Google.
// Latin variable woff2 files from Google Fonts (SIL OFL 1.1).
export const display = localFont({
  src: "./fonts/space-grotesk.woff2",
  weight: "500 700",
  variable: "--font-display",
  display: "swap",
});
export const body = localFont({
  src: "./fonts/inter.woff2",
  weight: "400 600",
  variable: "--font-body",
  display: "swap",
});
export const mono = localFont({
  src: "./fonts/jetbrains-mono.woff2",
  weight: "500 700",
  variable: "--font-mono",
  display: "swap",
});
export const parent = localFont({
  src: "./fonts/dm-sans.woff2",
  weight: "400 700",
  variable: "--font-parent",
  display: "swap",
});
