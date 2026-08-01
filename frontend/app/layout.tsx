import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono, Newsreader } from "next/font/google";

import "./globals.css";
import { Providers } from "@/components/providers";
import { CommandMenu } from "@/components/chrome/command-menu";
import { buildMetadata } from "@/lib/seo";

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = buildMetadata({});

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0e14" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${ibmPlexSans.variable} ${ibmPlexMono.variable} ${newsreader.variable}`}
      style={
        {
          ["--font-ibm-plex-sans" as string]: ibmPlexSans.style.fontFamily,
          ["--font-ibm-plex-mono" as string]: ibmPlexMono.style.fontFamily,
          ["--font-newsreader" as string]: newsreader.style.fontFamily,
        } as React.CSSProperties
      }
    >
      <body className="min-h-screen bg-background text-foreground antialiased">
        <Providers>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow-elev-2"
          >
            Skip to content
          </a>
          {children}
          <CommandMenu />
        </Providers>
      </body>
    </html>
  );
}
