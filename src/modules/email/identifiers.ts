export function normalizeMessageId(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return normalized.startsWith("<") && normalized.endsWith(">")
    ? normalized
    : `<${normalized.replace(/^<|>$/g, "")}>`;
}

export function parseReferences(
  value: string | string[] | null | undefined,
): string[] {
  const source = Array.isArray(value) ? value.join(" ") : value ?? "";
  const ids = source.match(/<[^<>\s]+>/g) ?? source.split(/\s+/);
  return [
    ...new Set(
      ids
        .map((id) => normalizeMessageId(id))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
}
