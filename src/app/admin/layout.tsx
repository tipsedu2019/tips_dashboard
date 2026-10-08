import DashboardLayout from "@/components/admin-dashboard-layout"

// A cached document can reference chunks removed by a later deployment.
// Keep this policy on admin pages; hashed assets and API routes keep their own caching.
export const dynamic = "force-dynamic"

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <DashboardLayout>{children}</DashboardLayout>
}
