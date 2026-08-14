import { Suspense } from "react";

import { ClassScheduleWorkspace } from "@/features/operations/class-schedule-workspace";

export default function Page() {
  return (
    <Suspense>
      <ClassScheduleWorkspace />
    </Suspense>
  );
}
