import type { Metadata } from "next";
import { Manrope } from "next/font/google";

import { SiteFooter, SiteHeader } from "@/components/PageFurniture";
import "./globals.css";

/**
 * Self-hosted at build time by next/font — no runtime request to Google, which
 * matters both for LCP and because a third-party font request is a needless
 * dependency on a page whose whole job is to load fast and be crawlable.
 *
 * Only the weights actually used are requested. Montserrat is deliberately
 * absent: a second family is a real LCP tax and it has no defined role here.
 */
const manrope = Manrope({
  subsets: ["latin"],
  weight: ["300", "500", "800"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://smilefamreviews.com"),
  title: {
    default:
      "SmileFam Reviews — every customer review, with its source and date",
    template: "%s | SmileFam Reviews",
  },
  description:
    "Customer reviews of SmileFam collected from Google, Facebook and the SmileFam store — including the critical ones.",
  robots: { index: true, follow: true },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "SmileFam Reviews",
    locale: "en_SG",
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-SG" className={manrope.variable}>
      <body>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
