import type { Metadata, Viewport } from "next";
import { Kumbh_Sans } from "next/font/google";

import "./globals.css";

// Kumbh Sans : la typographie de la charte ESME Executive Education.
const kumbhSans = Kumbh_Sans({
  variable: "--font-kumbh",
  subsets: ["latin"],
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "ESME TENDERA — L'intelligence des appels d'offres",
    template: "%s · ESME TENDERA",
  },
  description:
    "Plateforme de veille, d'analyse, de préparation et de pilotage des réponses aux appels d'offres d'ESME Executive Education.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#174290",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={kumbhSans.variable}>
      <body className="min-h-dvh antialiased">
        <a
          href="#contenu"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-full focus:bg-esme-900 focus:px-4 focus:py-2 focus:text-sm focus:text-white"
        >
          Aller au contenu principal
        </a>
        {children}
      </body>
    </html>
  );
}
