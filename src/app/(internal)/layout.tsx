import Link from "next/link";

import { requireOperationalContextOrRedirect } from "@/lib/auth/context";

import { signOut } from "./actions";

const navigation = [
  { href: "/applications", label: "Applications" },
  { href: "/counterparties", label: "Counterparties" },
  { href: "/templates", label: "Templates" },
  { href: "/email", label: "Email" },
  { href: "/reports", label: "Reports" },
  { href: "/settings", label: "Settings" },
];

export default async function InternalLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { profile } = await requireOperationalContextOrRedirect();

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
          <button type="submit">Sign out</button>
        </form>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
