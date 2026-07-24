import type { Metadata } from "next";

import { getLocale } from "@/lib/i18n";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Tax Agency Automation",
    template: "%s | Tax Agency Automation",
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
