import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function retiredResponse() {
  return NextResponse.json({
    ok: false,
    error: "registration_customer_reminder_automatic_delivery_retired",
  }, { status: 410 })
}

export function GET() {
  return retiredResponse()
}

export function PATCH() {
  return retiredResponse()
}
