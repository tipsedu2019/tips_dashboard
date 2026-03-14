# TIPS Dashboard Deployment Notes

## Vercel

This project is a Vite single-page app and is intended to be deployed on Vercel.

- Build command: `npm run build`
- Output directory: `dist`
- SPA rewrite: handled by `vercel.json`

## Required Environment Variables

Set these in Vercel for every environment:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Optional Fallback Role Variables

These allow temporary role assignment when the `profiles` row is missing or unreadable.

- `VITE_FALLBACK_ADMIN_EMAILS`
- `VITE_FALLBACK_STAFF_EMAILS`
- `VITE_FALLBACK_TEACHER_EMAILS`

Examples:

- `VITE_FALLBACK_ADMIN_EMAILS=admin@tips.com,yeoyuasset@naver.com`
- `VITE_FALLBACK_STAFF_EMAILS=tipsacademy@naver.com`
- `VITE_FALLBACK_TEACHER_EMAILS=teacher@tips.com,tipsedu@naver.com`
- `VITE_FALLBACK_STAFF_EMAILS=`

You can use either full emails or bare IDs such as `admin` and `teacher`. Bare IDs are normalized to `@tips.com`.

## Expected Supabase Tables

The connected Supabase project should contain at least:

- `profiles`
- `classes`
- `students`
- `textbooks`
- `progress_logs`
- `academic_events`
- `academic_schools`
- `academic_curriculum_profiles`
- `academic_supplement_materials`
- `academic_exam_scopes`
- `academic_exam_days`
- `app_preferences`

Run [`SUPABASE_MIGRATION.sql`](/Users/부희/Desktop/Antigravity/tips_dashboard/SUPABASE_MIGRATION.sql) in Supabase SQL Editor before using:

- 학사 데이터 업로드
- 영어/수학 시험당일 관리
- 서버 공용 표 레이아웃 저장
- `schedule_plan` 영구 저장

The app can still run before the migration, but some values will only work in client-side fallback mode.

## Academic Upload Notes

The academic workspace supports two upload formats:

1. Five-sheet template workbook
   - `학교목록`
   - `교과정보`
   - `부교재`
   - `시험범위`
   - `시험당일`
2. One-sheet high-school source workbook
   - 학교 / 고1 / 고2 / 고3 / 시험기간 / 수학여행 / 방학/기타일정 구조

Bulk academic upload is intended for `admin/staff`.
`teacher` accounts can edit shared academic information manually in the UI, but should not rely on bulk upload.

## Shared Table Layout

Column visibility, order, grouping, and sort are stored in `app_preferences`.
The shared keys currently used by the frontend are:

- `dashboard:classes`
- `data-manager:students`
- `data-manager:classes`
- `data-manager:textbooks`

## Pre-Deploy Checklist

- Confirm `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set.
- Confirm fallback role env vars are set if you need temporary allowlists.
- Run [`SUPABASE_MIGRATION.sql`](/Users/부희/Desktop/Antigravity/tips_dashboard/SUPABASE_MIGRATION.sql) in Supabase SQL Editor.
- Verify the academic tables and `app_preferences` are readable/writable under your RLS policies.
- Run `npm run build`.
- Verify in a preview deployment:
  - public class list opens
  - public class name opens the read-only schedule plan modal
  - admin/staff can open `데이터 관리`
  - academic upload works for admin/staff
  - timetable image export works in single-view mode
