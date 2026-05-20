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
import { getAuthErrorMessage } from "@/lib/auth-error-messages"
import { getAuthRedirectUrl } from "@/lib/auth-redirect-url"
import { supabase, supabaseConfigError } from "@/lib/supabase"
import { cn } from "@/lib/utils"

const BLOCKED_EMAIL_DOMAIN = "tipsedu.co.kr"

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

function isBlockedEmail(value: string) {
  return normalizeEmail(value).endsWith(`@${BLOCKED_EMAIL_DOMAIN}`)
}

const signupFormSchema = z
  .object({
    name: z.string().trim().min(1, "이름을 입력해 주세요."),
    email: z
      .string()
      .trim()
      .email("수신 가능한 이메일 주소를 입력해 주세요.")
      .refine((value) => !isBlockedEmail(value), {
        message: "tipsedu.co.kr 주소는 메일을 받을 수 없어 가입에 사용할 수 없습니다.",
      }),
    password: z.string().min(8, "비밀번호는 8자 이상 입력해 주세요."),
    confirmPassword: z.string().min(8, "비밀번호를 한 번 더 입력해 주세요."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "비밀번호가 서로 다릅니다.",
    path: ["confirmPassword"],
  })

type SignupFormValues = z.infer<typeof signupFormSchema>

export function SignupForm1({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const router = useRouter()
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const form = useForm<SignupFormValues>({
    resolver: zodResolver(signupFormSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  })

  const onSubmit = form.handleSubmit(async (values) => {
    setMessage(null)
    setError(null)

    if (!supabase) {
      setError(supabaseConfigError || "가입을 시작할 수 없습니다.")
      return
    }

    const email = normalizeEmail(values.email)
    const name = values.name.trim()

    try {
      setIsSubmitting(true)
      const { data, error: signupError } = await supabase.auth.signUp({
        email,
        password: values.password,
        options: {
          emailRedirectTo: getAuthRedirectUrl("/sign-in"),
          data: {
            name,
            full_name: name,
          },
        },
      })

      if (signupError) {
        throw signupError
      }

      if (data.session) {
        router.replace("/admin/dashboard")
        return
      }

      setMessage("가입 확인 메일을 보냈습니다. 메일 확인 후 로그인하세요.")
      form.reset({
        name: "",
        email: "",
        password: "",
        confirmPassword: "",
      })
    } catch (signupError) {
      setError(getAuthErrorMessage(signupError, "가입에 실패했습니다."))
    } finally {
      setIsSubmitting(false)
    }
  })

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">계정 만들기</CardTitle>
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
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>이름</FormLabel>
                        <FormControl>
                          <Input autoComplete="name" placeholder="이름" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Google 이메일</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            autoComplete="email"
                            placeholder="name@gmail.com"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>비밀번호</FormLabel>
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
                        <FormLabel>비밀번호 확인</FormLabel>
                        <FormControl>
                          <Input type="password" autoComplete="new-password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full cursor-pointer" disabled={isSubmitting}>
                    {isSubmitting ? "가입 중..." : "가입하기"}
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
