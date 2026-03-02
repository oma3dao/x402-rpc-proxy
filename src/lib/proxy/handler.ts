import { isJsonRpcRequest, parseJsonRpcBody } from "@/lib/proxy/jsonrpc";
import {
  HEADER_PAYMENT_RESPONSE,
  jsonResponse,
  jsonRpcError,
  mergeHeaders
} from "@/lib/proxy/responses";
import type {
  ChainRuntimeConfig,
  JsonRpcRequest,
  PaymentVerificationResult
} from "@/lib/proxy/types";

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function readBodyWithLimit(request: Request, maxBodyBytes: number): Promise<string | null> {
  const rawBody = await request.text();
  const size = Buffer.byteLength(rawBody, "utf8");
  if (size > maxBodyBytes) {
    return null;
  }
  return rawBody;
}

async function forwardUpstream(
  upstreamRpcUrl: string,
  rawBody: string,
  timeoutMs: number,
  paymentResponseHeaders?: Record<string, string>
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const upstreamResponse = await fetch(upstreamRpcUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: rawBody,
      signal: controller.signal
    });

    const responseBody = await upstreamResponse.text();
    const headers = mergeHeaders(upstreamResponse.headers, paymentResponseHeaders || {});

    return new Response(responseBody, {
      status: upstreamResponse.status,
      headers
    });
  } catch (error) {
    if (isAbortError(error)) {
      return jsonResponse(
        504,
        jsonRpcError(-32603, "Upstream RPC timeout"),
        paymentResponseHeaders ? mergeHeaders(undefined, paymentResponseHeaders) : undefined
      );
    }

    return jsonResponse(
      502,
      jsonRpcError(-32603, "Upstream RPC error"),
      paymentResponseHeaders ? mergeHeaders(undefined, paymentResponseHeaders) : undefined
    );
  } finally {
    clearTimeout(timeout);
  }
}

function paymentErrorToResponse(result: PaymentVerificationResult): Response {
  if (result.kind !== "payment-error") {
    throw new Error("paymentErrorToResponse requires payment-error result");
  }

  if (result.isHtml && typeof result.body === "string") {
    return new Response(result.body, {
      status: result.status,
      headers: result.headers
    });
  }

  return jsonResponse(result.status, result.body, result.headers);
}

export function createChainHandler(config: ChainRuntimeConfig) {
  return async function chainHandler(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const rawBody = await readBodyWithLimit(request, config.maxBodyBytes);
    if (rawBody === null) {
      return jsonResponse(
        413,
        jsonRpcError(-32600, "Request body exceeds maximum size")
      );
    }

    const parsed = parseJsonRpcBody(rawBody);
    if (!parsed.ok) {
      return jsonResponse(400, jsonRpcError(-32700, "Parse error"));
    }

    if (Array.isArray(parsed.value)) {
      return jsonResponse(
        400,
        jsonRpcError(-32600, "Batch requests are not supported in v0")
      );
    }

    if (!isJsonRpcRequest(parsed.value)) {
      return jsonResponse(400, jsonRpcError(-32700, "Parse error"));
    }

    const rpcRequest = parsed.value as JsonRpcRequest;

    if (config.freeMethods.has(rpcRequest.method)) {
      return forwardUpstream(config.upstreamRpcUrl, rawBody, config.upstreamTimeoutMs);
    }

    const verification = await config.paymentGateway.verify(request, config.chainPath);
    if (verification.kind === "payment-error") {
      return paymentErrorToResponse(verification);
    }

    const settlement = await config.paymentGateway.settle(verification, request, config.chainPath);
    if (!settlement.ok) {
      return jsonResponse(settlement.status, jsonRpcError(-32603, settlement.message));
    }

    const proxied = await forwardUpstream(
      config.upstreamRpcUrl,
      rawBody,
      config.upstreamTimeoutMs,
      settlement.headers
    );

    if (!proxied.headers.has(HEADER_PAYMENT_RESPONSE)) {
      for (const [key, value] of Object.entries(settlement.headers)) {
        proxied.headers.set(key, value);
      }
    }

    return proxied;
  };
}

export function unsupportedChainResponse(): Response {
  return jsonResponse(501, jsonRpcError(-32601, "Chain not yet supported"));
}
