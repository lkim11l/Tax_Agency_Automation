import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { signOut } from "./actions";

const navigation = [
  { href: "/applications", label: "Applications" },
  { href: "/templates", label: "Templates" },
  { href: "/reports", label: "Reports" },
  { href: "/settings", label: "Settings" },
];

export default async function InternalLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();
  if (!supabase) {
    redirect("/login?reason=configuration");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

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
          <button type="submit">Sign out</button>
        </form>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
