export type NotificationDashboardRole =
  | "admin"
  | "staff"
  | "teacher"
  | "assistant"
  | "viewer"

export type NotificationHttpErrorCode =
  | "notification_unauthorized"
  | "notification_forbidden"
  | "notification_auth_unavailable"

type AuthenticatedUserResult = {
  data?: {
    user?: {
      id?: unknown
    } | null
  } | null
  error?: unknown
}

type DashboardRoleResult = {
  data?: unknown
  error?: unknown
}

export type NotificationAuthenticatedClient = {
  auth: {
    getUser(token: string): PromiseLike<AuthenticatedUserResult>
  }
  rpc(name: "current_dashboard_role"): PromiseLike<DashboardRoleResult>
}

export type NotificationAuthDependencies<Client extends NotificationAuthenticatedClient> = {
  createAuthenticatedClient(token: string): Client
}

export type NotificationAuthContext<
  Client extends NotificationAuthenticatedClient = NotificationAuthenticatedClient,
> = {
  userId: string
  role: string
  client: Client
}

export class NotificationHttpError extends Error {
  readonly status: number
  readonly code: NotificationHttpErrorCode

  constructor(status: number, code: NotificationHttpErrorCode) {
    super(code)
    this.name = "NotificationHttpError"
    this.status = status
    this.code = code
  }
}

function unauthorized() {
  return new NotificationHttpError(401, "notification_unauthorized")
}

function authUnavailable() {
  return new NotificationHttpError(503, "notification_auth_unavailable")
}

function readBearerToken(request: Request) {
  const authorization = request.headers.get("authorization")
  if (!authorization) return null

  const match = /^Bearer ([^\s]+)$/i.exec(authorization)
  return match?.[1] || null
}

export async function authenticateNotificationRequest<
  Client extends NotificationAuthenticatedClient,
>(
  request: Request,
  dependencies: NotificationAuthDependencies<Client>,
): Promise<NotificationAuthContext<Client>> {
  const token = readBearerToken(request)
  if (!token) throw unauthorized()

  let client: Client
  try {
    client = dependencies.createAuthenticatedClient(token)
  } catch {
    throw authUnavailable()
  }

  if (!client?.auth || typeof client.auth.getUser !== "function" || typeof client.rpc !== "function") {
    throw authUnavailable()
  }

  let userResult: AuthenticatedUserResult
  try {
    userResult = await client.auth.getUser(token)
  } catch {
    throw unauthorized()
  }

  const userId = userResult?.data?.user?.id
  if (
    userResult?.error
    || typeof userId !== "string"
    || userId.length === 0
    || userId.trim() !== userId
  ) {
    throw unauthorized()
  }

  let roleResult: DashboardRoleResult
  try {
    roleResult = await client.rpc("current_dashboard_role")
  } catch {
    throw authUnavailable()
  }

  if (roleResult?.error) throw authUnavailable()

  return {
    userId,
    role: typeof roleResult?.data === "string" ? roleResult.data : "",
    client,
  }
}

export function requireNotificationRole<
  Context extends { role: string },
>(context: Context, allowedRoles: readonly string[]): Context {
  if (!allowedRoles.some((allowedRole) => allowedRole === context?.role)) {
    throw new NotificationHttpError(403, "notification_forbidden")
  }

  return context
}
