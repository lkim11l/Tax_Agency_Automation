import { timingSafeEqual } from "node:crypto";

import { loadOperationsConfig } from "./config";

export function isAuthorizedCronRequest(
  request: Request,
  environment: Record<string, string | undefined> = process.env,
) {
  let expected: string;
  try {
    expected = `Bearer ${loadOperationsConfig(environment).cronSecret}`;
  } catch {
    return false;
  }
  const supplied = request.headers.get("authorization") ?? "";
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes);
}
