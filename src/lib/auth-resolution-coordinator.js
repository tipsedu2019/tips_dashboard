/**
 * @typedef {{ generation: number, sessionKey: string }} AuthResolutionToken
 */

export function createAuthResolutionCoordinator() {
  let generation = 0
  let sessionKey = ""
  let resolvedSessionKey = ""

  /** @param {AuthResolutionToken} token */
  const isCurrent = (token) => (
    token.generation === generation && token.sessionKey === sessionKey
  )

  return {
    captureSnapshot() {
      return generation
    },
    isSnapshotCurrent(snapshotGeneration) {
      return generation === snapshotGeneration
    },
    begin(nextSessionKey) {
      const normalizedSessionKey = String(nextSessionKey || "anonymous")
      generation += 1
      if (normalizedSessionKey !== sessionKey) resolvedSessionKey = ""
      sessionKey = normalizedSessionKey
      return { generation, sessionKey }
    },
    /** @param {AuthResolutionToken} token */
    isCurrent(token) {
      return isCurrent(token)
    },
    /** @param {AuthResolutionToken} token */
    markResolvedProfile(token) {
      if (!isCurrent(token)) return false
      resolvedSessionKey = token.sessionKey
      return true
    },
    canReuseResolvedProfile(nextSessionKey) {
      return resolvedSessionKey === String(nextSessionKey || "anonymous")
    },
  }
}
