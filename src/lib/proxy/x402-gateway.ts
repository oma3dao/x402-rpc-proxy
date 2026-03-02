import {
  type FacilitatorClient,
  type HTTPAdapter,
  type HTTPRequestContext,
  x402HTTPResourceServer,
  x402ResourceServer
} from "@x402/core/server";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse
} from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";

import { type ProxyEnv } from "@/config/env";
import { jsonRpcError } from "@/lib/proxy/responses";
import type {
  PaymentErrorResult,
  PaymentGateway,
  PaymentVerificationResult,
  PaymentVerifiedResult,
  SettlementResult
} from "@/lib/proxy/types";

const PAYMENT_HEADER_NAME = "PAYMENT-SIGNATURE";

interface VerifiedToken {
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
  declaredExtensions?: Record<string, unknown>;
  context: HTTPRequestContext;
}

class NextRequestAdapter implements HTTPAdapter {
  constructor(private readonly request: Request, private readonly path: string) {}

  getHeader(name: string): string | undefined {
    return this.request.headers.get(name) ?? undefined;
  }

  getMethod(): string {
    return this.request.method;
  }

  getPath(): string {
    return this.path;
  }

  getUrl(): string {
    return this.request.url;
  }

  getAcceptHeader(): string {
    return this.request.headers.get("accept") ?? "";
  }

  getUserAgent(): string {
    return this.request.headers.get("user-agent") ?? "";
  }
}

class TimeoutFacilitatorClient implements FacilitatorClient {
  constructor(
    private readonly baseUrl: string,
    private readonly verifyTimeoutMs: number,
    private readonly settleTimeoutMs: number,
    private readonly apiKey?: string
  ) {}

  async verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements
  ): Promise<VerifyResponse> {
    return this.postWithTimeout<VerifyResponse>(
      "/verify",
      {
        x402Version: paymentPayload.x402Version,
        paymentPayload: this.toJsonSafe(paymentPayload),
        paymentRequirements: this.toJsonSafe(paymentRequirements)
      },
      this.verifyTimeoutMs,
      "Facilitator verification timeout"
    );
  }

  async settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements
  ): Promise<SettleResponse> {
    return this.postWithTimeout<SettleResponse>(
      "/settle",
      {
        x402Version: paymentPayload.x402Version,
        paymentPayload: this.toJsonSafe(paymentPayload),
        paymentRequirements: this.toJsonSafe(paymentRequirements)
      },
      this.settleTimeoutMs,
      "Facilitator settlement timeout"
    );
  }

  async getSupported(): Promise<SupportedResponse> {
    const response = await fetch(`${this.baseUrl}/supported`, {
      method: "GET",
      headers: this.buildHeaders()
    });

    if (!response.ok) {
      throw new Error(`Facilitator getSupported failed (${response.status})`);
    }

    return (await response.json()) as SupportedResponse;
  }

  private async postWithTimeout<T>(
    path: string,
    body: unknown,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal
      });

      const data = (await response.json()) as T;

      if (!response.ok) {
        throw new Error(`Facilitator request failed (${response.status})`);
      }

      return data;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(timeoutMessage);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  private toJsonSafe(obj: unknown): unknown {
    return JSON.parse(
      JSON.stringify(obj, (_, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value
      )
    );
  }
}

function mapPaymentError(error: PaymentErrorResult): PaymentErrorResult {
  const body = error.body as Record<string, unknown> | undefined;
  const message = typeof body?.error === "string" ? body.error : "";
  const isVerifyTimeout = /verification timeout/i.test(message);

  if (isVerifyTimeout) {
    return {
      kind: "payment-error",
      status: 502,
      headers: {
        "content-type": "application/json"
      },
      body: jsonRpcError(-32603, "Facilitator verification timeout")
    };
  }

  return error;
}

export class X402CoreGateway implements PaymentGateway {
  private readonly httpServer: x402HTTPResourceServer;

  constructor(private readonly env: ProxyEnv) {
    const facilitatorClient = new TimeoutFacilitatorClient(
      env.facilitatorUrl,
      env.facilitatorVerifyTimeoutMs,
      env.facilitatorSettleTimeoutMs,
      env.facilitatorApiKey
    );

    const resourceServer = new x402ResourceServer(facilitatorClient)
      .register(env.paymentNetwork, new ExactEvmScheme());

    this.httpServer = new x402HTTPResourceServer(resourceServer, {
      "POST /api/omachain": {
        accepts: {
          scheme: "exact",
          payTo: env.payToAddress,
          price: {
            amount: env.pricePerCall,
            asset: env.paymentAsset,
            extra: {
              symbol: "USDC",
              decimals: 6
            }
          },
          network: env.paymentNetwork,
          maxTimeoutSeconds: env.paymentMaxTimeoutSeconds
        },
        description: "OMA3 RPC proxy call",
        mimeType: "application/json"
      }
    });
  }

  async verify(request: Request, chainPath: string): Promise<PaymentVerificationResult> {
    const adapter = new NextRequestAdapter(request, chainPath);
    const context: HTTPRequestContext = {
      adapter,
      method: request.method,
      path: chainPath,
      paymentHeader: request.headers.get(PAYMENT_HEADER_NAME) ?? undefined
    };

    const result = await this.httpServer.processHTTPRequest(context);

    if (result.type === "payment-error") {
      const mapped: PaymentErrorResult = {
        kind: "payment-error",
        status: result.response.status,
        headers: result.response.headers,
        body: result.response.body,
        isHtml: result.response.isHtml
      };

      if (context.paymentHeader) {
        return mapPaymentError(mapped);
      }

      return mapped;
    }

    if (result.type === "no-payment-required") {
      return {
        kind: "payment-error",
        status: 500,
        headers: {
          "content-type": "application/json"
        },
        body: jsonRpcError(-32603, "Payment processing misconfiguration")
      };
    }

    const token: VerifiedToken = {
      paymentPayload: result.paymentPayload,
      paymentRequirements: result.paymentRequirements,
      declaredExtensions: result.declaredExtensions,
      context
    };

    return {
      kind: "payment-verified",
      token
    };
  }

  async settle(
    verified: PaymentVerifiedResult,
    _request: Request,
    _chainPath: string
  ): Promise<SettlementResult> {
    const token = verified.token as VerifiedToken;

    const result = await this.httpServer.processSettlement(
      token.paymentPayload,
      token.paymentRequirements,
      token.declaredExtensions,
      {
        request: token.context
      }
    );

    if (!result.success) {
      const timeoutMessage = /settlement timeout/i.test(result.errorReason || "")
        ? "Facilitator settlement timeout"
        : "Settlement failed";

      return {
        ok: false,
        status: 502,
        message: timeoutMessage
      };
    }

    return {
      ok: true,
      headers: result.headers
    };
  }
}
