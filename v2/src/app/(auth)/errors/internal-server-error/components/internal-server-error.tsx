import { TriangleAlert } from "lucide-react"

import { AuthErrorScreen } from "../../components/auth-error-screen"

export function InternalServerError() {
  return (
    <AuthErrorScreen
      code="500"
      title="화면을 불러오지 못했습니다"
      message="잠시 후 다시 시도해 주세요. 같은 문제가 반복되면 문의 화면으로 이동하세요."
      icon={TriangleAlert}
      actions={[
        { href: "/admin/dashboard", label: "대시보드" },
        { href: "/inquiry", label: "문의", variant: "outline" },
      ]}
    />
  )
}
