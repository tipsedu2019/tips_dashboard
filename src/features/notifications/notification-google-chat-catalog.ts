export const NOTIFICATION_CONNECTION_KEYS = [
  "google_chat.management",
  "google_chat.executive",
  "google_chat.english",
  "google_chat.math",
  "google_chat.science",
] as const

export type NotificationConnectionKey = (typeof NOTIFICATION_CONNECTION_KEYS)[number]

export const GOOGLE_CHAT_CONNECTION_CATALOG = [
  {
    connectionKey: "google_chat.management",
    channel: "admin",
    label: "관리팀 Google Chat",
  },
  {
    connectionKey: "google_chat.executive",
    channel: "executive",
    label: "경영팀 Google Chat",
  },
  {
    connectionKey: "google_chat.english",
    channel: "english",
    label: "영어팀 Google Chat",
  },
  {
    connectionKey: "google_chat.math",
    channel: "math",
    label: "수학팀 Google Chat",
  },
  {
    connectionKey: "google_chat.science",
    channel: "science",
    label: "과학팀 Google Chat",
  },
] as const satisfies ReadonlyArray<Readonly<{
  connectionKey: NotificationConnectionKey
  channel: string
  label: string
}>>

export type GoogleChatConnectionChannel =
  (typeof GOOGLE_CHAT_CONNECTION_CATALOG)[number]["channel"]

export const GOOGLE_CHAT_CONNECTION_LABELS: Record<NotificationConnectionKey, string> =
  Object.fromEntries(
    GOOGLE_CHAT_CONNECTION_CATALOG.map(({ connectionKey, label }) => [connectionKey, label]),
  ) as Record<NotificationConnectionKey, string>

export const GOOGLE_CHAT_CONNECTION_CHANNEL_BY_KEY: Record<
  NotificationConnectionKey,
  GoogleChatConnectionChannel
> = Object.fromEntries(
  GOOGLE_CHAT_CONNECTION_CATALOG.map(({ connectionKey, channel }) => [connectionKey, channel]),
) as Record<NotificationConnectionKey, GoogleChatConnectionChannel>

export const GOOGLE_CHAT_CONNECTION_KEY_BY_CHANNEL: Record<
  GoogleChatConnectionChannel,
  NotificationConnectionKey
> = Object.fromEntries(
  GOOGLE_CHAT_CONNECTION_CATALOG.map(({ connectionKey, channel }) => [channel, connectionKey]),
) as Record<GoogleChatConnectionChannel, NotificationConnectionKey>

const OBSERVATION_DESTINATION_TEAM_BY_CONNECTION = Object.freeze({
  "google_chat.management": "management",
  "google_chat.english": "english",
  "google_chat.math": "math",
  "google_chat.science": "science",
} as const)

export function renderObservationDestinationTeam(connectionKey: string) {
  const destination = OBSERVATION_DESTINATION_TEAM_BY_CONNECTION[
    connectionKey as keyof typeof OBSERVATION_DESTINATION_TEAM_BY_CONNECTION
  ]
  if (!destination) throw new Error("notification_registration_destination_unsupported")
  return destination
}
