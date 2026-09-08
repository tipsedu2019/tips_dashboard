"use client";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
const ManagementProviders = dynamic(() => import("./management-providers"));
export function RouteProviders({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/classes" || pathname?.startsWith("/classes/"))
    return children;
  return <ManagementProviders>{children}</ManagementProviders>;
}
