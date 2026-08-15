import { NextResponse } from "next/server";

import { createPublicClassesApiResponder } from "../../../server/public-classes-api.js";

export const revalidate = 600;

const respond = createPublicClassesApiResponder();

export async function GET() {
  const response = await respond();

  return new NextResponse(response.body, {
    status: response.status,
    headers: response.headers,
  });
}
