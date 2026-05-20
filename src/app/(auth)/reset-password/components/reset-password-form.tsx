"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
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
import { supabase, supabaseConfigError } from "@/lib/supabase"
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
  const router = useRouter()
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    setMessage(null)
    setError(null)

    if (!supabase) {
      setError(supabaseConfigError || "비밀번호를 변경할 수 없습니다.")
      return
    }

    try {
      setIsSubmitting(true)
      const { error: updateError } = await supabase.auth.updateUser({
        password: values.password,
      })

      if (updateError) {
        throw updateError
      }

      setMessage("비밀번호가 변경되었습니다. 새 비밀번호로 로그인하세요.")
      form.reset({
        password: "",
        confirmPassword: "",
      })
      await supabase.auth.signOut()
      window.setTimeout(() => router.replace("/sign-in"), 800)
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "비밀번호 변경에 실패했습니다.")
    } finally {
      setIsSubmitting(false)
    }
  })

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">새 비밀번호 설정</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={onSubmit}>
              <div className="grid gap-6">
                <div className="grid gap-4">
                  {(message || error) && (
                    <Alert variant={error ? "destructive" : "default"}>
                      <AlertDescription>{error || message}</AlertDescription>
                    </Alert>
                  )}
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>새 비밀번호</FormLabel>
                        <FormControl>
                          <Input type="password" autoComplete="new-password" {...field} />
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
                          <Input type="password" autoComplete="new-password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full cursor-pointer" disabled={isSubmitting}>
                    {isSubmitting ? "변경 중..." : "비밀번호 변경"}
                  </Button>
                  <Button asChild variant="ghost" className="w-full cursor-pointer">
                    <Link href="/sign-in">로그인으로 돌아가기</Link>
                  </Button>
                </div>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
