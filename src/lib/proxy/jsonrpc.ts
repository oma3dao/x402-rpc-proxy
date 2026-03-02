import type { JsonRpcRequest } from "@/lib/proxy/types";

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return obj.jsonrpc === "2.0" && typeof obj.method === "string";
}

export function parseJsonRpcBody(rawBody: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(rawBody) as unknown };
  } catch {
    return { ok: false };
  }
}
