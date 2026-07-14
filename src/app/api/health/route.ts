import { NextResponse } from "next/server";
import { getRuntimeHealth } from "@/lib/runtime-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ runtime: getRuntimeHealth() }, { headers: { "Cache-Control": "no-store" } });
}
