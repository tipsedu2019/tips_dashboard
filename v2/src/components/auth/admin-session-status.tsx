"use client";

import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/providers/auth-provider";

export function AdminSessionStatus() {
  const { user, role, authError, mustChangePassword } = useAuth();

  const roleLabel =
    role === "admin"
      ? "관리자 권한"
      : role === "staff"
        ? "운영 스태프"
        : role === "teacher"
          ? "교사 권한"
          : "읽기 전용";

  const summary = authError
    ? authError
    : mustChangePassword
      ? "초기 비밀번호를 변경하면 모든 운영 화면을 바로 사용할 수 있습니다."
      : user?.email || "현재 계정이 로그인된 상태입니다.";

  const tone: "default" | "destructive" | "outline" = authError
    ? "destructive"
    : mustChangePassword
      ? "outline"
      : "default";

  return (
    <div className="border-b border-border/60 bg-muted/30 px-4 py-3 md:px-6">
      <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-background/95 px-4 py-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={tone}>{mustChangePassword ? "비밀번호 변경 필요" : roleLabel}</Badge>
            {user?.isFallbackRole ? <Badge variant="secondary">프로필 복구 대기</Badge> : null}
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">
              {user?.name || user?.loginId || user?.email || "운영 계정"}
            </p>
            <p className="text-sm text-muted-foreground">{summary}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
