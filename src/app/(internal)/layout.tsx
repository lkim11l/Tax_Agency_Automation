import Link from "next/link";

import { requireOperationalContextOrRedirect } from "@/lib/auth/context";
import { setLocaleAction } from "@/lib/i18n-actions";
import { getLocale, messages } from "@/lib/i18n";

import { signOut } from "./actions";

export default async function InternalLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [{ profile }, locale] = await Promise.all([
    requireOperationalContextOrRedirect(),
    getLocale(),
  ]);
  const text = messages(locale);
  const navigation = [
    { href: "/applications", label: text.nav.applications },
    { href: "/counterparties", label: text.nav.counterparties },
    { href: "/templates", label: text.nav.templates },
    { href: "/email", label: text.nav.email },
    { href: "/registry", label: text.nav.registry },
    { href: "/reports", label: text.nav.reports },
    { href: "/settings", label: text.nav.settings },
  ];

  return (
    <div className="shell">
      <aside className="sidebar">
        <h1>Tax Agency Automation</h1>
        <nav aria-label="Internal navigation">
          {navigation.map((item) => (
            <Link href={item.href} key={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <form action={signOut}>
          <p className="sidebar-user">{profile.full_name ?? profile.email}</p>
          <button type="submit">{text.nav.signOut}</button>
        </form>
        <form action={setLocaleAction} className="locale-switcher">
          <input type="hidden" name="return_to" value="/applications" />
          <button name="locale" value="ru" type="submit" disabled={locale === "ru"}>RU</button>
          <button name="locale" value="en" type="submit" disabled={locale === "en"}>EN</button>
        </form>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
