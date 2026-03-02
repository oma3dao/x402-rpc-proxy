# x402-rpc-proxy

OMA3 x402-powered JSON-RPC proxy for OMAChain.

## What This Service Does

- Exposes `POST /api/omachain` as a paid RPC endpoint.
- Uses x402 v2 payment headers:
  - `PAYMENT-REQUIRED`
  - `PAYMENT-SIGNATURE`
  - `PAYMENT-RESPONSE`
- Enforces `verify -> settle -> execute` for paid methods.
- Leaves `eth_sendRawTransaction` and `eth_sendTransaction` free.
- Returns `501` for `POST /api/base` and `POST /api/ethereum` in v0.

## Important Implementation Detail

This service intentionally does **not** use default `@x402/next` wrapper flows (`withX402`, `paymentProxy`, etc.) because they settle after route execution. It uses `x402HTTPResourceServer` primitives from `@x402/core/server` to settle before upstream execution.

## Required Environment Variables

```bash
X402_PRICE_PER_CALL=1000
X402_PAYTO_ADDRESS=0x...
X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402
UPSTREAM_RPC_URL_OMACHAIN=https://rpc.testnet.chain.oma3.org
FREE_METHODS=eth_sendRawTransaction,eth_sendTransaction
```

## Optional Environment Variables

```bash
OFFER_RECEIPT_SIGNING_KEY=0x...
X402_FACILITATOR_API_KEY=
UPSTREAM_RPC_URL_BASE=
UPSTREAM_RPC_URL_ETH=
MAX_BODY_BYTES=65536
UPSTREAM_TIMEOUT_MS=15000
FACILITATOR_VERIFY_TIMEOUT_MS=10000
FACILITATOR_SETTLE_TIMEOUT_MS=30000
X402_PAYMENT_NETWORK=eip155:8453
X402_PAYMENT_ASSET=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
X402_PAYMENT_MAX_TIMEOUT_SECONDS=60
```

## Local Development

```bash
pnpm install
pnpm dev
```

## Tests

Unit tests cover all non-live behavior (request validation, free-method bypass, payment verification paths, settlement-before-execute, upstream timeout handling, and stub routes).

```bash
pnpm test
```

## Live Smoke Tests (Post-Deploy)

These scripts validate deployed behavior. They do not require the separate client repository.

```bash
BASE_URL=https://x402.rpc.testnet.omachain.org pnpm smoke:live
```

Optional paid-path test (if you already have a valid payment payload):

```bash
BASE_URL=https://x402.rpc.testnet.omachain.org PAYMENT_SIGNATURE='<base64>' pnpm smoke:live
```

## Deploy

If Vercel is connected to this repo root and auto-deploy is enabled on your production branch, pushing to `main` triggers deploy automatically.

## x402 Package Pinning

This project currently pins `@x402/*` packages to exact npm versions for deploy portability. If you need to force a specific `omapay/x402` commit/fork instead, replace these with your required source in `package.json` and lockfile before release.

## Offer/Receipt Extension Note

The current published `@x402/extensions` npm package does not export the `offer-receipt` module path. This build therefore implements the core payment flow without the offer-receipt route declaration. If you require signed offers/receipts exactly as in the spec, use the `omapay/x402` fork source as a dependency source in your build pipeline.
