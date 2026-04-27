import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "관리자 로그인 | TIPS Dashboard",
  description: "TIPS 운영 대시보드 관리자 로그인",
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      {children}
    </div>
  );
}
