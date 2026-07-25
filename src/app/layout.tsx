import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { getLocale } from "@/lib/i18n";

import "./globals.css";

const inter = Inter({ subsets: ["latin", "cyrillic"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: {
    default: "Автоматизация договорной работы",
    template: "%s | Автоматизация договорной работы",
  },
  description: "Internal contract workflow operations application.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
