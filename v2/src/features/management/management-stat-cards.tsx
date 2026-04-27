import { BookOpen, GraduationCap, LibraryBig, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type {
  ManagementKind,
  ManagementStat,
} from "@/features/management/use-management-records";

const ICONS = {
  students: Users,
  classes: GraduationCap,
  textbooks: LibraryBig,
  fallback: BookOpen,
} as const;

export function ManagementStatCards({
  kind,
  stats,
}: {
  kind: ManagementKind;
  stats: ManagementStat[];
}) {
  const Icon = ICONS[kind] || ICONS.fallback;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.label} className="border">
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Icon className="text-muted-foreground size-6" />
              <Badge variant="outline">Live</Badge>
            </div>
            <div className="space-y-2">
              <p className="text-muted-foreground text-sm font-medium">
                {stat.label}
              </p>
              <div className="text-2xl font-bold">{stat.value}</div>
              <div className="text-muted-foreground text-sm">{stat.hint}</div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
