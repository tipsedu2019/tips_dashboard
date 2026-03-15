# TIPS Dashboard Deployment Notes

## Vercel

This project is a Vite single-page app and is intended to be deployed on Vercel.

- Build command: `npm run build`
- Output directory: `dist`
- SPA rewrite: handled by `vercel.json`

## Required App Environment Variables

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

## Recommended Database Workflow

Do not rely on manual SQL Editor copy/paste for normal updates anymore.

This repo now includes Supabase CLI migrations in:

- [supabase/migrations](/Users/부희/Desktop/Antigravity/tips_dashboard/supabase/migrations)

One-time local setup:

1. Copy [.env.supabase.example](/Users/부희/Desktop/Antigravity/tips_dashboard/.env.supabase.example) to `.env.supabase.local`
2. Fill in either:
   - `SUPABASE_DB_URL`
   - or `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`
3. Run:

```powershell
npm run db:push
```

The push script is:

- [scripts/supabase-db-push.ps1](/Users/부희/Desktop/Antigravity/tips_dashboard/scripts/supabase-db-push.ps1)

## Optional GitHub Automation

If you want migrations to apply automatically on `main`, add these GitHub repository secrets:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`

The workflow file is:

- [.github/workflows/supabase-db-push.yml](/Users/부희/Desktop/Antigravity/tips_dashboard/.github/workflows/supabase-db-push.yml)

If the secrets are missing, the workflow is skipped instead of failing.

## Manual Fallback

`SUPABASE_MIGRATION.sql` is still kept as a manual fallback for emergency repair or one-off recovery:

- [SUPABASE_MIGRATION.sql](/Users/부희/Desktop/Antigravity/tips_dashboard/SUPABASE_MIGRATION.sql)

For targeted fixes, these repair scripts are also available:

- [tmp/class-terms-fix.sql](/Users/부희/Desktop/Antigravity/tips_dashboard/tmp/class-terms-fix.sql)
- [tmp/academic-calendar-extension.sql](/Users/부희/Desktop/Antigravity/tips_dashboard/tmp/academic-calendar-extension.sql)
- [tmp/rls-recursion-fix.sql](/Users/부희/Desktop/Antigravity/tips_dashboard/tmp/rls-recursion-fix.sql)

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
- `app_preferences`

And for the latest dashboard features:

- `class_terms`
- `academic_event_exam_details`
- `academy_curriculum_plans`
- `academy_curriculum_materials`

## Pre-Deploy Checklist

- Confirm `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set.
- Confirm fallback role env vars are set if you need temporary allowlists.
- Run `npm run db:push`.
- Verify the academic tables and `app_preferences` are readable and writable under your RLS policies.
- Run `npm run build`.
- Verify in a preview deployment:
  - public class list opens
  - public class name opens the read-only schedule plan modal
  - admin/staff can open data management
  - academic upload works for admin/staff
  - timetable image export works in single-view mode
