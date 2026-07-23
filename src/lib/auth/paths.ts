const protectedPrefixes = [
  "/applications",
  "/counterparties",
  "/templates",
  "/reports",
  "/settings",
];

export function isProtectedPath(pathname: string): boolean {
  return protectedPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
