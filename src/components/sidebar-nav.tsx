"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SidebarNav({
  items,
}: {
  items: { href: string; label: string }[];
}) {
  const pathname = usePathname();
  return (
    <>
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            href={item.href}
            key={item.href}
            className={active ? "active" : undefined}
            aria-current={active ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
