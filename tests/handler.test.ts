import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createChainHandler, unsupportedChainResponse } from "@/lib/proxy/handler";
import { HEADER_PAYMENT_REQUIRED, HEADER_PAYMENT_RESPONSE } from "@/lib/proxy/responses";
import type {
  ChainRuntimeConfig,
  PaymentGateway,
  PaymentVerifiedResult,
  SettlementResult
} from "@/lib/proxy/types";

class FakePaymentGateway implements PaymentGateway {
  verifyMock = vi.fn();
  settleMock = vi.fn();

  verify(request: Request, chainPath: string) {
    return this.verifyMock(request, chainPath);
  }

  settle(verified: PaymentVerifiedResult, request: Request, chainPath: string): Promise<SettlementResult> {
    return this.settleMock(verified, request, chainPath);
  }
}

function createConfig(gateway: PaymentGateway): ChainRuntimeConfig {
  return {
    chainPath: "/api/omachain",
    upstreamRpcUrl: "https://upstream.example",
    freeMethods: new Set(["eth_sendRawTransaction", "eth_sendTransaction"]),
    maxBodyBytes: 1024,
    upstreamTimeoutMs: 25,
    paymentGateway: gateway
  };
}

async function jsonOf(response: Response): Promise<any> {
  return response.json();
}

describe("chain handler", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns 400 for batch requests", async () => {
    const gateway = new FakePaymentGateway();
    const handler = createChainHandler(createConfig(gateway));

    const response = await handler(
      new Request("https://service.test/api/omachain", {
        method: "POST",
        body: JSON.stringify([{ jsonrpc: "2.0", method: "eth_blockNumber", id: 1 }])
      })
    );

    expect(response.status).toBe(400);
    expect(await jsonOf(response)).toEqual({
      jsonrpc: "2.0",
      error: {
        code: -32600,
        message: "Batch requests are not supported in v0"
      },
      id: null
    });
    expect(gateway.verifyMock).not.toHaveBeenCalled();
  });

  it("returns 400 parse error for invalid JSON", async () => {
    const gateway = new FakePaymentGateway();
    const handler = createChainHandler(createConfig(gateway));

    const response = await handler(
      new Request("https://service.test/api/omachain", {
        method: "POST",
        body: "{not-valid-json"
      })
    );

    expect(response.status).toBe(400);
    expect(await jsonOf(response)).toEqual({
      jsonrpc: "2.0",
      error: {
        code: -32700,
        message: "Parse error"
      },
      id: null
    });
    expect(gateway.verifyMock).not.toHaveBeenCalled();
  });

  it("returns 413 for oversized body", async () => {
    const gateway = new FakePaymentGateway();
    const handler = createChainHandler({ ...createConfig(gateway), maxBodyBytes: 4 });

    const response = await handler(
      new Request("https://service.test/api/omachain", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", id: 1 })
      })
    );

    expect(response.status).toBe(413);
    expect(await jsonOf(response)).toEqual({
      jsonrpc: "2.0",
      error: {
        code: -32600,
        message: "Request body exceeds maximum size"
      },
      id: null
    });
    expect(gateway.verifyMock).not.toHaveBeenCalled();
  });

  it("bypasses payment for free methods", async () => {
    const gateway = new FakePaymentGateway();
    const handler = createChainHandler(createConfig(gateway));

    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: "2.0", result: "0x1", id: 1 }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      })
    ) as typeof fetch;

    const response = await handler(
      new Request("https://service.test/api/omachain", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_sendRawTransaction",
          params: ["0xabc"],
          id: 1
        })
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get(HEADER_PAYMENT_RESPONSE)).toBeNull();
    expect(gateway.verifyMock).not.toHaveBeenCalled();
  });

  it("returns payment-required response from gateway", async () => {
    const gateway = new FakePaymentGateway();
    gateway.verifyMock.mockResolvedValue({
      kind: "payment-error",
      status: 402,
      headers: {
        [HEADER_PAYMENT_REQUIRED]: "base64-required"
      },
      body: {
        x402Version: 2,
        error: "Payment required"
      }
    });

    const handler = createChainHandler(createConfig(gateway));
    const response = await handler(
      new Request("https://service.test/api/omachain", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", id: 1 })
      })
    );

    expect(response.status).toBe(402);
    expect(response.headers.get(HEADER_PAYMENT_REQUIRED)).toBe("base64-required");
    expect(await jsonOf(response)).toEqual({
      x402Version: 2,
      error: "Payment required"
    });
  });

  it("does not call upstream when settlement fails", async () => {
    const gateway = new FakePaymentGateway();
    gateway.verifyMock.mockResolvedValue({
      kind: "payment-verified",
      token: { verify: true }
    });
    gateway.settleMock.mockResolvedValue({
      ok: false,
      status: 502,
      message: "Settlement failed"
    });

    global.fetch = vi.fn() as typeof fetch;

    const handler = createChainHandler(createConfig(gateway));
    const response = await handler(
      new Request("https://service.test/api/omachain", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", id: 1 })
      })
    );

    expect(response.status).toBe(502);
    expect(await jsonOf(response)).toEqual({
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message: "Settlement failed"
      },
      id: null
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("settles before upstream and injects PAYMENT-RESPONSE header", async () => {
    const gateway = new FakePaymentGateway();
    gateway.verifyMock.mockResolvedValue({
      kind: "payment-verified",
      token: { verify: true }
    });
    gateway.settleMock.mockResolvedValue({
      ok: true,
      headers: {
        [HEADER_PAYMENT_RESPONSE]: "base64-settle"
      }
    });

    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: "2.0", result: "0x123", id: 1 }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      })
    ) as typeof fetch;

    const handler = createChainHandler(createConfig(gateway));
    const response = await handler(
      new Request("https://service.test/api/omachain", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", id: 1 })
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get(HEADER_PAYMENT_RESPONSE)).toBe("base64-settle");
    expect(gateway.verifyMock).toHaveBeenCalledTimes(1);
    expect(gateway.settleMock).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns 504 on upstream timeout and keeps PAYMENT-RESPONSE header", async () => {
    const gateway = new FakePaymentGateway();
    gateway.verifyMock.mockResolvedValue({
      kind: "payment-verified",
      token: { verify: true }
    });
    gateway.settleMock.mockResolvedValue({
      ok: true,
      headers: {
        [HEADER_PAYMENT_RESPONSE]: "base64-settle"
      }
    });

    global.fetch = vi.fn().mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal;
        signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    }) as typeof fetch;

    const handler = createChainHandler({ ...createConfig(gateway), upstreamTimeoutMs: 1 });
    const response = await handler(
      new Request("https://service.test/api/omachain", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", id: 1 })
      })
    );

    expect(response.status).toBe(504);
    expect(response.headers.get(HEADER_PAYMENT_RESPONSE)).toBe("base64-settle");
    expect(await jsonOf(response)).toEqual({
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message: "Upstream RPC timeout"
      },
      id: null
    });
  });

  it("passes through upstream HTTP status and body after settlement", async () => {
    const gateway = new FakePaymentGateway();
    gateway.verifyMock.mockResolvedValue({
      kind: "payment-verified",
      token: { verify: true }
    });
    gateway.settleMock.mockResolvedValue({
      ok: true,
      headers: {
        [HEADER_PAYMENT_RESPONSE]: "base64-settle"
      }
    });

    const upstreamBody = {
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "execution reverted"
      },
      id: 1
    };

    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(upstreamBody), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      })
    ) as typeof fetch;

    const handler = createChainHandler(createConfig(gateway));
    const response = await handler(
      new Request("https://service.test/api/omachain", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_call", params: [], id: 1 })
      })
    );

    expect(response.status).toBe(200);
    expect(await jsonOf(response)).toEqual(upstreamBody);
    expect(response.headers.get(HEADER_PAYMENT_RESPONSE)).toBe("base64-settle");
  });

  it("returns unsupported chain response", async () => {
    const response = unsupportedChainResponse();
    expect(response.status).toBe(501);
    expect(await jsonOf(response)).toEqual({
      jsonrpc: "2.0",
      error: {
        code: -32601,
        message: "Chain not yet supported"
      },
      id: null
    });
  });
});
