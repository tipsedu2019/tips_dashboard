export type ClassFieldOption = { value: string; label: string; disabled?: boolean };

export type ClassMetadataValues = {
  name: string; status: string; grade: string; subject: string;
  capacity: string; tuition: string; subjectAreaKey: string;
};

/** UI identity is separate from the saved slot ID and resource labels. */
export type ClassScheduleFieldRow = {
  key: string; day: string; start: string; end: string;
  teacher: string; room: string;
};
