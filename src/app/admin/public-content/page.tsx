"use client";
import { useAuth } from "@/providers/auth-provider";
import { PublicContentWorkspace } from "@/features/public-content/public-content-workspace";
export default function PublicContentPage() {
  const { isAdmin, session, loading } = useAuth();
  if (loading)
    return (
      <p role="status" className="px-4 md:px-6">
        권한을 확인하고 있습니다.
      </p>
    );
  if (!isAdmin || !session?.access_token)
    return (
      <p role="alert" className="px-4 md:px-6">
        관리자만 홈페이지 내용을 변경할 수 있습니다.
      </p>
    );
  return (
    <PublicContentWorkspace
      key={session.access_token}
      accessToken={session.access_token}
    />
  );
}
