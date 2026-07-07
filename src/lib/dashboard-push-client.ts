"use client"

export type DashboardPushState =
  | "unsupported"
  | "unconfigured"
  | "denied"
  | "prompt"
  | "subscribed"
  | "unsubscribed"

const DASHBOARD_PUSH_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY ||
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
  ""

function hasBrowserPushApis() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  )
}

export function isDashboardPushSupported() {
  return hasBrowserPushApis()
}

export function isDashboardPushConfigured() {
  return Boolean(DASHBOARD_PUSH_PUBLIC_KEY)
}

export function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = `${base64String}${padding}`.replace(/-/g, "+").replace(/_/g, "/")
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index)
  }

  return outputArray
}

export async function registerDashboardServiceWorker() {
  if (!hasBrowserPushApis()) {
    throw new Error("이 브라우저에서는 휴대폰 알림을 사용할 수 없습니다.")
  }
  return navigator.serviceWorker.register("/sw.js")
}

async function getCurrentSubscription() {
  const registration = await registerDashboardServiceWorker()
  return registration.pushManager.getSubscription()
}

async function persistPushSubscription(subscription: PushSubscription, accessToken: string) {
  const response = await fetch("/api/push-subscriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      subscription: subscription.toJSON(),
      userAgent: navigator.userAgent,
    }),
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }
}

export async function getDashboardPushState(): Promise<DashboardPushState> {
  if (!hasBrowserPushApis()) return "unsupported"
  if (!DASHBOARD_PUSH_PUBLIC_KEY) return "unconfigured"
  if (Notification.permission === "denied") return "denied"
  if (Notification.permission === "default") return "prompt"

  const subscription = await getCurrentSubscription()
  return subscription ? "subscribed" : "unsubscribed"
}

export async function subscribeDashboardPush(accessToken: string) {
  if (!DASHBOARD_PUSH_PUBLIC_KEY) {
    throw new Error("푸시 알림 공개키가 설정되지 않았습니다.")
  }

  const registration = await registerDashboardServiceWorker()
  const permission = await Notification.requestPermission()
  if (permission !== "granted") {
    throw new Error("브라우저 알림 권한이 허용되지 않았습니다.")
  }

  const existingSubscription = await registration.pushManager.getSubscription()
  const subscription = existingSubscription || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(DASHBOARD_PUSH_PUBLIC_KEY),
  })

  await persistPushSubscription(subscription, accessToken)
  return subscription
}

export async function unsubscribeDashboardPush(accessToken: string) {
  const subscription = await getCurrentSubscription()
  if (!subscription) return

  const response = await fetch("/api/push-subscriptions", {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  })

  if (!response.ok) {
    throw new Error(await response.text())
  }

  await subscription.unsubscribe()
}
