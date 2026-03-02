export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
  id?: JsonRpcId;
}

export interface JsonRpcErrorBody {
  jsonrpc: "2.0";
  error: {
    code: number;
    message: string;
  };
  id: JsonRpcId;
}

export interface PaymentErrorResult {
  kind: "payment-error";
  status: number;
  headers: Record<string, string>;
  body: unknown;
  isHtml?: boolean;
}

export interface PaymentVerifiedResult {
  kind: "payment-verified";
  token: unknown;
}

export type PaymentVerificationResult = PaymentErrorResult | PaymentVerifiedResult;

export interface SettlementSuccessResult {
  ok: true;
  headers: Record<string, string>;
}

export interface SettlementFailureResult {
  ok: false;
  status: number;
  message: string;
}

export type SettlementResult = SettlementSuccessResult | SettlementFailureResult;

export interface PaymentGateway {
  verify(request: Request, chainPath: string): Promise<PaymentVerificationResult>;
  settle(verified: PaymentVerifiedResult, request: Request, chainPath: string): Promise<SettlementResult>;
}

export interface ChainRuntimeConfig {
  chainPath: string;
  upstreamRpcUrl: string;
  freeMethods: Set<string>;
  maxBodyBytes: number;
  upstreamTimeoutMs: number;
  paymentGateway: PaymentGateway;
}
