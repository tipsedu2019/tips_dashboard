"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowUpRight, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/providers/auth-provider"
import { REGISTRATION_CUSTOMER_GUIDANCE, parseRegistrationCustomerGuidanceSettings, type RegistrationCustomerGuidanceSetting } from "./registration-customer-message-settings-contract"

export function RegistrationCustomerMessageSettingsHub() {
  const { session } = useAuth()
  return <RegistrationCustomerGuidanceSettings key={session?.user.id || "signed-out"} token={session?.access_token || ""} />
}

export function RegistrationCustomerGuidanceSettings({ token }: { token: string }) {
  const [settings, setSettings] = useState<RegistrationCustomerGuidanceSetting[] | null>(null)
  const [error, setError] = useState("")
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const timeout = setTimeout(() => controller.abort(), 15_000)
    setSettings(null)
    setError("")
    void (async () => {
      try {
        if (!token) throw new Error("auth")
        const response = await fetch("/api/solapi/registration/settings", {
          headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
        })
        const payload = await response.json()
        if (!response.ok || payload.ok !== true) throw new Error("unavailable")
        const rows = parseRegistrationCustomerGuidanceSettings(payload.settings)
        if (active) setSettings(rows)
      } catch {
        if (active) setError(token ? "고객 안내 설정을 불러오지 못했습니다." : "로그인을 확인해 주세요.")
      } finally { clearTimeout(timeout) }
    })()
    return () => { active = false; clearTimeout(timeout); controller.abort() }
  }, [token, retry])

  return (
    <section aria-label="등록 고객 알림톡" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">고객 알림톡</h2>
        <Button variant="ghost" size="sm" onClick={() => setRetry((value) => value + 1)}><RefreshCw className="size-4" />새로고침</Button>
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="divide-y rounded-lg border">
        {REGISTRATION_CUSTOMER_GUIDANCE.map(({ messageKind, label, flow }) => {
          const setting = settings?.find((item) => item.messageKind === messageKind)
          return (
            <div key={messageKind} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="grid gap-1">
                <span className="text-sm font-medium">{label}</span>
                <span className="text-xs text-muted-foreground">
                  {setting ? `${setting.mode === "live" ? "운영 발송 허용" : setting.mode === "verification" ? "지정 테스트만 허용" : "발송 꺼짐"} · ${setting.templateVerifiedAt ? "템플릿 검증 기록 있음" : "템플릿 검증 필요"}` : error ? "상태 확인 필요" : "설정 불러오는 중…"}
                </span>
              </div>
              <Button asChild variant="outline" size="sm"><Link href={`/admin/registration?flow=${flow}`}>{label === "입학신청서" ? "등록 신청" : label.replace(" 예약", "").replace(" 안내", "")}에서 안내<ArrowUpRight className="size-3.5" /></Link></Button>
            </div>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">등록 건의 ‘알림톡 미리보기’에서 수신 번호·승인 문구·현재 발송 가능 여부를 확인합니다.</p>
    </section>
  )
}
