import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Vigie Centrale — Veille personnelle",
  description: "Agrégateur personnel de veille emploi, insertion professionnelle, jeux et technologie.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const environment = process.env.VERCEL_ENV
    ?? (process.env.NODE_ENV === "development" ? "development" : "production");
  const environmentLabel = environment === "preview"
    ? "PREVIEW"
    : environment === "development"
      ? "DEV"
      : null;
  const environmentColor = environment === "preview" ? "#7c3aed" : "#2563eb";

  return (
    <html lang="fr">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        style={environmentLabel ? { borderTop: `4px solid ${environmentColor}` } : undefined}
      >
        {environmentLabel && (
          <div
            aria-label={`Environnement ${environmentLabel}`}
            style={{
              position: "fixed",
              top: 4,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 9999,
              padding: "4px 10px",
              borderRadius: "0 0 7px 7px",
              background: environmentColor,
              color: "#fff",
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: "0.14em",
              lineHeight: 1.4,
              boxShadow: "0 2px 8px rgba(0, 0, 0, 0.18)",
              pointerEvents: "none",
            }}
          >
            {environmentLabel}
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
