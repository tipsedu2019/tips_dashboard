/** Change both values together when the applicant-facing consent changes. */
export const RECRUITING_CONSENT_VERSION = "talent-pool-v2";
export const RECRUITING_RETENTION_DAYS = 730;
export const RECRUITING_SUBJECTS = ["영어", "수학", "과학"] as const;
export const RECRUITING_MAX_BODY_BYTES = 16_384;
export const RECRUITING_PAGE_SIZE = 10;

export type RecruitingApplicationInput = {
  requestId: string;
  name: string;
  phone: string;
  subject: typeof RECRUITING_SUBJECTS[number];
  experience: string;
  motivation: string;
  portfolioUrl: string | null;
  talentPoolConsent: true;
  consentVersion: string;
};
export type RecruitingApplicationSummary = {
  id: string;
  name: string;
  phone: string;
  subject: string;
  createdAt: string;
  expiresAt: string;
};
export type RecruitingApplicationDetail = RecruitingApplicationSummary & {
  experience: string;
  motivation: string;
  portfolioUrl: string | null;
  consentVersion: string;
  consentedAt: string;
  retentionDays: number;
};
