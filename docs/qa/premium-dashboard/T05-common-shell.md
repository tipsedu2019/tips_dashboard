# T05 — common shell

2026-09-15. Source implementation and focused checks complete; desktop/mobile integrated screenshots and preference smoke remain pending.

- SiteHeader consumes the common min-height64px desktop/56px mobile tokens. It uses a single row with wrapping18/26px h1; long titles can expand the header. Desktop section context appears only when it differs from the title. Mobile keeps the title and named menu/search/theme controls reachable.
- SearchTrigger is an accessible44px mobile icon and a36px desktop text control. Existing opener ref, click, dialog, Escape, dirty guard and navigation are unchanged. Focus uses the shared3px ring and reduced motion removes its transition.
- Common sidebar logo is36px, expanded menu40px and submenu36px. Collapsed icon32px behavior stays within the existing48px rail. Sidebar width256, role filtering, link order, left/right placement and collapse/mode configuration remain in the existing owners.
- The admin content inset is flat for every route. Deleted only student/class route-conditioned shell selectors (header, logo, sidebar/menu, inset and their reduced-motion selectors). Student sheet geometry, side-aware centering, date fields, popover/select behavior and draft lifetime are preserved.
- Sidebar menu focus now uses the common3px ring. Menu transitions consume150ms and reduced motion; active states reuse sidebar-accent without a decorative shadow.

## Verification

- `node --test tests/admin-shell.test.mjs tests/sidebar-focus-return.test.mjs tests/command-search-navigation.test.mjs tests/guarded-navigation.test.mjs`:53 passed,0 failed. Includes role navigation, click-only quick search, input-preserving hotkeys, Escape opener return, dirty confirmation sequencing, mobile destination focus and collapsed tooltip behavior.
- ESLint on `site-header.tsx`, `command-search.tsx`, `app-sidebar.tsx`, `ui/sidebar.tsx`, `admin/layout.tsx`: exit0, no output.
- No build or restart of3215. Real1440/390 layout, title zoom, left/right/collapsed/hidden preference smoke and route start-line comparison are deferred to integrated QA. Tests do not prove rendered CSS geometry.
