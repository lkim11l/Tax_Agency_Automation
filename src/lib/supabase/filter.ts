export function sanitizePostgrestSearchTerm(value: string): string {
  return value.replace(/[,%().]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}
