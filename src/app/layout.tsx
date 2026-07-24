import type { Metadata } from "next";

import { getLocale } from "@/lib/i18n";

import "./globals.css";

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
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
