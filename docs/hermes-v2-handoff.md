# TIPS Dashboard v2 Hermes Handoff

Last updated: 2026-04-16
Workspace: `/home/hyunjun/hermes/workspace/tips_dashboard`

## 1. Product Direction

`tips_dashboard` is now split into two future products:

1. `v2/` = the operational admin/dashboard app
2. a future separate public repository = the public website/app

This is no longer a shared public+admin rebuild.

The user's current decision is:
- Keep all ongoing implementation focus on admin/dashboard completeness inside `v2/`.
- Treat public views (`/`, `/reviews`, `/results`, `/classes`, `/inquiry`) as a separate product line.
- Public should eventually live in its own repository, with its own build/deploy path.
- `classes` is the only public surface allowed to keep a data contract with dashboard-managed information.
- Do not spend active product-polish effort on v2-native public pages.

## 2. Non-Negotiable Scope Rules

### Admin / v2
- `v2/` is the real implementation target.
- Priority is operational completeness, parity, and polish for admin workflows.
- Public-facing redesign work should not consume admin bandwidth.

### Public
- Public surfaces are not the v2 product anymore.
- Current legacy-backed public routing inside `v2` is only a temporary bridge.
- The bridge exists to preserve entrypoints while admin work continues.
- The bridge should be removable once the new public repo is ready.

## 3. Current Architecture

### Today
- Repo root = legacy app + historical assets
- `v2/` = Next.js admin app under active development
- `v2` currently serves temporary legacy-backed public entrypoints via copied static assets under `v2/public/legacy-public/...`
- Public routes in `v2` currently redirect to those legacy-backed static entrypoints

### Target architecture
- `tips_dashboard/v2` (or successor admin repo) = admin-only app
- separate public repo = public-only app
- only shared contract should be explicitly versioned APIs/data payloads where needed
- `classes` may continue consuming dashboard-backed data through a narrow API contract

## 4. Migration Plan

### Phase A — Temporary bridge while admin is built
Current accepted state:
- `/` -> temporary legacy-backed public shell
- `/reviews` -> temporary legacy-backed public shell
- `/results` -> temporary legacy-backed public shell
- `/classes` -> temporary legacy-backed public shell
- `/inquiry` -> external inquiry destination
- `/admin/*` -> real v2 implementation surface

Purpose:
- preserve public entrypoints without continuing public feature work inside `v2`
- avoid blocking admin completion on public migration decisions

### Phase B — Build the separate public repository
Required outcome:
- create a dedicated public repo/app
- move public pages, public assets, public CSS, and public build pipeline there
- preserve legacy public UX where desired, but under the new public repo's ownership
- define only the minimum shared contracts with admin

Recommended ownership split:
- home/reviews/results/inquiry = fully owned by public repo
- classes = owned by public repo UI, but may read a dashboard-owned data/API contract

### Phase C — Cutover
When the separate public repo is ready:
- replace temporary `v2` public redirects/bridges with final external or reverse-proxied destinations
- stop serving copied legacy public bundles from `v2/public`
- remove v2-native public route maintenance burden
- keep `v2` focused on admin/authenticated operations only

### Phase D — Legacy removal
Only after cutover is verified:
- delete temporary legacy-public bridge assets from `v2/public`
- remove route shims that existed only for compatibility
- keep classes contract tests if `classes` still reads dashboard-managed data

## 5. What “Separate Repository” Means Here

This is the intended final meaning:
- separate repo
- separate build
- separate deploy target
- separate CSS/design system ownership
- separate public routing ownership

Not required:
- completely unrelated data model

Allowed shared area:
- explicit API/data contracts only

Not allowed in the final state:
- public pages depending on internal admin component trees
- public styling coupled to v2 admin layout system
- public deploys breaking because admin app changed

## 6. Current Status Summary

### Public side
- Public routes inside `v2` have been downgraded to temporary bridge entrypoints.
- Legacy public shells/assets were copied into `v2/public` only as an interim preservation mechanism.
- This is not the final public architecture.

### Admin side
- Admin work remains the primary stream.
- Recent progress includes timetable parity improvements, curriculum/type fixes, auth route cleanup, and admin session status UI.
- Builds are passing in the current WSL workspace.

## 7. Important Workspace Facts

- Workspace root: `/home/hyunjun/hermes/workspace/tips_dashboard`
- Environment: WSL2
- Node/npm are installed through `nvm`
- Old Docker-style `/workspace/...` assumptions are invalid here
- Stable dev-server pattern in this environment is `npm run dev -- --webpack`

## 8. Immediate Next Steps

1. Continue admin/dashboard parity and polish only.
2. Avoid adding new native public features inside `v2`.
3. Prepare an explicit extraction checklist for the future separate public repo:
   - routes/pages to migrate
   - public asset inventory
   - public CSS/design token inventory
   - classes data/API contract definition
4. Once admin is sufficiently stable, build and cut over the public repo.
5. Remove the temporary bridge from `v2` after cutover verification.

## 9. Decision Rule For Future Hermes Sessions

If a task concerns:
- admin operations, authenticated workflows, backoffice parity -> work in `v2`
- public landing/reviews/results/inquiry/classes product UX -> treat it as separate-public-repo planning or extraction work, not ongoing v2 product work

## 10. Key Files

### Docs
- `docs/hermes-v2-handoff.md`
- `docs/v2-phase1-parity-checklist.md`

### Temporary bridge routes in `v2`
- `v2/src/app/page.tsx`
- `v2/src/app/reviews/page.tsx`
- `v2/src/app/results/page.tsx`
- `v2/src/app/classes/page.tsx`
- `v2/src/app/inquiry/page.tsx`
- `v2/public/legacy-public/...`

### Admin areas
- `v2/src/app/admin/layout.tsx`
- `v2/src/lib/navigation.ts`
- `v2/src/features/academic/*`
- `v2/src/features/operations/*`
- `v2/src/features/management/*`

## 11. Success Criteria

Admin success:
- `v2` can stand alone as the operations/admin dashboard
- public concerns no longer dictate v2 product decisions

Public success:
- public repo can deploy independently
- public styling/assets/routes are owned outside `v2`
- only narrow, audited contracts remain between public and admin
