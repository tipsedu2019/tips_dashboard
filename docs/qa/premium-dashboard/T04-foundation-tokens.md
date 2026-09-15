# T04 — shared tokens

2026-09-15. Source implementation and focused checks complete; integrated browser gallery verification remains pending.

## Inventory and decisions

- Existing Button36, edit fields42, mobile actions44, shared table44/48/12, control150/dialog200ms retained as roles. The values now have named central tokens. T08 consumes table tokens; T05 consumes shell tokens.
- Before: primary white text3.68:1, destructive white text3.76:1. Light primary L0.6231→0.5290 and destructive L0.6368→0.5450 retain their existing hue/chroma. Dark actions use L0.73 and foreground L0.2046. Sidebar primary/ring alias their common semantic token.
- Muted text needed correction on the selected accent surface: light L0.5250, dark L0.7450. Existing background/card/accent surfaces stay unchanged.
- Bounded Button correction: replace hardcoded white destructive text with destructive-foreground and remove dark-only60% background alpha. That alpha failed the new semantic pair's contrast; button mechanics, callbacks and disabled states are unchanged.
- Control radius is6px (`rounded-md`), surface radius8px is explicit; existing dialog `--radius` derivation remains unchanged.

## Measured contrast

OKLab→sRGB clamp and WCAG luminance calculation against current tokens, including90% hover compositing:

| Pair | Light | Dark |
| --- | ---: | ---: |
| primary button | 5.46 | 7.04 |
| primary hover on background | 4.54 | 5.92 |
| primary text on card | 5.46 | 5.94 |
| destructive button | 5.52 | 6.22 |
| destructive hover on background | 4.90 | 5.25 |
| destructive text on card | 5.52 | 5.25 |
| muted text on selected accent | 4.70 | 4.57 |

## Verification

- `node --test tests/premium-semantic-contrast.test.mjs`:2 passed,0 failed. Each theme verifies17 semantic pairs plus4 hover/background combinations. This checks numerical colors, not just source strings.
- `node node_modules/eslint/bin/eslint.js src/components/ui/button.tsx`: exit0, no output.
- No build, dependency upgrade, server restart, production deployment, or database mutation.
- Actual light/dark Button/Input/Select/Tabs/row state rendering, browser color gamut mapping, focus clipping and disabled/error appearance belong to the integrated T07 QA gate. Numeric results do not replace it.
