import type { JsonRpcErrorBody, JsonRpcId } from "@/lib/proxy/types";

export const HEADER_PAYMENT_REQUIRED = "PAYMENT-REQUIRED";
export const HEADER_PAYMENT_SIGNATURE = "PAYMENT-SIGNATURE";
export const HEADER_PAYMENT_RESPONSE = "PAYMENT-RESPONSE";

export function jsonRpcError(code: number, message: string, id: JsonRpcId = null): JsonRpcErrorBody {
  return {
    jsonrpc: "2.0",
    error: { code, message },
    id
  };
}

export function jsonResponse(status: number, body: unknown, headers?: HeadersInit): Response {
  const finalHeaders = new Headers(headers);
  if (!finalHeaders.has("content-type")) {
    finalHeaders.set("content-type", "application/json");
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: finalHeaders
  });
}

export function mergeHeaders(base: HeadersInit | undefined, extra: Record<string, string>): Headers {
  const merged = new Headers(base);
  for (const [key, value] of Object.entries(extra)) {
    merged.set(key, value);
  }
  return merged;
}
