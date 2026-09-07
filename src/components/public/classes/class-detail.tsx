"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, RefreshCw } from "lucide-react";
import type {
  PublicClassDetail,
  PublicClassSession,
  PublicTextbookRange,
} from "./types";
import {
  DAYS,
  monthCells,
  seoulToday,
  sessionDisplay,
  progressForSession,
  sessionState,
} from "./helpers";
import styles from "./public-classes.module.css";
const cache = new Map<string, { data: PublicClassDetail; expires: number }>();
function rangeLabel(range?: PublicTextbookRange) {
  return (
    range?.label ||
    [range?.start, range?.end].filter(Boolean).join("–") ||
    "진도 미입력"
  );
}
export default function ClassDetail({
  id,
  saved,
  onSave,
  canSave,
  selectionFull,
}: {
  id: string;
  saved: boolean;
  onSave: () => void;
  canSave: boolean;
  selectionFull: boolean;
}) {
  const [result, setResult] = useState<{
    data?: PublicClassDetail;
    error?: string;
  }>({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    async function load() {
      try {
        const hit = cache.get(id);
        if (hit && hit.expires > Date.now()) {
          if (alive) setResult({ data: hit.data });
          return;
        }
        cache.delete(id);
        const response = await fetch(
          `/api/public-classes/${encodeURIComponent(id)}`,
          { signal: controller.signal },
        );
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? "현재 공개되지 않거나 종료된 수업입니다."
              : "수업 일정을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
          );
        const data = (await response.json()) as PublicClassDetail;
        if (alive) {
          cache.set(id, { data, expires: Date.now() + 600_000 });
          if (cache.size > 12) cache.delete(cache.keys().next().value!);
          setResult({ data });
        }
      } catch (error) {
        if (alive)
          setResult({
            error: controller.signal.aborted
              ? "불러오기가 지연되고 있습니다. 다시 시도해 주세요."
              : error instanceof Error
                ? error.message
                : "수업을 불러오지 못했습니다.",
          });
      } finally {
        clearTimeout(timeout);
      }
    }
    void load();
    return () => {
      alive = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [id, attempt]);
  if (result.error)
    return (
      <div className={styles.empty} role="alert">
        <p>{result.error}</p>
        <button
          className={styles.primary}
          onClick={() => {
            setResult({});
            setAttempt((a) => a + 1);
          }}
        >
          <RefreshCw size={16} />
          다시 시도
        </button>
      </div>
    );
  if (!result.data)
    return (
      <div className={styles.loading} role="status">
        수업 일정과 진도를 불러오고 있습니다…
      </div>
    );
  return (
    <>
      <SessionCalendar detail={result.data} />
      {selectionFull && (
        <p id="detail-save-limit" className={styles.warning} role="status">
          시간표에는 최대 6개 수업을 담을 수 있습니다. 담은 수업을 먼저 빼
          주세요.
        </p>
      )}
      <div className={styles.detailFooter}>
        <button
          className={styles.outline}
          onClick={onSave}
          disabled={!canSave || selectionFull}
          aria-describedby={selectionFull ? "detail-save-limit" : undefined}
        >
          {saved ? "시간표에서 빼기" : "시간표에 담기"}
        </button>
        <a
          className={styles.primary}
          href="https://tipsedu.channel.io/"
          target="_blank"
          rel="noreferrer"
        >
          이 수업 상담하기 ↗
        </a>
      </div>
    </>
  );
}
function SessionCalendar({ detail }: { detail: PublicClassDetail }) {
  const calendarRef = useRef<HTMLDivElement>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const today = seoulToday();
  const sessions = detail.classItem.schedulePlan?.sessions || [];
  const dates = sessions
    .map((s) => s.date || "")
    .filter(Boolean)
    .sort();
  const initial = dates.some((d) => d.slice(0, 7) === today.slice(0, 7))
    ? today
    : dates.find((d) => d >= today) || dates[dates.length - 1] || today;
  const [month, setMonth] = useState(initial.slice(0, 7));
  const [selected, setSelected] = useState(
    dates.find((d) => d >= initial && d.startsWith(initial.slice(0, 7))) ||
      dates.find((d) => d.startsWith(initial.slice(0, 7))) ||
      initial,
  );
  const [year, monthNumber] = month.split("-").map(Number);
  const visible = sessions.filter((s) => s.date?.startsWith(month));
  const selectedSessions = sessions.filter((s) => s.date === selected);
  const inactive = visible.filter((s) => sessionState(s).cancelled).length;
  const cancelled = visible.filter(
    (s) => sessionState(s).label === "휴강",
  ).length;
  const periods = detail.classItem.schedulePlan?.billingPeriods || [];
  function move(delta: number) {
    const next = new Date(Date.UTC(year, monthNumber - 1 + delta, 1))
      .toISOString()
      .slice(0, 7);
    setMonth(next);
    setSelected(
      sessions.find((s) => s.date?.startsWith(next))?.date || `${next}-01`,
    );
  }
  async function exportMonth() {
    if (!calendarRef.current) return;
    setExportBusy(true);
    setExportMessage("달력 이미지를 준비하고 있습니다.");
    let clone: HTMLDivElement | undefined;
    let exportHost: HTMLDivElement | undefined;
    try {
      clone = calendarRef.current.cloneNode(true) as HTMLDivElement;
      clone.dataset.calendarExport = "true";
      clone.className += ` ${styles.calendarExport}`;
      Object.assign(clone.style, {
        width: "720px",
        padding: "28px",
        background: "#fff",
      });
      const heading = document.createElement("h2");
      heading.textContent = `TIPS · ${detail.classItem.name}`;
      const metadata = document.createElement("p");
      metadata.className = styles.muted;
      metadata.textContent = `${detail.classItem.schedule.replace(/\n/g, " · ")} · ${detail.classItem.teacher}`;
      clone.prepend(heading, metadata);
      clone
        .querySelectorAll("button")
        .forEach((button) => button.setAttribute("tabindex", "-1"));
      exportHost = document.createElement("div");
      Object.assign(exportHost.style, {
        position: "fixed",
        left: "-12000px",
        top: "0",
        pointerEvents: "none",
      });
      exportHost.appendChild(clone);
      document.body.appendChild(exportHost);
      const { toPng } = await import("html-to-image");
      const url = await toPng(clone, {
        backgroundColor: "#fff",
        pixelRatio: 2,

        filter: (node) =>
          !(node instanceof HTMLElement && node.dataset.noExport === "true"),
      });
      const link = document.createElement("a");
      link.href = url;
      link.download = `TIPS-${detail.classItem.name}-${month}.png`;
      link.click();
      setExportMessage("이 달 일정을 저장했습니다.");
    } catch {
      setExportMessage("일정을 저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      exportHost?.remove();
      setExportBusy(false);
    }
  }
  function sessionPanel(session: PublicClassSession, index: number) {
    const state = sessionState(session);
    const display = sessionDisplay(detail.classItem, session);
    const entries = session.textbookEntries?.length
      ? session.textbookEntries
      : detail.classItem.schedulePlan?.textbooks || [];
    const progress = progressForSession(detail.progressLogs, session, sessions);
    return (
      <section key={session.id || index} className={styles.sessionPanel}>
        <div className={styles.sessionTitle}>
          <span
            className={`${styles.badge} ${state.cancelled ? styles.neutral : styles.blue}`}
          >
            {state.label}
          </span>
          {session.sessionNumber != null && (
            <span>{session.sessionNumber}회차</span>
          )}
        </div>
        <h4>{display.time}</h4>
        {display.regularFallback && (
          <p className={styles.muted}>정규 시간 기준</p>
        )}
        <p>
          {display.teacher} · {display.room}
        </p>
        {session.originalDate && <p>원래 수업일 {session.originalDate}</p>}
        {session.makeupDate && <p>보강일 {session.makeupDate}</p>}
        {session.publicNote && (
          <p className={styles.publicNote}>{session.publicNote}</p>
        )}
        {session.billingLabel && (
          <p className={styles.muted}>수강 구간 · {session.billingLabel}</p>
        )}
        {entries.map((entry, i) => {
          const book = detail.textbooks.find((b) => b.id === entry.textbookId);
          const actual = progress.get(entry.textbookId || "");
          return (
            <div className={styles.progress} key={`${entry.textbookId}-${i}`}>
              <strong>{entry.alias || book?.title || "교재"}</strong>
              <dl>
                <div>
                  <dt>계획</dt>
                  <dd>{rangeLabel(entry.plan)}</dd>
                </div>
                <div>
                  <dt>실제</dt>
                  <dd>
                    {actual
                      ? actual.rangeLabel ||
                        [actual.rangeStart, actual.rangeEnd]
                          .filter(Boolean)
                          .join("–") ||
                        (actual.completedLessonIds.length
                          ? `완료 단원 ${actual.completedLessonIds.length}개`
                          : "진도 미입력")
                      : rangeLabel(entry.actual)}
                  </dd>
                </div>
              </dl>
              {(actual?.publicNote ||
                entry.actual?.publicNote ||
                entry.plan?.publicNote) && (
                <p>
                  {actual?.publicNote ||
                    entry.actual?.publicNote ||
                    entry.plan?.publicNote}
                </p>
              )}
            </div>
          );
        })}
        {!entries.length && (
          <p className={styles.muted}>등록된 교재 진도가 없습니다.</p>
        )}
      </section>
    );
  }
  return (
    <>
      {detail.availability === "snapshot" && (
        <p className={styles.warning}>
          최근 저장된 일정입니다. 기준{" "}
          {new Date(detail.generatedAt).toLocaleString("ko-KR", {
            timeZone: "Asia/Seoul",
            hourCycle: "h23",
          })}
        </p>
      )}
      <div className={styles.detailFacts}>
        <span>{detail.classItem.schedule || "시간 협의"}</span>
        <span>{detail.classItem.teacher}</span>
        <strong>
          {detail.classItem.tuition > 0
            ? `${detail.classItem.tuition.toLocaleString("ko-KR")}원`
            : "수강료 문의"}
        </strong>
      </div>
      <div className={styles.calendarLayout}>
        <div>
          <div ref={calendarRef}>
            <div className={styles.monthHeading}>
              <h3>
                {year}년 {monthNumber}월
              </h3>
              <div data-no-export="true">
                <button
                  className={styles.iconButton}
                  aria-label="이전 달"
                  onClick={() => move(-1)}
                >
                  <ChevronLeft size={20} />
                </button>
                <button
                  className={styles.iconButton}
                  aria-label="다음 달"
                  onClick={() => move(1)}
                >
                  <ChevronRight size={20} />
                </button>
              </div>
            </div>
            <p className={styles.muted} aria-live="polite">
              이 달 수업 {visible.length - inactive}회 · 휴강 {cancelled}회
              {inactive > cancelled
                ? ` · 미정/제외 ${inactive - cancelled}회`
                : ""}
            </p>
            <div className={styles.calendar}>
              {DAYS.map((day) => (
                <div className={styles.calendarDayName} key={day}>
                  {day}
                </div>
              ))}
              {monthCells(year, monthNumber - 1).map((date, index) => {
                const daySessions = sessions.filter((s) => s.date === date);
                return date ? (
                  <button
                    key={date}
                    className={`${styles.calendarCell} ${selected === date ? styles.selectedDate : ""} ${date === today ? styles.today : ""}`}
                    aria-label={`${date}${daySessions.length ? ", " + daySessions.map((s) => `${sessionState(s).label}${s.sessionNumber != null ? ` ${s.sessionNumber}회차` : ""}`).join(", ") : ", 등록된 수업 없음"}`}
                    aria-pressed={selected === date}
                    onClick={() => setSelected(date)}
                  >
                    <span>{Number(date.slice(8))}</span>
                    {daySessions.map((s, i) => (
                      <small
                        className={
                          sessionState(s).cancelled ? styles.cancelled : ""
                        }
                        key={s.id || i}
                      >
                        {sessionState(s).label === "정규 수업" &&
                        s.sessionNumber != null
                          ? `${s.sessionNumber}회차`
                          : sessionState(s).label}
                      </small>
                    ))}
                  </button>
                ) : (
                  <div
                    key={`blank-${index}`}
                    className={styles.calendarBlank}
                  />
                );
              })}
            </div>
            <p className={styles.muted} data-no-export="true">
              날짜를 선택하면 수업 시간과 교재 진도를 볼 수 있습니다.
            </p>
            {periods.length > 0 && (
              <details className={styles.periods} data-no-export="true">
                <summary>수강 구간별 회차</summary>
                {periods.map((p, i) => (
                  <p key={p.id || i}>
                    <strong>{p.label || "수강 구간"}</strong> · {p.startDate}–
                    {p.endDate}
                    {` · 기록된 수업 ${sessions.filter((s) => s.billingId === p.id && !sessionState(s).cancelled).length}회`}
                  </p>
                ))}
              </details>
            )}
          </div>
          <button
            className={styles.monthExportButton}
            onClick={exportMonth}
            disabled={exportBusy}
          >
            <Download size={16} />
            {exportBusy ? "저장 중…" : "이 달 일정 저장"}
          </button>
          <p role="status" className={styles.feedback}>
            {exportMessage}
          </p>
        </div>
        <div className={styles.sessionColumn} aria-live="polite">
          <h3>
            {Number(selected.slice(5, 7))}월 {Number(selected.slice(8))}일
          </h3>
          {selectedSessions.length ? (
            selectedSessions.map(sessionPanel)
          ) : (
            <p className={styles.empty}>등록된 수업이 없습니다.</p>
          )}
        </div>
      </div>
      {!sessions.length && (
        <p className={styles.warning}>
          등록된 날짜별 일정이 없습니다. 정확한 일정은 학원에 문의해 주세요.
        </p>
      )}
    </>
  );
}
