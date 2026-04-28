export type PublicReview = {
  id: string;
  role: string;
  name: string;
  content: string;
};

export type PublicReviewsPayload = {
  reviews: PublicReview[];
  highlights: string[];
  featuredReviews: PublicReview[];
  summary: {
    reviewCount: number;
    studentCount: number;
    parentCount: number;
    highlightCount: number;
  };
};

export type PublicResult = {
  id: string;
  year: number;
  exam: string;
  school: string;
  grade: string;
  name: string;
  subject: string;
  teacher: string;
  score: number;
  gradeBand: string;
  rank: string;
  detail: string;
};

export type PublicResultsPayload = {
  results: PublicResult[];
  topResults: PublicResult[];
  subjectBreakdown: Array<[string, number]>;
  yearBreakdown: Array<[number, number]>;
  summary: {
    caseCount: number;
    perfectScoreCount: number;
    gradeBandCount: number;
    subjectCount: number;
    yearCount: number;
  };
};

export function loadPublicReviewsPagePayload(
  readText?: (path: string) => Promise<string>,
): Promise<PublicReviewsPayload>;

export function loadPublicResultsPagePayload(
  readText?: (path: string) => Promise<string>,
): Promise<PublicResultsPayload>;
