# OMA3 x402-Powered RPC Proxy — Implementation Specification (v0)

## Status

Version: v0 (implementation spec)
Scope: Single-request paid RPC proxy
Payment Protocol: x402 v2
Facilitator: Configurable via `X402_FACILITATOR_URL` env var (default: Coinbase CDP)
Framework: Next.js 14+ App Router (Vercel deployment)
Chains: One endpoint per chain (OMAChain testnet for v0 launch; Base and Ethereum stubs)
Base URL: `https://x402.rpc.testnet.omachain.org`

---

# 1. Objective

Provide a paid RPC proxy that:

* Uses **x402 v2** for HTTP-native payments
* Charges a **flat per-call fee (Option A)**
* Charges for all calls **except calls that inherently cost gas**
* Supports one URL endpoint per chain
* Delegates verification and settlement to a facilitator
* Minimizes custom payment logic by leveraging Coinbase’s x402 repository

This design prioritizes simplicity for v0 and avoids introducing protocol-level friction.

OMA is **not required** for payment in v0. Payment uses the standard x402 payment model.

---

# 2. Architectural Principles

1. Do not force OMA usage.
2. Use x402 exactly as defined in the upstream v2 spec.
3. Avoid modifying x402 core behavior.
4. Defer advanced billing logic to future versions.
5. Use public upstream RPC for testing in v0.
6. Keep attack surface minimal.

---

# 3. Deployment Architecture

## 3.1 Hosting

* Platform: **Vercel**
* Framework: **Next.js**
* API routes implemented using App Router:

```
/api/omachain/route.ts
/api/ethereum/route.ts
/api/base/route.ts
```

Each route proxies to its corresponding upstream RPC endpoint.

---

## 3.2 One Endpoint Per Chain

Each chain has a dedicated endpoint:

| Chain    | Endpoint        | Network ID        | Chain ID | Status (v0)        |
| -------- | --------------- | ----------------- | -------- | ------------------ |
| OMAChain | `/api/omachain` | `omachaintestnet` | 66238    | Active             |
| Base     | `/api/base`     | `base`            | 8453     | Stub (returns 501) |
| Ethereum | `/api/ethereum` | `ethereum`        | 1        | Stub (returns 501) |

v0 launches with OMAChain testnet only. Base and Ethereum routes exist but return `501 Not Implemented` until upstream RPC and facilitator support are confirmed.

Future chains follow same pattern.

---

# 4. Payment Model

## 4.1 Pricing Model (v0)

Flat rate per call. Global across all chains.

* Same price regardless of RPC method or chain.
* No batching support.
* No dynamic pricing.
* No compute-unit scaling.

### Concrete Payment Parameters

| Parameter          | Value                                        |
| ------------------ | -------------------------------------------- |
| Scheme             | `exact`                                      |
| Token              | USDC                                         |
| Decimals           | 6                                            |
| Price per call     | `1000` (= 0.001 USDC, i.e. 1/10th of a cent) |
| Network (v0)       | `eip155:8453`                                |
| Asset (Base USDC)  | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

Price is configured via environment variable and expressed in base units (smallest denomination):

```
X402_PRICE_PER_CALL=1000
```

### Example PaymentRequired Response (x402 v2)

```json
{
  "x402Version": 2,
  "resource": {
    "url": "https://x402.rpc.testnet.omachain.org/api/omachain",
    "description": "OMA3 RPC proxy call",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:8453",
      "amount": "1000",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "payTo": "<X402_PAYTO_ADDRESS>",
      "maxTimeoutSeconds": 60
    }
  ],
  "extensions": {
    "offer-receipt": {
      "info": {
        "offers": [
          {
            "format": "eip712",
            "acceptIndex": 0,
            "payload": {
              "version": 1,
              "resourceUrl": "https://x402.rpc.testnet.omachain.org/api/omachain",
              "scheme": "exact",
              "network": "eip155:8453",
              "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              "payTo": "<X402_PAYTO_ADDRESS>",
              "amount": "1000",
              "validUntil": 0
            },
            "signature": "0x..."
          }
        ]
      },
      "schema": { "..." : "..." }
    }
  },
  "error": "Payment required"
}
```

Note: The `resource.url` and offer `resourceUrl` fields use the full URL (not just the path). The payment `network` is `eip155:8453` (Base) even though the RPC endpoint serves OMAChain — payment happens on Base, service happens on OMAChain. The `extensions["offer-receipt"]` block contains signed offers per the offer-receipt extension spec (§6.1).

---

## 4.2 Calls That Are Free (Gas-Paying Method Allowlist)

Calls that submit transactions requiring gas from the caller are free. These methods already impose an economic cost on the client.

### Authoritative Allowlist (free methods)

| Method                     | Chains     |
| -------------------------- | ---------- |
| `eth_sendRawTransaction`   | All EVM    |
| `eth_sendTransaction`      | All EVM    |

### Policy for Unknown Methods

Any RPC method NOT on the free allowlist MUST require x402 payment. There is no denylist — the allowlist is the sole source of truth.

If a chain-specific transaction submission method is discovered later, it is added to the allowlist via config update, not code change:

```
FREE_METHODS=eth_sendRawTransaction,eth_sendTransaction
```

This environment variable is parsed at startup. Default value is the two methods above.

---

## 4.3 Batch Request Rejection

JSON-RPC batch requests (where the body is a JSON array) MUST be rejected.

Response:

```
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "error": {
    "code": -32600,
    "message": "Batch requests are not supported in v0"
  },
  "id": null
}
```

This check MUST happen before payment verification to avoid charging for unsupported requests.

---

# 5. x402 Integration

## 5.1 Version and Source Repository

Must support **x402 v2 specification**.

Source code for the x402 protocol and the offer-receipt extension lives in the `omapay/x402` repository (OMA3's fork of coinbase/x402 tracking PR #935):

* Repository: `omapay/x402` (local workspace path; upstream: https://github.com/coinbase/x402/pull/935)
* Extension spec: `omapay/x402/specs/extensions/extension-offer-and-receipt.md`
* Extension package source: `omapay/x402/typescript/packages/extensions/src/offer-receipt/`
* Server example: `omapay/x402/examples/typescript/servers/offer-receipt/`
* Client example: `omapay/x402/examples/typescript/clients/offer-receipt/`

The `omapay/x402` repository is the authoritative source for protocol behavior, types, and implementation. The examples in `omapay/x402/examples/` are illustrative — if an example conflicts with what the packages in `omapay/x402/typescript/packages/` implement, the package code takes precedence. In particular, the x402 resource server packages define how the `accepts` array is constructed and how extensions hook into the payment flow.

No legacy v1 support.

---

## 5.2 Required Libraries

Use official Coinbase packages:

* `@x402/core` — types, schemas, utilities; `x402HTTPResourceServer` and its primitives (`processHTTPRequest`, `processSettlement`) are exported from `@x402/core/server`
* `@x402/next` — Next.js integration; provides framework adapters only (see §5.4.2 — default wrapper flows MUST NOT be used)
* `@x402/evm` — EVM chain support
* `@x402/extensions` — offer/receipt signing and verification (from PR #935)
  * `@x402/extensions/offer-receipt` — `OfferReceiptIssuer`, `issueOffer`, `issueReceipt`
  * Supports JWS and EIP-712 signature formats
  * Client-side: `createOfferReceiptExtractor()`, `extractOfferPayload`, `extractReceiptPayload`
  * Verification: `verifyOfferSignatureJWS`, `verifyReceiptSignatureJWS`, `verifyOfferSignatureEIP712`, `verifyReceiptSignatureEIP712`

Avoid custom protocol reimplementation.

---

## 5.3 Payment Flow

### Request Processing Order (normative)

```
1. Parse body → reject if not valid JSON-RPC 2.0 single object
2. Reject batch requests (JSON array body) → 400
3. Check method against FREE_METHODS allowlist → if free, skip to step 8
4. Check for PAYMENT-SIGNATURE header → if missing, return 402 with signed offers
5. POST to facilitator /verify → if invalid, return 402
6. POST to facilitator /settle → if fails, return 502
7. Issue signed receipt from settlement result
8. Forward RPC to upstream → return result with PAYMENT-RESPONSE header + signed receipt
```

Settlement (step 6) MUST happen before upstream execution (step 8). This is verify-then-settle-then-execute ordering. The client is charged once settlement succeeds, regardless of upstream outcome.

### 402 Response: Signed Offers (step 4)

When returning 402, the server MUST include signed offers in the `extensions["offer-receipt"]` block of the PaymentRequired response. Each offer corresponds to an `accepts[]` entry and is signed using the server's EIP-712 signing key via `createEIP712OfferReceiptIssuer` + `createOfferReceiptExtension` from `@x402/extensions/offer-receipt`.

The offer `resourceUrl` MUST be the full URL (e.g., `https://x402.rpc.testnet.omachain.org/api/omachain`).

### 200 Response: Signed Receipt (step 7-8)

When returning a successful response, the `PAYMENT-RESPONSE` header's settlement response MUST include a signed receipt in `extensions["offer-receipt"].info.receipt`. The receipt is issued by the same EIP-712 signing key and confirms that payment was received and service was attempted — it does not guarantee that the upstream RPC call succeeded.

### Step 1 — Client Request (no payment)

Client sends RPC call to:

```
POST /api/{chain}
Content-Type: application/json

{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}
```

If payment required and no `PAYMENT-SIGNATURE` header present:

Server responds:

```
HTTP/1.1 402 Payment Required
PAYMENT-REQUIRED: <base64 encoded PaymentRequired object>
```

The `payTo` address is configured via environment variable:

```
X402_PAYTO_ADDRESS
```

---

### Step 2 — Client Payment

Client:

* Decodes the `PAYMENT-REQUIRED` header
* Selects a PaymentRequirement from the `accepts` array
* Creates a PaymentPayload (EIP-3009 `transferWithAuthorization` signature)
* Retries the same request with header:

```
PAYMENT-SIGNATURE: <base64 encoded PaymentPayload>
```

---

### Step 3 — Verification

Server POSTs to facilitator (URL from `X402_FACILITATOR_URL` env var):

```
POST ${X402_FACILITATOR_URL}/verify
```

The facilitator MAY require authentication. If so, include the API key via:

```
Authorization: Bearer ${X402_FACILITATOR_API_KEY}
```

* If valid → proceed to settlement
* If invalid → return 402 with updated `PAYMENT-REQUIRED`

Facilitator timeout: 10 seconds. If facilitator does not respond within 10s, return `502 Bad Gateway` with JSON-RPC error code `-32603`.

---

### Step 4 — Settlement and Receipt Issuance

Server POSTs to facilitator:

```
POST ${X402_FACILITATOR_URL}/settle
```

* If settlement succeeds → issue signed receipt (per the offer-receipt extension protocol), then proceed to RPC execution
* If settlement fails → return `502 Bad Gateway`

The signed receipt is issued at settlement time (step 7 in the processing order). This is defined by the x402 offer-receipt extension protocol: the receipt confirms that payment was received and service was attempted. It does not guarantee upstream success. The receipt is returned alongside the service response.

Settlement is NOT idempotent. The server MUST NOT retry settlement on failure. A failed settlement means the client is not charged and the request is not executed.

---

### Step 5 — RPC Execution

Only after successful settlement:

* Forward JSON-RPC body to upstream endpoint
* Pass through the upstream response as-is (HTTP status code and JSON-RPC body)
* Include `PAYMENT-RESPONSE` header with base64-encoded settlement response (containing signed receipt)


---

## 5.4 Settlement Ordering and x402 Integration Constraints (Normative)

### 5.4.1 Settlement Ordering (Security-Critical)

The server MUST use `verify → settle → execute` ordering for all paid methods.

The server MUST NOT execute the upstream RPC call before successful settlement. This ordering ensures the client is charged before any upstream compute is consumed, eliminating the "execute first, charge later" DDoS vector.

### 5.4.2 x402 Integration Constraint

The server MUST NOT use wrapper paths that enforce `verify → execute → settle` ordering (for example, the default `@x402/next` handler wrappers: `withX402()`, `withX402FromHTTPServer()`, `paymentProxy()`, `paymentProxyFromHTTPServer()`, `paymentProxyFromConfig()`). The default `@x402/next` wrappers call the route handler (execute) before settlement — this is the opposite of the required ordering for this proxy.

The server MUST use a custom route flow built on x402 core primitives:

* `x402HTTPResourceServer.processHTTPRequest()` — for payment verification
* `x402HTTPResourceServer.processSettlement()` — for settlement

These primitives allow the server to control the ordering explicitly: verify, then settle, then (only on settlement success) execute the upstream RPC call.

### 5.4.3 Acceptance Test

If settlement fails or times out, the upstream RPC call MUST NOT be made. Zero upstream requests MUST be observed when `/settle` fails.

Test assertion: given a facilitator `/settle` endpoint that returns an error or does not respond within the timeout, the test MUST verify that no HTTP request was made to the upstream RPC URL.

### 5.4.4 Receipt Handling

The receipt returned in the `PAYMENT-RESPONSE` header is protocol passthrough — the server passes it from the settlement response to the client as-is. The receipt confirms payment was received and service was attempted; it does not guarantee upstream success. Receipt signature verification is the client's responsibility.

---

## 5.5 Settlement and Receipts

Settlement handled by facilitator per x402 v2.

Server:

* POSTs to facilitator `/settle`
* Returns `PAYMENT-RESPONSE` header containing the settlement response with signed receipt

### Offer/Receipt Extension (from omapay/x402)

The server uses `createOfferReceiptExtension` + `createEIP712OfferReceiptIssuer` from `@x402/extensions/offer-receipt` to automatically:

1. On 402 response: include signed **Offers** in `extensions["offer-receipt"].info.offers[]` (one per `accepts[]` entry)
2. On successful settlement: include a signed **Receipt** in `extensions["offer-receipt"].info.receipt` within the `PAYMENT-RESPONSE` header

The receipt is issued at settlement time, as defined by the x402 offer-receipt extension protocol. It confirms that payment was received and service was attempted. It is returned in the `PAYMENT-RESPONSE` header regardless of whether the upstream RPC call succeeds or fails.

The extension hooks into the x402 resource server via `registerExtension()` and route-level `declareOfferReceiptExtension()` — see `omapay/x402/examples/typescript/servers/offer-receipt/index.ts` for the reference pattern.

### Signing Format

v0 uses **EIP-712** signatures (Ethereum-native, simpler key management with a standard Ethereum private key).

The signing key is a standard Ethereum secp256k1 private key stored in an environment variable. The `kid` for EIP-712 uses the `did:pkh` format: `did:pkh:eip155:1:<signing-address>#key-1`.

Note: The signing key address and the `payTo` address (which receives USDC payments) are separate keys with separate purposes. The `payTo` address holds funds; the signing key only signs offers and receipts. They SHOULD be different addresses to limit exposure.

### Key Lifecycle (v0)

1. Generate an Ethereum keypair (e.g., `cast wallet new` or any standard tool)
2. Store the private key in `OFFER_RECEIPT_SIGNING_KEY` env var on Vercel
3. Derive the Ethereum address from the key
4. Publish a DNS TXT record binding the address to the server domain (see below)
5. Register the address via OMATrust key-binding attestation onchain

In v0, the private key lives in a Vercel environment variable. Future versions SHOULD migrate to HSM/KMS.

### Key-to-Domain Binding via DNS TXT (OMATrust Identity Spec)

The server's signing key is bound to the domain via an OMATrust DNS TXT record, per the OMATrust Identity Specification (§5.1.3.1.1, `dns:<domain>` method).

The Owner MUST publish a TXT record at `_omatrust.<domain>`:

```
_omatrust.x402.rpc.testnet.omachain.org.  TXT  "v=1;controller=did:pkh:eip155:1:<signing-address>"
```

Where `<signing-address>` is the Ethereum address derived from `OFFER_RECEIPT_SIGNING_KEY`.

The `did:pkh` format is `did:pkh:eip155:1:<address>` (chainId 1 as the canonical identifier, matching the EIP-712 domain). Multiple `controller` values can be published for key rotation.

Verifiers resolve this TXT record to confirm the EIP-712 signer address is authorized for the domain. The OMATrust key-binding attestation provides a second, onchain layer of binding between the Ethereum address and the OMA3 organizational identity.

Note: The `did:web` for this server is `did:web:x402.rpc.testnet.omachain.org` (subdomains + base domain only, path is stripped per did:web spec). The DNS TXT record is the primary binding mechanism; `/.well-known/did.json` is NOT served.

### Client-Side Offer/Receipt Flow

The RPC proxy server does not host client code. Client implementation will live in a separate repository.

Clients MUST follow the pattern demonstrated in `omapay/x402/examples/typescript/clients/offer-receipt/index.ts` (noting that the example is illustrative — the `@x402/extensions/offer-receipt` package exports are authoritative):

1. Receive 402 → extract signed offers via `extractOffersFromPaymentRequired()`
2. Decode offers via `decodeSignedOffers()` to inspect payment terms
3. Verify offer signatures via `verifyOfferSignatureEIP712()` — reject unverified offers
4. Match verified offer to `accepts[]` via `findAcceptsObjectFromSignedOffer()` (field matching, not index)
5. Create payment and retry with `PAYMENT-SIGNATURE` header
6. On 200 → extract signed receipt via `extractReceiptFromResponse()`
7. Verify receipt signature via `verifyReceiptSignatureEIP712()`
8. Verify receipt matches the accepted offer via `verifyReceiptMatchesOffer()` (checks `resourceUrl`, `network`, `payer`)
9. Use the verified receipt for downstream attestation (e.g., OMATrust user review via OMATrust SDK)

### OMATrust Integration

A verified receipt proves the client paid for the RPC service and that service was attempted. The client can submit this receipt as evidence in an OMATrust user review attestation using the OMATrust SDK. This enables "Verified Purchase" badges and reputation scoring for RPC service quality.

### Receipts Enable

* Verified purchase attestations ("Verified Purchase" badges via OMATrust)
* Audit trails and compliance records
* Dispute resolution evidence
* Agent memory (AI agents proving past interactions)

---

# 6. Replay Protection

Replay protection relies on:

* EIP-3009 semantics
* Facilitator validation
* x402 scheme-level nonce handling

No custom replay tracking in v0.

---

# 7. Error Handling

## 7.1 Billing Rule

Client is charged once settlement succeeds (step 6 in flow). If upstream RPC fails after settlement, the call is still billable -- upstream compute was consumed. This prevents the DDoS vector of "execute first, charge later."

## 7.2 Error Contract

| Condition                        | HTTP Status | JSON-RPC Error Code | Message                                    | Client Retry? |
| -------------------------------- | ----------- | ------------------- | ------------------------------------------ | ------------- |
| Missing PAYMENT-SIGNATURE        | 402         | N/A                 | (PAYMENT-REQUIRED header returned)         | Yes, with payment |
| Invalid payment payload          | 402         | N/A                 | (PAYMENT-REQUIRED header returned)         | Yes, with valid payment |
| Facilitator /verify timeout      | 502         | -32603              | "Facilitator verification timeout"         | Yes (backoff) |
| Facilitator /settle timeout      | 502         | -32603              | "Facilitator settlement timeout"           | No (double-charge risk) |
| Facilitator /settle failure      | 502         | -32603              | "Settlement failed"                        | No |
| Upstream RPC error               | passthrough | passthrough         | Upstream response passed through as-is     | No (already charged) |
| Upstream RPC timeout             | 504         | -32603              | "Upstream RPC timeout"                     | No (already charged) |
| Batch request                    | 400         | -32600              | "Batch requests are not supported in v0"   | No |
| Invalid JSON-RPC body            | 400         | -32700              | "Parse error"                              | No |
| Unsupported chain (stub route)   | 501         | -32601              | "Chain not yet supported"                  | No |
| Request body too large           | 413         | -32600              | "Request body exceeds maximum size"        | No |

Note on upstream errors: After successful settlement, the upstream RPC response (HTTP status and body) is passed through to the client as-is. The proxy does not normalize upstream errors. The `PAYMENT-RESPONSE` header (with signed receipt) is still included, confirming that payment was received and service was attempted regardless of upstream outcome.

## 7.3 Retry Semantics

* Clients SHOULD retry on 402 with a valid payment.
* Clients MAY retry on 502 from /verify with exponential backoff (max 2 retries).
* Clients MUST NOT retry on 502 from /settle (not idempotent).
* Clients MUST NOT retry on any post-settlement error (already charged).

## 7.4 Facilitator Timeouts

| Endpoint   | Timeout  |
| ---------- | -------- |
| `/verify`  | 10s      |
| `/settle`  | 30s      |

---

# 8. Security and Operational Controls

## 8.1 DDoS Prevention

Server MUST:

* Require verified payment before executing upstream RPC
* Reject unpaid requests early (before any upstream I/O)
* Reject oversized bodies before parsing

## 8.2 Request Limits

| Control              | Value     | Configurable? |
| -------------------- | --------- | ------------- |
| Max request body     | 64 KB     | `MAX_BODY_BYTES` env var |
| Upstream RPC timeout | 15s       | `UPSTREAM_TIMEOUT_MS` env var |
| Facilitator /verify  | 10s       | Hardcoded |
| Facilitator /settle  | 30s       | Hardcoded |

Vercel's default function timeout is 10s on Hobby, 60s on Pro. The deployment MUST use Vercel Pro (or equivalent) to accommodate the full verify-settle-upstream chain.

## 8.3 Free Method Abuse

Free methods (`eth_sendRawTransaction`, `eth_sendTransaction`) are not rate-limited in v0 because they already require gas. The gas cost is the abuse deterrent. If abuse is observed, Vercel's built-in rate limiting or a future v1 rate limiter can be applied.

## 8.4 Logging and Redaction

* Log: request method, chain, payment status (paid/free/rejected), upstream status code, latency.
* MUST NOT log: `PAYMENT-SIGNATURE` header contents, private keys, full request bodies.
* Use structured JSON logging (e.g., `pino` or Vercel's built-in logger).

## 8.5 Headers Compatibility

x402 headers (`PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`) do not conflict with JSON-RPC 2.0. x402 operates at the HTTP header layer only; the RPC payload body is unchanged.

---

# 9. Upstream RPC

## 9.1 Per-Chain Configuration

Each active chain has its own upstream RPC URL. For v0, only OMAChain testnet is active.

| Chain    | Env Variable              | Default (v0)                                 |
| -------- | ------------------------- | -------------------------------------------- |
| OMAChain | `UPSTREAM_RPC_URL_OMA`    | `https://rpc.testnet.chain.oma3.org`         |
| Base     | `UPSTREAM_RPC_URL_BASE`   | (not configured -- stub returns 501)         |
| Ethereum | `UPSTREAM_RPC_URL_ETH`    | (not configured -- stub returns 501)         |

Each route reads its own env variable. There is no single `UPSTREAM_RPC_URL`.

## 9.2 Future

Private RPC authentication model to be defined in later spec version. Not in scope for v0.

---

# 10. Configuration

## 10.1 Required Environment Variables

| Variable                    | Description                                      | Example                                          |
| --------------------------- | ------------------------------------------------ | ------------------------------------------------ |
| `X402_PRICE_PER_CALL`       | Price in token base units (USDC 6 decimals)      | `1000`                                           |
| `X402_PAYTO_ADDRESS`        | Ethereum address receiving payments (on Base)    | `0xPLACEHOLDER`                                  |
| `X402_FACILITATOR_URL`      | Facilitator base URL (MUST NOT be hardcoded — may switch to self-hosted facilitator in future) | `https://api.cdp.coinbase.com/platform/v2/x402` |
| `UPSTREAM_RPC_URL_OMA`      | OMAChain testnet upstream RPC                    | `https://rpc.testnet.chain.oma3.org`             |
| `FREE_METHODS`              | Comma-separated free RPC methods                 | `eth_sendRawTransaction,eth_sendTransaction`     |
| `OFFER_RECEIPT_SIGNING_KEY` | Ethereum private key (secp256k1) for EIP-712 offer/receipt signing | `0xPLACEHOLDER`                    |

## 10.2 Optional Environment Variables

| Variable                    | Description                                      | Default    |
| --------------------------- | ------------------------------------------------ | ---------- |
| `X402_FACILITATOR_API_KEY`  | API key / Bearer token for facilitator auth (if required by facilitator) | (none) |
| `UPSTREAM_RPC_URL_BASE`     | Base mainnet upstream RPC                        | (disabled) |
| `UPSTREAM_RPC_URL_ETH`      | Ethereum mainnet upstream RPC                    | (disabled) |
| `MAX_BODY_BYTES`            | Max request body size in bytes                   | `65536`    |
| `UPSTREAM_TIMEOUT_MS`       | Upstream RPC timeout in milliseconds             | `15000`    |

Note: `X402_FACILITATOR_URL` MUST be read from the environment at runtime. It MUST NOT be hardcoded anywhere in the codebase. OMA3 may host its own facilitator in the future, and switching should require only an env var change.

---

# 11. Out of Scope (v0)

* Batching
* Compute-based pricing
* Rate-tier differentiation
* Subscription models
* OMA-native gas payments
* Revenue distribution logic
* Private RPC auth enforcement
* Multi-call bundling
* Advanced receipt analytics
* HSM/KMS key management (v1)

---

# 12. Future Extensions (v1+)

* Compute-weighted pricing
* Batch billing
* Multi-chain unified endpoint
* OMA token payments
* Builder tier discounts
* Onchain revenue accounting
* Private RPC auth integration
* Circuit breakers and rate limiting
* HSM/KMS migration for signing keys
* Self-hosted x402 facilitator
* Base and Ethereum chain activation

---

# 13. Repository Requirements

## 13.1 Dependencies

Implementation must:

1. Depend on `omapay/x402` (OMA3's fork of coinbase/x402 with the offer-receipt extension)
2. Use `@x402/core`, `@x402/next`, `@x402/evm`, `@x402/extensions` from this repo
3. Avoid forking core payment logic unless required

If fork required: keep fork minimal, upstream improvements when possible.

## 13.2 Dependency Consumption Method

The `omapay/x402` packages (`@x402/core`, `@x402/next`, `@x402/evm`, `@x402/extensions`) use `workspace:~` internal references in their `package.json` files. This means they cannot be consumed via bare `github:` git URL dependencies — pnpm cannot resolve `workspace:~` from a git remote. The concrete install method is local path references with a pre-built checkout.

### Bootstrap Steps

1. Clone `omapay/x402` at the pinned commit as a sibling directory (or git submodule):

```bash
git clone https://github.com/omapay/x402.git ../x402
git -C ../x402 checkout 70ea3d0e1858ba12260ba400485e9cbcb2c2e03c
```

2. Build the TypeScript packages:

```bash
pnpm install --dir ../x402/typescript
pnpm build --dir ../x402/typescript
```

3. Reference the built packages via local file paths in the proxy's `package.json`:

```json
{
  "@x402/core": "file:../x402/typescript/packages/core",
  "@x402/next": "file:../x402/typescript/packages/http/next",
  "@x402/evm": "file:../x402/typescript/packages/mechanisms/evm",
  "@x402/extensions": "file:../x402/typescript/packages/extensions"
}
```

The `file:` protocol resolves `workspace:~` references correctly because pnpm treats the local directory as a real package with its own `node_modules`.

### Monorepo Layout Reference

The packages live at these paths within `omapay/x402/typescript/`:

| Package            | Path                              |
| ------------------ | --------------------------------- |
| `@x402/core`       | `packages/core`                   |
| `@x402/extensions` | `packages/extensions`             |
| `@x402/next`       | `packages/http/next`              |
| `@x402/evm`        | `packages/mechanisms/evm`         |

### Pinning and CI

* Pin to commit SHA `70ea3d0e1858ba12260ba400485e9cbcb2c2e03c`. The checkout step in CI MUST use this exact SHA.
* Run `pnpm install --frozen-lockfile` in CI. The lockfile is the source of truth.
* When upgrading x402 packages, update the pinned SHA in a dedicated PR with test verification. Rebuild the x402 checkout before running `pnpm install`.

---

# 14. Acceptance Criteria

## 14.1 Unit Tests

* Request parsing: valid JSON-RPC, invalid JSON-RPC, batch rejection, oversized body
* Free method detection: allowlist match, unknown method requires payment
* Payment flow: missing header returns 402, valid header proceeds
* Error mapping: each row in the error contract table (section 7.2) has a corresponding test
* Offer/receipt: issueOffer produces valid signed offer, issueReceipt produces valid signed receipt

## 14.2 Integration Tests

* End-to-end against OMAChain testnet:
  * Unpaid request returns 402 with correct PaymentRequired payload including signed offers
  * Signed offers in 402 response pass EIP-712 signature verification
  * Paid request with valid PAYMENT-SIGNATURE returns 200 with RPC result, PAYMENT-RESPONSE header, and signed receipt
  * Signed receipt passes EIP-712 signature verification
  * Receipt matches the accepted offer (`verifyReceiptMatchesOffer`)
  * Free method (`eth_sendRawTransaction`) passes without payment
  * Stub chain routes (Base, Ethereum) return 501
* Facilitator integration: verify and settle calls succeed against CDP facilitator
* DNS TXT record: `_omatrust.x402.rpc.testnet.omachain.org` resolves with `v=1;controller=did:pkh:eip155:1:<signing-address>`

## 14.3 Conformance Vectors

* PaymentRequired response matches schema in section 4.1
* All error responses match the contract in section 7.2
* Batch rejection returns exactly the JSON-RPC error in section 4.3

## 14.4 Deployment Checklist

* [ ] Vercel project created with Next.js preset
* [ ] All required env vars (section 10.1) configured in Vercel
* [ ] Vercel Pro plan active (for 60s function timeout)
* [ ] DNS TXT record `_omatrust.x402.rpc.testnet.omachain.org` published with `v=1;controller=did:pkh:eip155:1:<signing-address>`
* [ ] OMATrust key-binding attestation registered for signing key address
* [ ] OMAChain endpoint (`/api/omachain`) returns 402 with signed offers for unpaid requests
* [ ] Base and Ethereum endpoints return 501
* [ ] Structured logging confirmed in Vercel logs
* [ ] Domain `x402.rpc.testnet.omachain.org` pointed to Vercel deployment

---

# 15. Summary

v0 delivers a flat-rate, per-call paid RPC proxy for OMAChain testnet at `x402.rpc.testnet.omachain.org`. Payment happens on Base (USDC via x402 v2). The server signs offers and receipts using EIP-712, bound to the domain via OMATrust DNS TXT record and onchain attestation. Clients verify offers before paying and use receipts for OMATrust user reviews. All x402 offer-receipt extension code lives in `omapay/x402`; the examples there are illustrative but the package implementations are authoritative. The proxy server does not host client code — a separate client repository will be created. Next.js on Vercel. Ship fast, ship safe.
