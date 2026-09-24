// Copyright 2026 Anthropic PBC
// SPDX-License-Identifier: Apache-2.0

import type { Metadata } from "next";
import { Barlow, Spline_Sans_Mono } from "next/font/google";
import "./globals.css";

// Barlow at both ends of its weight range: 100 for display, 700/800 for labels.
const barlow = Barlow({
  subsets: ["latin"],
  weight: ["100", "300", "400", "500", "600", "700", "800"],
  variable: "--font-body",
  display: "swap",
});

// Numerals, prices, fares, and IDs render in mono with tabular figures.
const splineSansMono = Spline_Sans_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Quasar Airlines",
  description: "Vuelos, servicios adicionales y la tarjeta Quasar Visa con el Asistente Quasar.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${barlow.variable} ${splineSansMono.variable}`}>
      {/* Browser extensions (e.g. ColorZilla) add attributes to <body> before hydration. */}
      <body suppressHydrationWarning>
        <div className="am-grid" aria-hidden />
        <div className="relative z-[2] h-full">
          {children}
        </div>
      </body>
    </html>
  );
}
