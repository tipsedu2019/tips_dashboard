"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { getPasswordRecoveryFlow, scrubRecoveryURL } from "@/lib/password-recovery-browser"
import type { RecoveryState } from "@/lib/password-recovery"
import { cn } from "@/lib/utils"

const resetPasswordSchema = z
  .object({
    password: z.string().min(8, "비밀번호는 8자 이상 입력해 주세요."),
    confirmPassword: z.string().min(8, "비밀번호를 한 번 더 입력해 주세요."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "비밀번호가 서로 다릅니다.",
    path: ["confirmPassword"],
  })

type ResetPasswordValues = z.infer<typeof resetPasswordSchema>

export function ResetPasswordForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const submitLock = useRef(false)
  const flow = useRef<ReturnType<typeof getPasswordRecoveryFlow>>(null)
  const [recoveryState, setRecoveryState] = useState<RecoveryState | "verifying">("verifying")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  })

  useEffect(() => {
    let active = true
    async function initialize() {
      const url = new URL(window.location.href)
      try {
        flow.current = getPasswordRecoveryFlow()
        const next = flow.current
          ? await flow.current.initialize(url, scrubRecoveryURL)
          : "unavailable"
        if (active) setRecoveryState(next)
      } catch {
        if (active) setRecoveryState("unavailable")
      } finally {
        scrubRecoveryURL()
      }
    }
    void initialize()
    return () => { active = false }
  }, [])

  const onSubmit = form.handleSubmit(async (values) => {
    if (submitLock.current || recoveryState !== "ready" || !flow.current) return
    submitLock.current = true
    setError(null)
    setIsSubmitting(true)
    try {
      const next = await flow.current.submit(values.password)
      if (next === "busy") return
      if (next === "retry") {
        setError("비밀번호를 변경하지 못했습니다. 비밀번호 조건과 연결 상태를 확인한 뒤 다시 시도해 주세요.")
        return
      }
      setRecoveryState(next)
      if (next === "complete") form.reset({ password: "", confirmPassword: "" })
    } finally {
      submitLock.current = false
      setIsSubmitting(false)
    }
  })

  const notice = recoveryState === "verifying"
    ? "재설정 링크를 확인하고 있습니다."
    : recoveryState === "complete"
      ? "비밀번호가 변경되었습니다. 새 비밀번호로 로그인하세요."
      : recoveryState === "invalid"
        ? "재설정 링크가 없거나 만료되었거나 이미 사용되었습니다. 새 링크를 요청해 주세요."
        : recoveryState === "unavailable"
          ? "재설정 링크를 확인하지 못했습니다. 연결 상태를 확인하고 새 링크를 요청해 주세요."
          : null

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">새 비밀번호 설정</CardTitle>
        </CardHeader>
        <CardContent>
          {notice && (
            <Alert role="status" variant={recoveryState === "invalid" || recoveryState === "unavailable" ? "destructive" : "default"}>
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          )}
          {(recoveryState === "invalid" || recoveryState === "unavailable") && (
            <Button asChild size="form" className="mt-4 w-full">
              <Link href="/forgot-password">새 재설정 링크 요청</Link>
            </Button>
          )}
          {recoveryState === "ready" && <Form {...form}>
            <form onSubmit={onSubmit}>
              <div className="grid gap-6">
                <div className="grid gap-4">
                  {error && (
                    <Alert variant="destructive">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>새 비밀번호</FormLabel>
                        <FormControl>
                          <Input type="password" autoComplete="new-password" disabled={isSubmitting} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>새 비밀번호 확인</FormLabel>
                        <FormControl>
                          <Input type="password" autoComplete="new-password" disabled={isSubmitting} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" size="form" className="w-full cursor-pointer" disabled={isSubmitting}>
                    {isSubmitting ? "변경 중..." : "비밀번호 변경"}
                  </Button>
                </div>
              </div>
            </form>
          </Form>}
          <Button asChild variant="ghost" size="form" className="mt-4 w-full cursor-pointer">
            <Link href="/sign-in">로그인으로 돌아가기</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
