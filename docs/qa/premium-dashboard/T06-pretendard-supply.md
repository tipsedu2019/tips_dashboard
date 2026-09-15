# T06 — pinned Pretendard supply

2026-09-15. Source implementation and asset checks complete; real browser font/network/performance verification remains pending.

## Supply decision

Before: `fonts.ts` only exported `font-sans`; the CSS named Pretendard but had no font-face supply. Actual installed font versus macOS fallback must be distinguished by the baseline browser capture.

Read the canonical [Pretendard repository](https://github.com/orioncactus/pretendard), [1.3.9 variable dynamic stylesheet](https://raw.githubusercontent.com/orioncactus/pretendard/v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css) and [OFL license](https://raw.githubusercontent.com/orioncactus/pretendard/v1.3.9/LICENSE). Chose the official variable dynamic subsets: one variable supply supports existing 400/500/550/600/650/700 weights and downloads by unicode range. No static weight duplication, full Korean preload, CDN runtime dependency, or dependency upgrade.

- 92 unmodified WOFF2 files, total 2,957,724 bytes stored; individual files 8,252–43,920 bytes.
- Rewritten local stylesheet 55,852 bytes uncompressed; only the URLs change. Source copyright and OFL are retained.
- Weight range 45–920 supports 650 directly.
- `globals.css` imports the font declarations. Existing root `fontSansClassName`/`font-sans` wiring is retained. The pinned variable face comes first; existing Pretendard/Noto/macOS/Windows/system fallback names remain.
- `font-display: swap`, no `local()` override and no preload. Stored asset total is not the page's transfer size; browser requests depend on visible text.
- Canonical source URLs, sizes and SHA-256 are in `public/fonts/pretendard/1.3.9/manifest.json`; original license and readable supply policy are alongside it.

## Verification

- `node --test tests/pretendard-assets.test.mjs tests/premium-semantic-contrast.test.mjs`: 4 passed, 0 failed. Validates all font signatures/hashes, referenced file completeness, license integrity, unicode coverage for Korean identities/number strings, variable range and system fallback connection; reruns the color check after the CSS import.
- ESLint `src/lib/fonts.ts`: exit 0, no output.
- No build/server restart. Font requests, rendered font availability, header/table/dialog line breaks, zero clipping, blocked-request fallback, LCP/CLS and actual transferred bytes are reserved for integrated browser QA. Windows was not available and remains unverified.
