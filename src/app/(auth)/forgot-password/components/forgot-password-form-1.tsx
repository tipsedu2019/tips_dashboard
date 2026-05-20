"use client"

import { useState } from "react"
import Link from "next/link"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getAuthErrorMessage } from "@/lib/auth-error-messages"
import { getAuthRedirectUrl } from "@/lib/auth-redirect-url"
import { supabase, supabaseConfigError } from "@/lib/supabase"
import { cn } from "@/lib/utils"

const BLOCKED_EMAIL_DOMAIN = "tipsedu.co.kr"

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

function isEmailLike(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function ForgotPasswordForm1({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [email, setEmail] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage(null)
    setError(null)

    const normalizedEmail = normalizeEmail(email)
    if (!isEmailLike(normalizedEmail)) {
      setError("수신 가능한 이메일 주소를 입력해 주세요.")
      return
    }

    if (normalizedEmail.endsWith(`@${BLOCKED_EMAIL_DOMAIN}`)) {
      setError("tipsedu.co.kr 주소는 메일을 받을 수 없습니다. 가입에 사용한 Google 이메일을 입력해 주세요.")
      return
    }

    if (!supabase) {
      setError(supabaseConfigError || "비밀번호 재설정을 시작할 수 없습니다.")
      return
    }

    try {
      setIsSubmitting(true)
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: getAuthRedirectUrl("/reset-password"),
      })

      if (resetError) {
        throw resetError
      }

      setMessage("재설정 메일을 보냈습니다. 메일에서 링크를 열어 새 비밀번호를 설정하세요.")
    } catch (resetError) {
      setError(getAuthErrorMessage(resetError, "재설정 링크를 보내지 못했습니다."))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">비밀번호 재설정</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <div className="grid gap-6">
              {(message || error) && (
                <Alert variant={error ? "destructive" : "default"}>
                  <AlertDescription>{error || message}</AlertDescription>
                </Alert>
              )}
              <div className="grid gap-3">
                <Label htmlFor="email">Google 이메일</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="name@gmail.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full cursor-pointer" disabled={isSubmitting}>
                {isSubmitting ? "전송 중..." : "재설정 링크 보내기"}
              </Button>
              <Button asChild variant="ghost" className="w-full cursor-pointer">
                <Link href="/sign-in">로그인으로 돌아가기</Link>
              </Button>
              <Button asChild variant="outline" className="w-full cursor-pointer">
                <Link href="/sign-up">회원가입</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
