export type AcademicDirectorAssignmentStatus = "resolved" | "ambiguous" | "unsupported";

export type AcademicDirectorAssignmentInput = {
  subjects?: string | string[];
  grade?: string;
  effectiveYear?: number | string;
};

export type AcademicDirectorAssignmentResult = {
  status: AcademicDirectorAssignmentStatus;
  directorName: string;
  candidateNames: string[];
  reason: string;
  normalizedGrade: string;
  normalizedSubjects: string[];
};

export function resolveAcademicDirector(
  input?: AcademicDirectorAssignmentInput,
): AcademicDirectorAssignmentResult;
