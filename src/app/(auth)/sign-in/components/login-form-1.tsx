"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/providers/auth-provider";
import { getAuthErrorMessage } from "@/lib/auth-error-messages";

const loginFormSchema = z.object({
  loginId: z.string().trim().min(1, "Google 이메일을 입력해 주세요."),
  password: z.string().min(6, "비밀번호는 6자 이상 입력해 주세요."),
});

type LoginFormValues = z.infer<typeof loginFormSchema>;

export function LoginForm1({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, authError, user, loading } = useAuth();
  const redirectTarget = searchParams.get("next") || "/admin/dashboard";
  const didRegister = searchParams.get("registered") === "1";
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: {
      loginId: "",
      password: "",
    },
  });

  useEffect(() => {
    if (!loading && user) {
      router.replace(redirectTarget);
    }
  }, [loading, redirectTarget, router, user]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      setSubmitError(null);
      setIsSubmitting(true);
      await login(values.loginId, values.password);
      router.replace(redirectTarget);
    } catch (error) {
      setSubmitError(getAuthErrorMessage(error, "로그인에 실패했습니다."));
    } finally {
      setIsSubmitting(false);
    }
  });

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">TIPS 로그인</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={onSubmit}>
              <div className="grid gap-6">
                <div className="grid gap-4">
                  {didRegister && !submitError && !authError ? (
                    <Alert>
                      <AlertDescription>
                        가입이 완료되었습니다. 이메일 확인 후 로그인하세요.
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  {(submitError || authError) && (
                    <Alert variant="destructive">
                      <AlertDescription>
                        {submitError || authError}
                      </AlertDescription>
                    </Alert>
                  )}
                  <FormField
                    control={form.control}
                    name="loginId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Google 이메일</FormLabel>
                        <FormControl>
                          <Input
                            data-testid="sign-in-login-id"
                            type="email"
                            inputMode="email"
                            autoCapitalize="none"
                            autoComplete="email"
                            placeholder="name@gmail.com"
                            {...field}
                            onChange={(event) => {
                              field.onChange(event);
                              setSubmitError(null);
                            }}
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
                        <div className="flex items-center">
                          <FormLabel>비밀번호</FormLabel>
                          <Link
                            href="/forgot-password"
                            className="ml-auto text-sm underline-offset-4 hover:underline"
                          >
                            비밀번호 찾기
                          </Link>
                        </div>
                        <FormControl>
                          <Input
                            data-testid="sign-in-password"
                            type="password"
                            autoComplete="current-password"
                            {...field}
                            onChange={(event) => {
                              field.onChange(event);
                              setSubmitError(null);
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    type="submit"
                    className="w-full cursor-pointer"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? "로그인 중..." : "로그인"}
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    className="w-full cursor-pointer"
                  >
                    <Link href="/sign-up">회원가입</Link>
                  </Button>
                </div>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
