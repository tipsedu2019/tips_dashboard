import { NextResponse } from "next/server";

import { createPublicClassDetailResponder } from "@/server/public-class-detail";

export const revalidate = 600;

const respond = createPublicClassDetailResponder();

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ classId: string }> },
) {
  const { classId } = await params;
  const response = await respond(classId);
  return new NextResponse(response.body, {
    status: response.status,
    headers: response.headers,
  });
}
