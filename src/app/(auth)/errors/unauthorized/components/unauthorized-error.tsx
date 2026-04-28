import { LogIn } from "lucide-react"

import { AuthErrorScreen } from "../../components/auth-error-screen"

export function UnauthorizedError() {
  return (
    <AuthErrorScreen
      code="401"
      title="로그인이 필요합니다"
      message="운영 계정으로 로그인하면 대시보드로 바로 이동합니다."
      icon={LogIn}
      actions={[
        { href: "/sign-in", label: "로그인" },
        { href: "/", label: "홈페이지", variant: "outline" },
      ]}
    />
  )
}
