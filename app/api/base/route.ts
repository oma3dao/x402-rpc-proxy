import { unsupportedChainResponse } from "@/lib/proxy/handler";

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  return unsupportedChainResponse();
}
