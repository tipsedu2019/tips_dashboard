---
version: alpha
name: TIPS Dashboard Quiet Operations Workspace
description: Design system for tips_dashboard and v2 admin surfaces focused on calm operational density, minimal work screens, and academic planning workflows.
colors:
  background: "#F8FAFC"
  surface: "#FFFFFF"
  surface-muted: "#F1F5F9"
  surface-subtle: "#E2E8F0"
  primary: "#2563EB"
  primary-strong: "#1D4ED8"
  text: "#0F172A"
  text-muted: "#475569"
  border: "#CBD5E1"
  border-soft: "#E2E8F0"
  success: "#15803D"
  warning: "#92400E"
  danger: "#B91C1C"
  info: "#0369A1"
  sidebar: "#F8FAFC"
  sidebar-active: "#E0E7FF"
  focus-ring: "#93C5FD"
typography:
  display-lg:
    fontFamily: Pretendard Variable
    fontSize: 2.5rem
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: -0.03em
  headline-md:
    fontFamily: Pretendard Variable
    fontSize: 1.75rem
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: -0.02em
  title-sm:
    fontFamily: Pretendard Variable
    fontSize: 1.125rem
    fontWeight: 600
    lineHeight: 1.35
  body-md:
    fontFamily: Pretendard Variable
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: Pretendard Variable
    fontSize: 0.9375rem
    fontWeight: 400
    lineHeight: 1.5
  label-sm:
    fontFamily: Pretendard Variable
    fontSize: 0.8125rem
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: 0.01em
rounded:
  sm: 6px
  md: 10px
  lg: 14px
  xl: 18px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 32px
  page-padding: 24px
  section-gap: 40px
components:
  page-shell:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "{spacing.page-padding}"
  workspace-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: 20px
  toolbar-subtle:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: 12px
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#FFFFFF"
    typography: "{typography.label-sm}"
    rounded: "{rounded.md}"
    height: 40px
    padding: 0 14px
  button-primary-hover:
    backgroundColor: "{colors.primary-strong}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.md}"
    padding: 0 14px
  input-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    height: 40px
    padding: 0 12px
  badge-neutral:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.text-muted}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: 6px 10px
  badge-success:
    backgroundColor: "{colors.success}"
    textColor: "#FFFFFF"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: 6px 10px
  badge-warning:
    backgroundColor: "{colors.warning}"
    textColor: "#FFFFFF"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: 6px 10px
  badge-danger:
    backgroundColor: "{colors.danger}"
    textColor: "#FFFFFF"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: 6px 10px
  info-banner:
    backgroundColor: "{colors.info}"
    textColor: "#FFFFFF"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 10px 12px
  sidebar-rail:
    backgroundColor: "{colors.sidebar}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: 16px
  sidebar-active-item:
    backgroundColor: "{colors.sidebar-active}"
    textColor: "{colors.text}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.md}"
    padding: 8px 10px
  focus-ring-helper:
    backgroundColor: "{colors.focus-ring}"
    textColor: "{colors.text}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: 4px 8px
  divider-soft:
    backgroundColor: "{colors.border-soft}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.full}"
    padding: 4px
  divider-strong:
    backgroundColor: "{colors.border}"
    textColor: "{colors.text}"
    rounded: "{rounded.full}"
    padding: 4px
  panel-subtle:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: 12px
---

# DESIGN

## Overview

tips_dashboard is an operational academic workspace, not a marketing site pretending to be one. The product should feel quiet, fast to read, and dependable for daily academy work: a thin navigation rail, a light context header, dense but orderly work surfaces, and detail panels only when they materially help the task.

The design target is a restrained desktop workspace translated from Vercel Dashboard, Linear, Resend, GitHub Issues, and Supabase Studio patterns without copying their branding. The app should read like a calm tool for planning, scheduling, and managing academy data.

For v2 admin work screens, the default rule is stricter than the old dashboard style: title if needed, compact controls, real data, and very little else. Summary cards, explanation cards, status theater, helper chrome, and duplicate side panels should not appear on operational screens unless explicitly requested.

## Colors

The color system is semantic and structural.

- **Background** and **Sidebar** are cool light neutrals that keep the workspace open and calm.
- **Surface** is pure white for cards, tables, dialogs, and sheets.
- **Surface Muted** and **Surface Subtle** separate controls and supporting panels without turning every region into a heavy box.
- **Primary** blue marks interaction, current location, and selected state.
- **Success**, **Warning**, **Danger**, and **Info** exist for operational meaning only.
- **Text** is deep slate rather than pure black, and **Text Muted** handles descriptions, metadata, and helper copy.
- **Border** and **Border Soft** should remain thin and quiet.

Color rules:
- structure comes first, accent comes second
- do not introduce page-specific accent colors
- do not use neon blue/purple glows
- do not use large decorative gradients on work screens
- do not hardcode raw hex values inside page components when semantic tokens already cover the intent

## Typography

Because the product is Korean-heavy and information-dense, the default type system is built on Pretendard Variable.

Typography rules:
- the interface should optimize for reading speed, not visual drama
- hierarchy comes from weight, spacing, and grouping before it comes from oversized type
- labels and controls should remain crisp and compact
- dense tables and toolbars must still feel breathable through consistent rhythm
- monospace should be reserved for code-like identifiers, counts that truly benefit from alignment, or data-heavy utilities

## Layout

Layout should privilege work over ornament.

Desktop rules:
- the left sidebar is a navigation rail, not a feature surface
- the top header communicates current context and key actions only
- the main workspace must remain visually dominant
- detail panes should open only when they reduce navigation or clarify editing
- dashboards can summarize, but true work screens should stay minimal

Mobile rules:
- do not simply compress the desktop shell
- keep one main task visible at a time
- filters and supporting actions should move into sheets or compact drawers
- tap targets and spacing must remain practical for real admin use

v2 operational layout rules:
- annual-board keeps the legacy 4-row exam grid structure
- lesson-design should prefer a dedicated work page over chrome-heavy nested shells
- lesson-design layout should prefer a direct 4-column work grid: 기본 설정 | 일정 생성 | 캘린더 | 회차 목록
- month/session controls should be merged where possible instead of duplicated
- management screens should emphasize title, controls, and table data without helper banners

## Elevation & Depth

Depth is subtle and functional.

- prefer thin borders over heavy shadows
- use one quiet elevation layer for dialogs, sheets, or high-priority panels
- tables and repeated records often do not need card stacking
- pressed states should feel slightly reduced in elevation
- focus rings must be clearer than hover states and rely on the dedicated ring token

The interface should never feel glossy, glassy, or over-layered.

## Shapes

Rounded corners should be consistent and restrained.

- default controls sit in the 6px to 10px range
- standard panels and cards sit in the 10px to 14px range
- larger work containers may use 18px if the surface still reads as professional and quiet
- pill shapes are for badges, tabs, and compact filters only

Avoid mixed radius systems that make adjacent controls look unrelated.

## Components

Implementation should start with shadcn/ui primitives and only stay custom where domain structure truly requires it.

Custom domain structures that remain product-specific include academic calendar, timetable grids, annual-board, class schedule planning surfaces, and curriculum/lesson design boards. Even there, buttons, badges, inputs, sheets, dialogs, toasts, and supporting cards should follow one shared primitive system.

Component rules:
- toolbars should be compact, icon-led where appropriate, and directly tied to the visible data
- buttons should feel quick and quiet, with subtle active feedback instead of loud animation
- tables should favor GitHub/Supabase-like management density over oversized marketing spacing
- sheets and peek panels should be preferred over route explosions when showing short-lived detail
- empty, loading, and error states should exist, but work screens should not become collections of decorative status boxes
- admin/dashboard may contain restrained summaries, but operational pages should not repeat the dashboard pattern

## Do's and Don'ts

Do:
- keep work screens minimal: title, compact controls, data
- use semantic tokens from the shared foundation as the source of truth
- preserve domain structure while modernizing primitives and shell
- keep hover and focus states clear but low-noise
- prefer wrapper-level polish over risky broad rewrites
- keep mobile behavior intentional rather than compressed desktop leftovers

Don't:
- put cards inside cards inside cards
- add helper/explanation/status chrome to every admin surface
- create visually heavy sidebars or headers
- duplicate controls in multiple regions of the same workspace
- use page-specific random colors, strong gradients, or colored shadows
- shrink desktop interaction patterns onto mobile without changing the information architecture
