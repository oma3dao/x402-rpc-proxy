import { loadEnv } from "@/config/env";
import { createChainHandler } from "@/lib/proxy/handler";
import { X402CoreGateway } from "@/lib/proxy/x402-gateway";

let cachedHandler: ((request: Request) => Promise<Response>) | null = null;

export function getOmaChainHandler(): (request: Request) => Promise<Response> {
  if (cachedHandler) {
    return cachedHandler;
  }

  const env = loadEnv();
  const paymentGateway = new X402CoreGateway(env);

  cachedHandler = createChainHandler({
    chainPath: "/api/omachain",
    upstreamRpcUrl: env.upstreamRpcUrlOma,
    freeMethods: env.freeMethods,
    maxBodyBytes: env.maxBodyBytes,
    upstreamTimeoutMs: env.upstreamTimeoutMs,
    paymentGateway
  });

  return cachedHandler;
}
