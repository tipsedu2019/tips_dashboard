import type { Metadata } from "next";
import { PublicClassesView } from "@/components/public/public-classes-view";
import { loadPublicClassCatalog } from "@/server/public-class-catalog";

export const metadata: Metadata = {
  title: "수업 찾기 | 팁스 영어·수학학원",
  description:
    "팁스의 수업 일정과 진도를 확인하고, 우리 아이에게 맞는 시간표를 만들어 보세요.",
  alternates: { canonical: "https://tipsedu.co.kr/classes" },
  openGraph: {
    title: "수업 찾기 | 팁스 영어·수학학원",
    url: "https://tipsedu.co.kr/classes",
  },
  manifest: null,
  icons: {
    icon: "https://tipsdashboard.vercel.app/favicon-window.png",
    apple: "https://tipsdashboard.vercel.app/favicon.png",
  },
};
export default async function ClassesPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [catalog, search] = await Promise.all([
    loadPublicClassCatalog(),
    searchParams,
  ]);
  const params = new URLSearchParams();
  for (const key of ["subject", "grade", "q", "class", "selected"]) {
    const value = search?.[key];
    if (typeof value === "string") params.set(key, value.slice(0, 500));
  }
  return (
    <PublicClassesView catalog={catalog} initialQuery={params.toString()} />
  );
}
