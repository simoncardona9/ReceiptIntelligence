import { getHealthStatus } from "@/server/health/health-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const status = await getHealthStatus();

  return Response.json({ status }, { status: status === "ready" ? 200 : 503 });
}
