# Pretendard Variable 1.3.9

Official source: https://github.com/orioncactus/pretendard/tree/v1.3.9
Official distribution guidance: https://github.com/orioncactus/pretendard#가변-다이나믹-서브셋
License: SIL Open Font License1.1, Copyright2021 Kil Hyung-jin; original license in `LICENSE.txt`.

The92 WOFF2 files are unmodified upstream variable dynamic subsets. `manifest.json` records each canonical URL, byte size and SHA-256, and the original stylesheet/license hashes. `src/lib/fonts/pretendard.css` preserves the upstream declarations and copyright with only font URLs rewritten to these self-hosted paths.

- Weight range:45–920, including400/500/550/600/650/700. No synthetic650 normalization is necessary.
- Total font assets:2,957,724 bytes. Individual assets:8,252–43,920 bytes. Local CSS:55,852 bytes uncompressed. Total stored size is not a page's transfer size.
- `font-display: swap`, `unicode-range`, no preload. The browser selects the blocks needed by rendered text; no runtime CDN dependency.
- `globals.css` bundles the declarations. The root's existing `font-sans` uses `"Pretendard Variable"` first, then Pretendard, Noto Sans KR, Apple SD Gothic Neo, Malgun Gothic, system-ui and sans-serif.
- Font URLs use relative imports so Next emits hashed files under `/_next/static/media/`. This also works through the public site's existing `/admin` and `/_next` proxy; root `/fonts` URLs are not proxied there.
- No `local()` source lets an installed older Pretendard override the pinned supply. If downloads fail, the existing system fallback still renders text.
- Do not add a full Korean font preload or a second font loader. Changes to source files require refreshing the manifest and preserving the OFL notice.

Verification boundary: asset integrity and connection checks are automated; actual font requests, glyph rendering, clipping, LCP/CLS and failure fallback require the browser QA report. Windows rendering has not been observed on this macOS host.
