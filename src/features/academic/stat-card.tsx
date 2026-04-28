import { type ReactNode } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type AcademicStatCardProps = {
  label: string;
  value: string;
  hint: string;
  icon?: ReactNode;
};

export function AcademicStatCard({
  label,
  value,
  hint,
  icon,
}: AcademicStatCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center justify-between gap-3">
          <span>{label}</span>
          {icon ? <span className="text-muted-foreground">{icon}</span> : null}
        </CardDescription>
        <CardTitle className="text-3xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-muted-foreground text-sm">{hint}</CardContent>
    </Card>
  );
}
