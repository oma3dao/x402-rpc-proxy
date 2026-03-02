import { getOmaChainHandler } from "@/lib/proxy/runtime";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return getOmaChainHandler()(request);
}
