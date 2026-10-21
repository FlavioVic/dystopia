import localFont from "next/font/local";

/**
 * Chakra Petch — fonte da marca (wordmark da logo). Auto-hospedada via
 * next/font/local (subset latin baixado do Google Fonts), sem requisição
 * externa em runtime. Exposta como var CSS --font-chakra.
 */
export const chakraPetch = localFont({
  src: [
    { path: "./fonts/ChakraPetch-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/ChakraPetch-Bold.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-chakra",
});
