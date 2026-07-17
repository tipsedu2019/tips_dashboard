import { createHash } from "node:crypto"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const GIT_COMMIT_SHA = /^[a-f0-9]{40}$/

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

export async function GET() {
  const deploymentId = text(process.env.VERCEL_DEPLOYMENT_ID)
  const projectId = text(process.env.VERCEL_PROJECT_ID)
  const buildRevision = text(process.env.VERCEL_GIT_COMMIT_SHA)
  const environment = text(process.env.VERCEL_TARGET_ENV || process.env.VERCEL_ENV)
  if (
    !deploymentId
    || !projectId
    || !GIT_COMMIT_SHA.test(buildRevision)
    || environment !== "production"
  ) {
    return Response.json({ ok: false, error: "production_contract_manifest_unavailable" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    })
  }

  return Response.json({
    ok: true,
    contractVersion: 2,
    environment: "production",
    deploymentIdHash: sha256(deploymentId),
    projectIdHash: sha256(projectId),
    buildRevisionHash: sha256(buildRevision),
  }, {
    headers: {
      "Cache-Control": "no-store",
      "X-Notification-Contract-Version": "2",
    },
  })
}
