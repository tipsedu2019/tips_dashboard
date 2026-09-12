"use client";

import { useAuth } from "@/providers/auth-provider";
import { RecruitingInbox } from "@/features/recruiting/recruiting-inbox";

export default function RecruitingPage() {
  const { isAdmin, session, loading } = useAuth();
  if (loading) return <p className="px-4 md:px-6" role="status">권한을 확인하고 있습니다.</p>;
  if (!isAdmin || !session?.access_token) return <p className="px-4 md:px-6" role="alert">관리자만 지원서를 열람할 수 있습니다.</p>;
  return <RecruitingInbox key={session.access_token} accessToken={session.access_token} />;
}
