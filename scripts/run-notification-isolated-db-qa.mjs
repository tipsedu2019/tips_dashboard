const ACTIVE_PREVIEW_STATUSES = new Set(["ACTIVE_HEALTHY"])
const PROJECT_REF_PATTERN = /^[a-z]{20}$/
const QA_BRANCH_NAME_PATTERN = /^qa-notification-content-\d{14}$/

function hasSafeBranchFieldTypes(branch) {
  return branch
    && typeof branch === "object"
    && typeof branch.id === "string"
    && branch.id.length > 0
    && typeof branch.name === "string"
    && branch.name.length > 0
    && typeof branch.projectRef === "string"
    && PROJECT_REF_PATTERN.test(branch.projectRef)
    && typeof branch.parentProjectRef === "string"
    && PROJECT_REF_PATTERN.test(branch.parentProjectRef)
    && typeof branch.isDefault === "boolean"
    && typeof branch.persistent === "boolean"
    && typeof branch.withData === "boolean"
    && typeof branch.status === "string"
    && branch.status.length > 0
}

function toSafePreviewBranch(branch) {
  return Object.freeze({
    id: branch.id,
    name: branch.name,
    projectRef: branch.projectRef,
    parentProjectRef: branch.parentProjectRef,
    isDefault: branch.isDefault,
    persistent: branch.persistent,
    withData: branch.withData,
    status: branch.status,
  })
}

export function normalizePreviewBranchList(payload) {
  const rawBranches = Array.isArray(payload)
    ? payload
    : payload?.branches

  if (!Array.isArray(rawBranches)) {
    throw new Error("notification_preview_branch_list_invalid")
  }

  const branches = rawBranches.map((rawBranch) => {
    const branch = {
      id: rawBranch?.id,
      name: rawBranch?.name,
      projectRef: rawBranch?.project_ref,
      parentProjectRef: rawBranch?.parent_project_ref,
      isDefault: rawBranch?.is_default,
      persistent: rawBranch?.persistent,
      withData: rawBranch?.with_data,
      status: rawBranch?.status,
    }

    if (!hasSafeBranchFieldTypes(branch)) {
      throw new Error("notification_preview_branch_list_invalid")
    }

    return toSafePreviewBranch(branch)
  })

  return Object.freeze(branches)
}

export function assertDisposablePreviewBranch(branch, parentProjectRef) {
  const valid = PROJECT_REF_PATTERN.test(parentProjectRef)
    && hasSafeBranchFieldTypes(branch)
    && QA_BRANCH_NAME_PATTERN.test(branch.name)
    && branch.parentProjectRef === parentProjectRef
    && branch.projectRef !== parentProjectRef
    && branch.isDefault === false
    && branch.persistent === false
    && branch.withData === false
    && ACTIVE_PREVIEW_STATUSES.has(branch.status)

  if (!valid) {
    throw new Error("notification_preview_branch_refused")
  }

  return toSafePreviewBranch(branch)
}

export function redactCommandEvidence(value) {
  return String(value)
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi, (match) => {
      try {
        const url = new URL(match)
        return `${url.protocol}//[redacted]@${url.host}${url.pathname}`
      } catch {
        return "[redacted]"
      }
    })
    .replace(/\bsbp_[A-Za-z0-9_-]+\b/g, "[redacted]")
    .replace(/https:\/\/chat\.googleapis\.com\/[^\s"'<>]+/gi, (match) => {
      try {
        const url = new URL(match)
        const redactedQuery = url.search ? "?[redacted]" : ""
        return `${url.origin}${url.pathname}${redactedQuery}`
      } catch {
        return "[redacted]"
      }
    })
}

export function buildPreviewBranchName(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error("notification_preview_branch_time_invalid")
  }

  const stamp = [
    now.getUTCFullYear(),
    now.getUTCMonth() + 1,
    now.getUTCDate(),
    now.getUTCHours(),
    now.getUTCMinutes(),
    now.getUTCSeconds(),
  ].map((part, index) => index === 0 ? String(part) : String(part).padStart(2, "0")).join("")

  return `qa-notification-content-${stamp}`
}
