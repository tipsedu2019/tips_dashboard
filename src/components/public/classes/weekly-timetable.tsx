"use client";
import { useRef, useState } from "react";
import { Download, Link2, Printer } from "lucide-react";
import type { PublicClassItem } from "./types";
import {
  clockLabel,
  conflicts,
  DAYS,
  layoutSlots,
  scheduleSlots,
} from "./helpers";
import styles from "./public-classes.module.css";
export function WeekGrid({
  classes,
  compact = false,
}: {
  classes: PublicClassItem[];
  compact?: boolean;
}) {
  const slots = layoutSlots(classes.flatMap(scheduleSlots));
  const [day, setDay] = useState(0);
  const visibleDays = compact
    ? DAYS.slice(0, Math.max(5, ...slots.map((s) => s.day + 1)))
    : DAYS;
  const first = slots.length
    ? Math.floor(Math.min(...slots.map((s) => s.start)) / 60) * 60
    : 15 * 60;
  const last = slots.length
    ? Math.ceil(Math.max(...slots.map((s) => s.end)) / 60) * 60
    : 21 * 60;
  const hours = Array.from(
    { length: Math.max(1, (last - first) / 60) },
    (_, i) => first + i * 60,
  );
  return (
    <div className={compact ? styles.compactGrid : styles.fullGrid}>
      {!compact && (
        <div className={styles.daySelector} aria-label="시간표 요일">
          {DAYS.map((d, i) => (
            <button key={d} aria-pressed={day === i} onClick={() => setDay(i)}>
              {d}
            </button>
          ))}
        </div>
      )}
      <div
        className={styles.week}
        style={
          {
            "--hours": hours.length,
            gridTemplateColumns: `${compact ? 31 : 43}px repeat(${visibleDays.length}, minmax(0,1fr))`,
          } as React.CSSProperties
        }
      >
        <div className={styles.timeColumn}>
          <div className={styles.dayHeading}>시간</div>
          {hours.map((h) => (
            <div className={styles.hour} key={h}>
              {clockLabel(h)}
            </div>
          ))}
        </div>
        {visibleDays.map((d, i) => (
          <div
            key={d}
            className={`${styles.dayColumn} ${i === day ? styles.activeDay : ""}`}
          >
            <div className={styles.dayHeading}>{d}</div>
            <div className={styles.dayBody}>
              {hours.map((h) => (
                <div className={styles.gridLine} key={h} />
              ))}
              {slots
                .filter((s) => s.day === i)
                .map((slot, index) => {
                  const collision = slot.laneCount > 1;
                  const lane = slot.lane;
                  return (
                    <div
                      key={`${slot.classId}-${index}`}
                      title={`${slot.name} · ${DAYS[slot.day]} ${clockLabel(slot.start)}–${clockLabel(slot.end)}`}
                      aria-label={`${slot.name} · ${DAYS[slot.day]} ${clockLabel(slot.start)}–${clockLabel(slot.end)}`}
                      className={`${styles.slot} ${styles[`color${classes.findIndex((c) => c.id === slot.classId) % 6}`]} ${collision ? styles.collision : ""}`}
                      style={{
                        top: `${((slot.start - first) / (last - first)) * 100}%`,
                        height: `${((slot.end - slot.start) / (last - first)) * 100}%`,
                        ...(collision
                          ? {
                              left: `calc(${(lane / slot.laneCount) * 100}% + 1px)`,
                              width: `calc(${100 / slot.laneCount}% - 2px)`,
                              right: "auto",
                            }
                          : {}),
                      }}
                    >
                      <strong>
                        {compact
                          ? classes.findIndex((c) => c.id === slot.classId) + 1
                          : slot.name}
                      </strong>
                      {!compact && (
                        <>
                          <span>
                            {clockLabel(slot.start)}–{clockLabel(slot.end)}
                          </span>
                          {collision && <span>시간 겹침</span>}
                        </>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
export function WeeklyTimetable({
  classes,
  onRemove,
}: {
  classes: PublicClassItem[];
  onRemove: (id: string) => void;
}) {
  const exportRef = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const clashes = conflicts(classes.flatMap(scheduleSlots));
  async function exportPng() {
    if (!exportRef.current) return;
    setBusy(true);
    setMessage("시간표 이미지를 준비하고 있습니다.");
    let clone: HTMLDivElement | undefined;
    let exportHost: HTMLDivElement | undefined;
    try {
      clone = exportRef.current.cloneNode(true) as HTMLDivElement;
      clone.dataset.exporting = "true";
      Object.assign(clone.style, {
        width: "1100px",
        padding: "28px",
      });
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
        backgroundColor: "#ffffff",
        pixelRatio: 2,
        width: 1100,
        style: {
          width: "1100px",
          padding: "28px",
        },
        filter: (node) =>
          !(node instanceof HTMLElement && node.dataset.noExport === "true"),
      });
      const a = document.createElement("a");
      a.download = "TIPS-내-시간표.png";
      a.href = url;
      a.click();
      setMessage("시간표 이미지를 저장했습니다.");
    } catch {
      setMessage(
        "이미지를 저장하지 못했습니다. 다시 시도하거나 인쇄를 이용해 주세요.",
      );
    } finally {
      exportHost?.remove();
      setBusy(false);
    }
  }
  async function share() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("class");
      url.searchParams.set("selected", classes.map((c) => c.id).join(","));
      await navigator.clipboard.writeText(url.href);
      setMessage("시간표 링크를 복사했습니다.");
    } catch {
      setMessage(
        "링크 복사를 허용해 주세요. 주소창의 링크로도 공유할 수 있습니다.",
      );
    }
  }
  return (
    <>
      <div className={styles.toolbar}>
        <button onClick={exportPng} disabled={busy || !classes.length}>
          <Download size={17} />
          {busy ? "저장 중…" : "PNG 저장"}
        </button>
        <button onClick={() => window.print()} disabled={!classes.length}>
          <Printer size={17} />
          인쇄
        </button>
        <button onClick={share} disabled={!classes.length}>
          <Link2 size={17} />
          링크 복사
        </button>
      </div>
      <p role="status" className={styles.feedback}>
        {message}
      </p>
      <div ref={exportRef} className={styles.printSurface}>
        <h3>TIPS · 내 시간표</h3>
        <p className={styles.muted}>
          정규 주간 시간표입니다. 휴강·보강은 각 수업의 날짜별 일정에서
          확인하세요.
        </p>
        {clashes.length > 0 && (
          <div className={styles.warning}>
            <strong>시간이 겹치는 수업이 있습니다.</strong>
            {clashes.map(({ a, b }, i) => (
              <p key={i}>
                {DAYS[a.day]} {clockLabel(Math.max(a.start, b.start))}–
                {clockLabel(Math.min(a.end, b.end))} · {a.name} / {b.name}
              </p>
            ))}
          </div>
        )}
        <WeekGrid classes={classes} />
        <div className={styles.savedList}>
          {classes.map((c, i) => (
            <div key={c.id} className={styles.savedRow}>
              <span className={`${styles.colorDot} ${styles[`color${i}`]}`} />
              <div>
                <strong>{c.name}</strong>
                <p>{c.schedule || "시간 협의"}</p>
              </div>
              <button
                data-no-export="true"
                className={styles.textButton}
                onClick={() => onRemove(c.id)}
                aria-label={`${c.name} 시간표에서 빼기`}
              >
                빼기
              </button>
            </div>
          ))}
        </div>
        {!classes.length && (
          <p className={styles.empty}>
            담은 수업이 없습니다. 수업 목록에서 시간표에 담아 보세요.
          </p>
        )}
        <p className={styles.muted}>수업은 상담 후 확정됩니다.</p>
      </div>
    </>
  );
}
