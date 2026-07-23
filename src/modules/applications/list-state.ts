export type ApplicationListState<T> =
  | { kind: "ready"; items: T[] }
  | { kind: "empty"; items: [] }
  | { kind: "error"; message: string };

export function toApplicationListState<T>(
  data: T[] | null,
  error: { message: string } | null,
): ApplicationListState<T> {
  if (error) {
    return { kind: "error", message: error.message };
  }

  if (!data || data.length === 0) {
    return { kind: "empty", items: [] };
  }

  return { kind: "ready", items: data };
}
