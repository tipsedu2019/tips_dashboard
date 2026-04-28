"use client";

import Link from "next/link";
import { useState } from "react";
import { LayoutDashboard, Menu, X } from "lucide-react";

import { Logo } from "@/components/logo";
import { ModeToggle } from "@/components/mode-toggle";
import { Button } from "@/components/ui/button";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from "@/components/ui/navigation-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const navigationItems = [
  { label: "개요", href: "#overview" },
  { label: "공개 수업", href: "/classes" },
  { label: "후기", href: "/reviews" },
  { label: "성과", href: "/results" },
  { label: "FAQ", href: "#faq" },
];

function isHashLink(href: string) {
  return href.startsWith("#");
}

function smoothScrollTo(targetId: string) {
  if (!targetId.startsWith("#")) {
    return;
  }

  const element = document.querySelector(targetId);
  if (!element) {
    return;
  }

  element.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

export function LandingNavbar() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2">
            <Logo size={32} />
            <span className="font-bold tracking-tight">TIPS Dashboard</span>
          </Link>
        </div>

        <NavigationMenu className="hidden xl:flex">
          <NavigationMenuList>
            {navigationItems.map((item) => (
              <NavigationMenuItem key={item.label}>
                {isHashLink(item.href) ? (
                  <button
                    type="button"
                    className="group inline-flex h-10 w-max items-center justify-center px-4 py-2 text-sm font-medium transition-colors hover:text-primary focus:text-primary focus:outline-none"
                    onClick={() => smoothScrollTo(item.href)}
                  >
                    {item.label}
                  </button>
                ) : (
                  <NavigationMenuLink asChild>
                    <Link
                      className="group inline-flex h-10 w-max items-center justify-center px-4 py-2 text-sm font-medium transition-colors hover:text-primary focus:text-primary focus:outline-none"
                      href={item.href}
                    >
                      {item.label}
                    </Link>
                  </NavigationMenuLink>
                )}
              </NavigationMenuItem>
            ))}
          </NavigationMenuList>
        </NavigationMenu>

        <div className="hidden xl:flex items-center gap-2">
          <ModeToggle variant="ghost" />
          <Button variant="ghost" asChild>
            <Link href="/sign-in">로그인</Link>
          </Button>
          <Button asChild>
            <Link href="/admin/dashboard">
              <LayoutDashboard data-icon="inline-start" />
              관리자
            </Link>
          </Button>
        </div>

        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger asChild className="xl:hidden">
            <Button variant="ghost" size="icon">
              <Menu className="size-5" />
              <span className="sr-only">Toggle menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent
            side="right"
            className="flex h-full w-full flex-col gap-0 overflow-hidden p-0 sm:w-[400px] [&>button]:hidden"
          >
            <div className="flex h-full flex-col">
              <SheetHeader className="space-y-0 border-b p-4 pb-2">
                <div className="flex items-center gap-2">
                  <div className="rounded-lg bg-primary/10 p-2">
                    <Logo size={16} />
                  </div>
                  <SheetTitle className="text-lg font-semibold">TIPS Dashboard</SheetTitle>
                  <div className="ml-auto flex items-center gap-1">
                    <ModeToggle variant="ghost" />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setIsOpen(false)}
                      className="size-8"
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </div>
              </SheetHeader>

              <div className="flex-1 overflow-y-auto">
                <nav className="space-y-2 p-6">
                  {navigationItems.map((item) => (
                    <div key={item.label}>
                      {isHashLink(item.href) ? (
                        <button
                          type="button"
                          className="flex w-full items-center rounded-lg px-4 py-3 text-left text-base font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
                          onClick={() => {
                            setIsOpen(false);
                            setTimeout(() => smoothScrollTo(item.href), 120);
                          }}
                        >
                          {item.label}
                        </button>
                      ) : (
                        <Link
                          href={item.href}
                          className="flex items-center rounded-lg px-4 py-3 text-base font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
                          onClick={() => setIsOpen(false)}
                        >
                          {item.label}
                        </Link>
                      )}
                    </div>
                  ))}
                </nav>
              </div>

              <div className="space-y-4 border-t p-6">
                <div className="space-y-3">
                  <Button size="lg" asChild className="w-full">
                    <Link href="/admin/dashboard" onClick={() => setIsOpen(false)}>
                      <LayoutDashboard data-icon="inline-start" />
                      관리자 열기
                    </Link>
                  </Button>
                  <Button variant="outline" size="lg" asChild className="w-full">
                    <Link href="/classes" onClick={() => setIsOpen(false)}>
                      공개 수업 보기
                    </Link>
                  </Button>
                </div>

                <p className="text-sm leading-6 text-muted-foreground">
                  TIPS Dashboard v2는 공개 수업 안내와 운영 워크스페이스를 같은 데이터 흐름으로 재구성하는 Next.js 기반 리빌드입니다.
                </p>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
