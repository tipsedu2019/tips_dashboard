"use client"

import { redirect } from "next/navigation"
import { useAuth } from "@/providers/auth-provider"

export default function AdminIndexPage() {
  const { defaultAdminPath } = useAuth()
  redirect(defaultAdminPath)
}
