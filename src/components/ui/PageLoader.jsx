function SkeletonBlock({ className = "" }) {
  return <span className={["tds-skeleton-block", className].filter(Boolean).join(" ")} />;
}

function LoaderDots({ label = "" }) {
  return (
    <div className="tds-page-loader-indicator">
      <div className="tds-loader-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      {label ? <span className="tds-page-loader-label">{label}</span> : null}
    </div>
  );
}

export function PublicClassLandingSkeleton({ isMobile = false }) {
  return (
    <section
      className={`public-landing-loading-shell ${isMobile ? "is-mobile" : "is-desktop"}`}
      data-testid="public-landing-loading-skeleton"
      aria-label="수업 목록을 불러오는 중"
    >
      <div className="public-landing-loading-copy">
        <SkeletonBlock className="is-kicker" />
        <SkeletonBlock className="is-title" />
        <SkeletonBlock className="is-body" />
      </div>

      <div className="public-landing-loading-grid">
        <div className="public-landing-loading-list">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={`landing-skeleton-${index}`} className="public-landing-loading-card">
              <div className="public-landing-loading-card-copy">
                <SkeletonBlock className="is-chip" />
                <SkeletonBlock className="is-card-title" />
                <SkeletonBlock className="is-card-body" />
                <SkeletonBlock className="is-card-body short" />
              </div>
              <SkeletonBlock className="is-button" />
            </div>
          ))}
        </div>

        {!isMobile ? (
          <aside className="public-landing-loading-panel">
            <SkeletonBlock className="is-panel-title" />
            <SkeletonBlock className="is-panel-body" />
            <SkeletonBlock className="is-panel-body short" />
            <div className="public-landing-loading-panel-grid">
              {Array.from({ length: 6 }, (_, index) => (
                <SkeletonBlock key={`landing-panel-${index}`} className="is-tile" />
              ))}
            </div>
            <SkeletonBlock className="is-button wide" />
          </aside>
        ) : null}
      </div>
    </section>
  );
}

export function PublicTimetableSkeleton() {
  return (
    <section
      className="public-timetable-loading-shell"
      data-testid="public-timetable-loading-skeleton"
      aria-label="수업시간표를 불러오는 중"
    >
      <div className="public-timetable-loading-copy">
        <SkeletonBlock className="is-kicker" />
        <SkeletonBlock className="is-title" />
        <SkeletonBlock className="is-body" />
      </div>

      <div className="public-timetable-loading-toolbar">
        <SkeletonBlock className="is-pill" />
        <SkeletonBlock className="is-pill" />
        <SkeletonBlock className="is-search" />
      </div>

      <div className="public-timetable-loading-grid">
        {Array.from({ length: 7 }, (_, index) => (
          <div key={`timetable-column-${index}`} className="public-timetable-loading-column">
            <SkeletonBlock className="is-day" />
            {Array.from({ length: 5 }, (__unused, rowIndex) => (
              <SkeletonBlock
                key={`timetable-cell-${index}-${rowIndex}`}
                className="is-cell"
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function PageLoader({
  title = "대시보드를 준비하는 중입니다",
  message = "최신 데이터와 화면 구성을 안전하게 불러오고 있습니다.",
  label = "데이터 동기화 중",
}) {
  return (
    <div className="tds-page-loader tds-loading-state" aria-live="polite">
      <div className="tds-page-loader-shell">
        <div className="tds-page-loader-copy">
          <LoaderDots label={label} />
          <div className="tds-page-loader-headline">
            <strong>{title}</strong>
            <p>{message}</p>
          </div>
          <div className="tds-page-loader-highlights">
            <span>시간표와 수업 계획 동기화</span>
            <span>권한과 표시 데이터 확인</span>
            <span>공개 뷰와 관리자 화면 준비</span>
          </div>
        </div>

        <div className="tds-page-loader-preview">
          <div className="tds-page-loader-preview-card">
            <SkeletonBlock className="is-kicker" />
            <SkeletonBlock className="is-title" />
            <SkeletonBlock className="is-body" />
            <div className="tds-page-loader-preview-list">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={`page-loader-line-${index}`} className="tds-page-loader-preview-row">
                  <SkeletonBlock className="is-avatar" />
                  <div className="tds-page-loader-preview-copy">
                    <SkeletonBlock className="is-line" />
                    <SkeletonBlock className="is-line short" />
                  </div>
                </div>
              ))}
            </div>
            <SkeletonBlock className="is-button wide" />
          </div>
        </div>
      </div>
    </div>
  );
}
