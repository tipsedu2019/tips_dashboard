import { NextResponse } from "next/server";

import { createPublicClassesApiResponder } from "../../../server/public-classes-api.js";

export const dynamic = "force-dynamic";

const respond = createPublicClassesApiResponder();

export async function GET() {
  const response = await respond();

  return new NextResponse(response.body, {
    status: response.status,
    headers: response.headers,
  });
}
