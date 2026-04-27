import { SearchX } from "lucide-react"

import { AuthErrorScreen } from "../../components/auth-error-screen"

export function NotFoundError() {
  return (
    <AuthErrorScreen
      code="404"
      title="없는 화면입니다"
      message="주소가 바뀌었거나 운영 범위에서 제외된 화면입니다."
      icon={SearchX}
      actions={[
        { href: "/admin/dashboard", label: "대시보드" },
        { href: "/", label: "홈페이지", variant: "outline" },
      ]}
    />
  )
}
