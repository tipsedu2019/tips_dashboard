function text(value) {
  return typeof value === "string" ? value.trim() : ""
}

export async function attemptMakeupApprovalReplay({
  client,
  requestId,
  actorProfileId,
  finalNote,
  expectedStatus,
  mutationRequestId,
}) {
  const { data, error } = await client.rpc("transition_makeup_request_v2", {
    p_makeup_request_id: requestId,
    p_command: "approve",
    p_patch: {
      actor_profile_id: actorProfileId,
      final_note: finalNote,
    },
    p_expected_status: expectedStatus,
    p_request_id: mutationRequestId,
  })

  if (!error) return { kind: "completed", data }
  if (
    text(error.code) === "22023"
    && text(error.message) === "makeup_calendar_effects_invalid"
  ) {
    return { kind: "needs_effects" }
  }
  throw error
}
