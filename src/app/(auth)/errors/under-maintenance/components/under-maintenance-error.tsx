import { Clock3 } from "lucide-react"

import { AuthErrorScreen } from "../../components/auth-error-screen"

export function UnderMaintenanceError() {
  return (
    <AuthErrorScreen
      code="503"
      title="점검 중입니다"
      message="운영 화면을 다시 열 수 있도록 잠시 후 새로고침해 주세요."
      icon={Clock3}
      actions={[
        { href: "/admin/dashboard", label: "대시보드" },
        { href: "/inquiry", label: "문의", variant: "outline" },
      ]}
    />
  )
}
