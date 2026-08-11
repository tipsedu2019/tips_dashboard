import { notFound } from "next/navigation"

import { RegistrationObservationTeacherFeedback } from "@/features/tasks/registration-observation-teacher-feedback"

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isRegistrationObservationFeedbackId(value: string) {
  return UUID_SEGMENT.test(value)
}

export default async function RegistrationObservationFeedbackPage({
  params,
}: {
  params: Promise<{ observationId: string }>
}) {
  const { observationId } = await params
  if (!isRegistrationObservationFeedbackId(observationId)) notFound()

  return <RegistrationObservationTeacherFeedback observationId={observationId} />
}
