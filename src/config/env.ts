export interface ProxyEnv {
  pricePerCall: string;
  payToAddress: `0x${string}`;
  facilitatorUrl: string;
  facilitatorApiKey?: string;
  upstreamRpcUrlOma: string;
  upstreamRpcUrlBase?: string;
  upstreamRpcUrlEth?: string;
  freeMethods: Set<string>;
  signingKey?: `0x${string}`;
  maxBodyBytes: number;
  upstreamTimeoutMs: number;
  facilitatorVerifyTimeoutMs: number;
  facilitatorSettleTimeoutMs: number;
  paymentNetwork: `eip155:${string}`;
  paymentAsset: `0x${string}`;
  paymentMaxTimeoutSeconds: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parsePositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer for ${name}: ${raw}`);
  }

  return parsed;
}

function ensureHexAddress(name: string, value: string): `0x${string}` {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`Invalid Ethereum address for ${name}: ${value}`);
  }
  return value as `0x${string}`;
}

function ensurePrivateKey(name: string, value: string): `0x${string}` {
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    throw new Error(`Invalid private key format for ${name}`);
  }
  return normalized as `0x${string}`;
}

function parseMethods(raw: string | undefined): Set<string> {
  const fallback = ["eth_sendRawTransaction", "eth_sendTransaction"];
  const list = (raw || fallback.join(","))
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);

  return new Set(list);
}

export function loadEnv(): ProxyEnv {
  const pricePerCall = requireEnv("X402_PRICE_PER_CALL");
  if (!/^\d+$/.test(pricePerCall)) {
    throw new Error("X402_PRICE_PER_CALL must be a base-unit integer string");
  }

  const payToAddress = ensureHexAddress("X402_PAYTO_ADDRESS", requireEnv("X402_PAYTO_ADDRESS"));
  const facilitatorUrl = requireEnv("X402_FACILITATOR_URL");
  const signingKeyRaw = process.env.OFFER_RECEIPT_SIGNING_KEY;
  const signingKey = signingKeyRaw
    ? ensurePrivateKey("OFFER_RECEIPT_SIGNING_KEY", signingKeyRaw)
    : undefined;

  return {
    pricePerCall,
    payToAddress,
    facilitatorUrl,
    facilitatorApiKey: process.env.X402_FACILITATOR_API_KEY,
    upstreamRpcUrlOma: requireEnv("UPSTREAM_RPC_URL_OMA"),
    upstreamRpcUrlBase: process.env.UPSTREAM_RPC_URL_BASE,
    upstreamRpcUrlEth: process.env.UPSTREAM_RPC_URL_ETH,
    freeMethods: parseMethods(process.env.FREE_METHODS),
    signingKey,
    maxBodyBytes: parsePositiveInt("MAX_BODY_BYTES", 65_536),
    upstreamTimeoutMs: parsePositiveInt("UPSTREAM_TIMEOUT_MS", 15_000),
    facilitatorVerifyTimeoutMs: parsePositiveInt("FACILITATOR_VERIFY_TIMEOUT_MS", 10_000),
    facilitatorSettleTimeoutMs: parsePositiveInt("FACILITATOR_SETTLE_TIMEOUT_MS", 30_000),
    paymentNetwork: (process.env.X402_PAYMENT_NETWORK || "eip155:8453") as `eip155:${string}`,
    paymentAsset: ensureHexAddress(
      "X402_PAYMENT_ASSET",
      process.env.X402_PAYMENT_ASSET || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    ),
    paymentMaxTimeoutSeconds: parsePositiveInt("X402_PAYMENT_MAX_TIMEOUT_SECONDS", 60)
  };
}
