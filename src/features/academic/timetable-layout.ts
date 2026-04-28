export type TimetableLayoutView =
  | "teacher-weekly"
  | "classroom-weekly"
  | "daily-teacher"
  | "daily-classroom";

type TimetablePanelLayoutInput = {
  view: TimetableLayoutView;
  gridCount: number;
};

export function getTimetablePanelLayout({
  view,
  gridCount,
}: TimetablePanelLayoutInput) {
  const isWeeklyView =
    view === "teacher-weekly" || view === "classroom-weekly";
  const fitWeeklyColumns = isWeeklyView && gridCount === 2;

  return {
    allowHorizontalScroll: !fitWeeklyColumns && !isWeeklyView,
    fitColumns: fitWeeklyColumns,
    density: gridCount === 2 ? "compact" : "comfortable",
    slotHeight: fitWeeklyColumns ? 28 : gridCount === 2 ? 30 : 38,
    timeColumnWidth: fitWeeklyColumns ? 76 : isWeeklyView ? 72 : 84,
    minColumnWidth: fitWeeklyColumns ? 0 : isWeeklyView ? 0 : 120,
  };
}
