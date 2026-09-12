import { NextResponse } from "next/server";

import { createPublicClassesSummaryApiResponder } from "../../../../server/public-classes-summary-api.js";

export const revalidate = 600;

const respond = createPublicClassesSummaryApiResponder();

export async function GET() {
  const response = await respond();
  return new NextResponse(response.body, {
    status: response.status,
    headers: response.headers,
  });
}
