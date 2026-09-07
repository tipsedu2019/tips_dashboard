"use client";
import dynamic from "next/dynamic";
import { useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  MapPin,
  Plus,
  Search,
  UserRound,
  Users,
  Wallet,
  X,
} from "lucide-react";
import type { PublicClassCatalog } from "./classes/types";
import {
  availability,
  conflicts,
  filterClasses,
  MAX_SAVED,
  scheduleSlots,
  STORAGE_KEY,
  storedIds,
  validIds,
} from "./classes/helpers";
import { PublicDialog } from "./classes/public-dialog";
import { WeekGrid, WeeklyTimetable } from "./classes/weekly-timetable";
import styles from "./classes/public-classes.module.css";
const ClassDetail = dynamic(() => import("./classes/class-detail"), {
  loading: () => <p className={styles.loading}>일정을 불러오고 있습니다…</p>,
});
const eventName = "tips-public-state";
function subscribe(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener("storage", callback);
  window.addEventListener(eventName, callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener("storage", callback);
    window.removeEventListener(eventName, callback);
  };
}
function querySnapshot() {
  return window.location.search.slice(1);
}
function storageSnapshot() {
  try {
    return localStorage.getItem(STORAGE_KEY) || "[]";
  } catch {
    return "[]";
  }
}
export function PublicClassesView({
  catalog,
  initialQuery,
}: {
  catalog: PublicClassCatalog;
  initialQuery: string;
}) {
  const query = useSyncExternalStore(
    subscribe,
    querySnapshot,
    () => initialQuery,
  );
  const stored = useSyncExternalStore(subscribe, storageSnapshot, () => "[]");
  const params = new URLSearchParams(query);
  const known = catalog.classes.map((c) => c.id);
  const selectedIds = params.has("selected")
    ? validIds(params.get("selected"), known)
    : storedIds(stored, known);
  const selected = selectedIds.flatMap((id) =>
    catalog.classes.filter((c) => c.id === id),
  );
  const detailId = params.get("class") || "";
  const detailItem = catalog.classes.find((c) => c.id === detailId);
  const [timetableOpen, setTimetableOpen] = useState(false);
  const [limit, setLimit] = useState(10);
  const [notice, setNotice] = useState("");
  const [sort, setSort] = useState("name");
  const opener = useRef<HTMLElement | null>(null);
  const subjects = [
    ...new Set(catalog.classes.map((c) => c.subject).filter(Boolean)),
  ].sort(
    (a, b) =>
      ["영어", "수학", "과학"].indexOf(a) - ["영어", "수학", "과학"].indexOf(b),
  );
  const grades = [
    ...new Set(catalog.classes.map((c) => c.grade).filter(Boolean)),
  ].sort((a, b) => {
    const rank = (g: string) =>
      (g.startsWith("초")
        ? 0
        : g.startsWith("중")
          ? 10
          : g.startsWith("고")
            ? 20
            : 30) + Number(g.replace(/\D/g, "") || 0);
    return rank(a) - rank(b);
  });
  const filtered = filterClasses(catalog.classes, params).sort((a, b) =>
    sort === "seats"
      ? availability(b).remaining - availability(a).remaining
      : a.name.localeCompare(b.name, "ko"),
  );
  function update(values: Record<string, string>, push = false) {
    const next = new URL(window.location.href);
    Object.entries(values).forEach(([key, value]) => {
      if (value || key === "selected") next.searchParams.set(key, value);
      else next.searchParams.delete(key);
    });
    window.history[push ? "pushState" : "replaceState"](null, "", next);
    window.dispatchEvent(new Event(eventName));
  }
  function filter(key: string, value: string) {
    setLimit(10);
    update({ [key]: value });
  }
  function save(id: string) {
    if (!selectedIds.includes(id) && selectedIds.length >= MAX_SAVED) {
      setNotice(
        "시간표에는 최대 6개 수업을 담을 수 있습니다. 담은 수업을 먼저 빼 주세요.",
      );
      return;
    }
    const next = selectedIds.includes(id)
      ? selectedIds.filter((v) => v !== id)
      : [...selectedIds, id];
    const memorySaved = JSON.stringify(next);
    try {
      localStorage.setItem(STORAGE_KEY, memorySaved);
      setNotice(
        selectedIds.includes(id)
          ? "시간표에서 수업을 뺐습니다."
          : "내 시간표에 담았습니다.",
      );
    } catch {
      setNotice(
        "내 시간표에 반영했습니다. 이 브라우저에서는 새로고침 후 저장이 유지되지 않을 수 있습니다.",
      );
    }
    update({ selected: next.join(",") });
  }
  function openTimetable(event: React.MouseEvent<HTMLButtonElement>) {
    opener.current = event.currentTarget;
    setTimetableOpen(true);
  }
  const clashCount = conflicts(selected.flatMap(scheduleSlots)).length;
  return (
    <div className={styles.page}>
      <a href="#class-results" className={styles.skip}>
        수업 목록으로 건너뛰기
      </a>
      <header className={styles.header}>
        <a href="https://tipsedu.co.kr/" className={styles.brand}>
          <strong>TIPS</strong>
          <span>팁스 영어·수학학원</span>
        </a>
        <nav aria-label="주 메뉴">
          <a className={styles.homeLink} href="https://tipsedu.co.kr/">
            학원 소개
          </a>
          <button className={styles.outline} onClick={openTimetable}>
            내 시간표 <span className={styles.count}>{selected.length}</span>
          </button>
          <a
            className={styles.primary}
            href="https://tipsedu.channel.io/"
            target="_blank"
            rel="noreferrer"
          >
            상담하기
            <ArrowUpRight size={16} />
          </a>
        </nav>
      </header>
      <main className={styles.main}>
        <section className={styles.hero}>
          <h1>
            우리 아이에게 맞는
            <br />
            <span>수업을 찾아보세요.</span>
          </h1>
          <p>수업 일정부터 교재 진도까지, 한눈에.</p>
        </section>
        <section className={styles.filters} aria-label="수업 검색과 필터">
          <label className={styles.search}>
            <Search size={20} />
            <input
              aria-label="수업명, 선생님, 강의실 검색"
              placeholder="수업명, 선생님, 강의실 검색"
              value={(params.get("q") || "").slice(0, 100)}
              maxLength={100}
              onChange={(event) => filter("q", event.target.value)}
            />
            {params.get("q") && (
              <button
                aria-label="검색어 지우기"
                onClick={() => filter("q", "")}
              >
                <X size={17} />
              </button>
            )}
          </label>
          <div className={styles.filterGroup} role="group" aria-label="과목">
            <button
              aria-pressed={!params.get("subject")}
              onClick={() => filter("subject", "")}
            >
              전체
            </button>
            {subjects.map((subject) => (
              <button
                key={subject}
                aria-pressed={params.get("subject") === subject}
                onClick={() => filter("subject", subject)}
              >
                {subject}
              </button>
            ))}
          </div>
          <div
            className={`${styles.filterGroup} ${styles.gradeChips}`}
            role="group"
            aria-label="학년"
          >
            <button
              aria-pressed={!params.get("grade")}
              onClick={() => filter("grade", "")}
            >
              전체
            </button>
            {grades.map((grade) => (
              <button
                key={grade}
                aria-pressed={params.get("grade") === grade}
                onClick={() => filter("grade", grade)}
              >
                {grade}
              </button>
            ))}
          </div>
          <label className={styles.gradeSelect}>
            <span>학년</span>
            <select
              aria-label="학년"
              value={params.get("grade") || ""}
              onChange={(event) => filter("grade", event.target.value)}
            >
              <option value="">전체 학년</option>
              {grades.map((grade) => (
                <option key={grade}>{grade}</option>
              ))}
            </select>
          </label>
        </section>
        {catalog.availability === "snapshot" && (
          <p className={styles.warning}>
            최근 저장된 수업 정보입니다. 기준{" "}
            {catalog.generatedAt
              ? new Date(catalog.generatedAt).toLocaleString("ko-KR", {
                  timeZone: "Asia/Seoul",
                  hourCycle: "h23",
                })
              : ""}
            . 최신 모집 상태는 상담 시 확인해 주세요.
          </p>
        )}
        <div className={styles.columns}>
          <section className={styles.catalog} id="class-results" tabIndex={-1}>
            <div className={styles.listHeading}>
              <h2>
                {params.get("subject") || params.get("grade") || params.get("q")
                  ? "검색 결과"
                  : "전체 수업"}{" "}
                <span aria-live="polite" aria-atomic="true">
                  {filtered.length}
                </span>
              </h2>
              <select
                aria-label="수업 정렬"
                value={sort}
                onChange={(event) => setSort(event.target.value)}
              >
                <option value="name">수업명순</option>
                <option value="seats">잔여석순</option>
              </select>
            </div>
            {catalog.availability === "unavailable" ? (
              <div className={styles.empty} role="alert">
                <h3>수업 정보를 불러오지 못했습니다.</h3>
                <p>잠시 후 다시 시도해 주세요.</p>
                <button
                  className={styles.primary}
                  onClick={() => window.location.reload()}
                >
                  다시 불러오기
                </button>
              </div>
            ) : !filtered.length ? (
              <div className={styles.empty}>
                <Search size={30} />
                <h3>
                  {catalog.classes.length
                    ? "조건에 맞는 수업이 없습니다."
                    : "현재 공개된 수업이 없습니다."}
                </h3>
                <button
                  className={styles.outline}
                  onClick={() => {
                    setLimit(10);
                    update({ q: "", subject: "", grade: "" });
                  }}
                >
                  필터 초기화
                </button>
              </div>
            ) : (
              filtered.slice(0, limit).map((item) => {
                const status = availability(item);
                const saved = selectedIds.includes(item.id);
                return (
                  <article className={styles.course} key={item.id}>
                    <div className={styles.courseIdentity}>
                      <div className={styles.subjectLine}>
                        <span>{item.subject || "수업"}</span>
                        <span>{item.grade}</span>
                      </div>
                      <h3>{item.name}</h3>
                    </div>
                    <div className={styles.courseFacts}>
                      <p>
                        <CalendarDays />
                        <span>{item.schedule || "시간 협의"}</span>
                      </p>
                      <div>
                        <p>
                          <UserRound />
                          <span>{item.teacher || "선생님 문의"}</span>
                        </p>
                        <p>
                          <MapPin />
                          <span>
                            {item.room || item.classroom || "강의실 문의"}
                          </span>
                        </p>
                      </div>
                      <div>
                        <p>
                          <Users />
                          <span>
                            {item.capacity > 0
                              ? `${item.enrolledCount} / ${item.capacity}명`
                              : `수강 ${item.enrolledCount}명 · 정원 문의`}
                          </span>
                        </p>
                        <p>
                          <Wallet />
                          <strong>
                            {item.tuition > 0
                              ? `${item.tuition.toLocaleString("ko-KR")}원`
                              : "수강료 문의"}
                          </strong>
                        </p>
                      </div>
                    </div>
                    <div className={styles.courseActions}>
                      <span
                        className={`${styles.badge} ${styles[status.tone]}`}
                      >
                        {status.label}
                      </span>
                      <button
                        className={styles.detailButton}
                        aria-label={`${item.name} 자세히 보기`}
                        onClick={(event) => {
                          opener.current = event.currentTarget;
                          update({ class: item.id }, true);
                        }}
                      >
                        자세히 보기
                        <ChevronRight size={16} />
                      </button>
                    </div>
                    <button
                      className={`${styles.saveButton} ${saved ? styles.savedButton : ""}`}
                      aria-label={`${item.name} ${saved ? "시간표에서 빼기" : "시간표에 담기"}`}
                      aria-pressed={saved}
                      onClick={() => save(item.id)}
                    >
                      {saved ? <Check /> : <Plus />}
                      <span>{saved ? "담김" : "담기"}</span>
                    </button>
                  </article>
                );
              })
            )}
            {filtered.length > limit && (
              <button
                className={styles.more}
                onClick={() => setLimit((v) => v + 10)}
              >
                더 많은 수업 보기 <ChevronDown size={18} />
              </button>
            )}
          </section>
          <aside className={styles.rail} aria-label="내 시간표 미리보기">
            <h2>
              내 시간표 <span className={styles.count}>{selected.length}</span>
            </h2>
            {selected.length ? (
              <>
                <div className={styles.savedList}>
                  {selected.map((item, i) => (
                    <div className={styles.savedRow} key={item.id}>
                      <span
                        className={`${styles.colorMarker} ${styles[`color${i}`]}`}
                      >
                        {i + 1}
                      </span>
                      <div>
                        <strong>{item.name}</strong>
                        <p>{item.schedule || "시간 협의"}</p>
                      </div>
                      <button
                        className={styles.iconButton}
                        aria-label={`${item.name} 빼기`}
                        onClick={() => save(item.id)}
                      >
                        <X size={17} />
                      </button>
                    </div>
                  ))}
                </div>
                {clashCount > 0 && (
                  <p className={styles.warning}>
                    시간이 겹치는 수업 {clashCount}건 · 시간표에서 확인하세요.
                  </p>
                )}
                <WeekGrid classes={selected} compact />
              </>
            ) : (
              <div className={styles.railEmpty}>
                <CalendarDays size={34} strokeWidth={1.4} />
                <h3>관심 있는 수업을 담아 보세요.</h3>
                <p>
                  최대 6개 수업의 시간을
                  <br />
                  한눈에 비교할 수 있어요.
                </p>
                <div className={styles.emptyWeek} aria-hidden="true">
                  {["월", "화", "수", "목", "금"].map((day) => (
                    <span key={day}>{day}</span>
                  ))}
                </div>
              </div>
            )}
            <button className={styles.widePrimary} onClick={openTimetable}>
              시간표 크게 보기
              <ArrowUpRight size={18} />
            </button>
            <p className={styles.railNote}>수업은 상담 후 확정됩니다.</p>
          </aside>
        </div>
        <p className={styles.notice} role="status">
          {notice}
        </p>
        <footer className={styles.footer}>
          <strong>TIPS</strong>
          <span>팁스 영어·수학학원</span>
          <a
            href="https://tipsedu.channel.io/"
            target="_blank"
            rel="noreferrer"
          >
            상담 문의 ↗
          </a>
        </footer>
      </main>
      {detailId && (
        <PublicDialog
          title={detailItem?.name || "수업 상세"}
          description="날짜별 일정과 교재 진도를 확인하세요."
          onClose={() => update({ class: "" })}
          returnFocus={opener}
        >
          <ClassDetail
            key={detailId}
            id={detailId}
            saved={selectedIds.includes(detailId)}
            onSave={() => save(detailId)}
            canSave={Boolean(detailItem)}
          />
        </PublicDialog>
      )}
      {timetableOpen && (
        <PublicDialog
          title="내 시간표"
          description={`담은 수업 ${selected.length}개 · 최대 6개`}
          onClose={() => setTimetableOpen(false)}
          returnFocus={opener}
        >
          <WeeklyTimetable classes={selected} onRemove={save} />
        </PublicDialog>
      )}
    </div>
  );
}
