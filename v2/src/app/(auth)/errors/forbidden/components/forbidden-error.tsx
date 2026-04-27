import { ShieldAlert } from "lucide-react"

import { AuthErrorScreen } from "../../components/auth-error-screen"

export function ForbiddenError() {
  return (
    <AuthErrorScreen
      code="403"
      title="권한이 없습니다"
      message="현재 계정으로 열 수 없는 운영 화면입니다."
      icon={ShieldAlert}
      actions={[
        { href: "/admin/dashboard", label: "대시보드" },
        { href: "/sign-in", label: "다른 계정", variant: "outline" },
      ]}
    />
  )
}
