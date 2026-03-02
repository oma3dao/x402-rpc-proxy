#!/usr/bin/env node

const baseUrl = process.env.BASE_URL;
if (!baseUrl) {
  console.error("Missing BASE_URL env var. Example: BASE_URL=https://x402.rpc.testnet.omachain.org");
  process.exit(1);
}

const paidMethod = process.env.SMOKE_PAID_METHOD || "eth_blockNumber";
const freeMethod = process.env.SMOKE_FREE_METHOD || "eth_sendRawTransaction";
const paymentSignature = process.env.PAYMENT_SIGNATURE;

const endpoint = `${baseUrl.replace(/\/$/, "")}/api/omachain`;

async function callRpc(method, params = [], headers = {}) {
  const body = JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 });
  return fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers
    },
    body
  });
}

async function main() {
  console.log(`Target endpoint: ${endpoint}`);

  const unpaid = await callRpc(paidMethod);
  console.log(`Unpaid paid-method status: ${unpaid.status}`);
  console.log(`PAYMENT-REQUIRED present: ${Boolean(unpaid.headers.get("PAYMENT-REQUIRED"))}`);

  const free = await callRpc(freeMethod, ["0x00"]);
  console.log(`Free-method status: ${free.status}`);

  const stubBase = await fetch(`${baseUrl.replace(/\/$/, "")}/api/base`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 })
  });
  console.log(`/api/base status: ${stubBase.status}`);

  const stubEth = await fetch(`${baseUrl.replace(/\/$/, "")}/api/ethereum`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 })
  });
  console.log(`/api/ethereum status: ${stubEth.status}`);

  if (paymentSignature) {
    const paid = await callRpc(paidMethod, [], {
      "PAYMENT-SIGNATURE": paymentSignature
    });
    console.log(`Paid-method (with PAYMENT-SIGNATURE) status: ${paid.status}`);
    console.log(`PAYMENT-RESPONSE present: ${Boolean(paid.headers.get("PAYMENT-RESPONSE"))}`);
  } else {
    console.log("Skipping paid smoke test because PAYMENT_SIGNATURE is not set.");
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
