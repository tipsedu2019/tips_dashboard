"use client"

import { useState } from "react"
import Link from "next/link"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { supabase, supabaseConfigError } from "@/lib/supabase"
import { cn } from "@/lib/utils"

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

    if (!supabase) {
      setError(supabaseConfigError || "비밀번호 재설정을 시작할 수 없습니다.")
      return
    }

    try {
      setIsSubmitting(true)
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/sign-in`,
      })

      if (resetError) {
        throw resetError
      }

      setMessage("입력한 이메일로 재설정 링크를 보냈습니다.")
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "재설정 링크를 보내지 못했습니다.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">비밀번호 찾기</CardTitle>
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
                <Label htmlFor="email">이메일</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="your-id@tipsedu.co.kr"
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
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
