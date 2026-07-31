import { NextResponse } from "next/server";

export async function GET() {
  const apiUrl = process.env.INTERNAL_API_URL ?? "http://127.0.0.1:4000";

  try {
    const response = await fetch(`${apiUrl}/api/v1/health/ready`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) throw new Error("API is not ready");

    return NextResponse.json({
      status: "ok",
      service: "web",
      timestamp: new Date().toISOString(),
      checks: { api: "up" },
    });
  } catch {
    return NextResponse.json(
      {
        status: "degraded",
        service: "web",
        timestamp: new Date().toISOString(),
        checks: { api: "down" },
      },
      { status: 503 },
    );
  }
}
