import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const outDir = path.resolve("docs/design/target-ui");
const screenDir = path.join(outDir, "screens");
const researchDir = path.resolve(".lazyweb/design-research/tips-dashboard-admin-ui-2026-05-05");

const W = 1600;
const H = 960;
const sidebarW = 248;
const topH = 68;
const margin = 28;
const contentX = sidebarW + margin;
const contentY = topH + margin;
const contentW = W - sidebarW - margin * 2;
const contentH = H - topH - margin * 2;

const colors = {
  bg: "#f7f8fb",
  sidebar: "#fbfbfc",
  surface: "#ffffff",
  surface2: "#f4f6f8",
  line: "#dde2ea",
  line2: "#edf0f4",
  text: "#111827",
  muted: "#657282",
  faint: "#9aa4b2",
  primary: "#2563eb",
  primarySoft: "#eaf1ff",
  green: "#047857",
  greenSoft: "#dcfce7",
  amber: "#b45309",
  amberSoft: "#fef3c7",
  red: "#be123c",
  redSoft: "#ffe4e6",
  teal: "#0f766e",
  tealSoft: "#dff7f4",
  violet: "#6d28d9",
  violetSoft: "#ede9fe",
};

const navGroups = [
  ["운영", ["대시보드", "학사일정", "시간표"]],
  ["관리", ["수업계획", "학생관리", "수업관리", "교재관리"]],
  ["설정", ["환경설정"]],
];

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function attrs(values) {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([key, value]) => `${key}="${esc(value)}"`)
    .join(" ");
}

function el(name, values = {}, children = "") {
  return `<${name} ${attrs(values)}>${children}</${name}>`;
}

function rect(x, y, width, height, fill = colors.surface, stroke = colors.line, radius = 12, extra = {}) {
  return `<rect ${attrs({ x, y, width, height, rx: radius, fill, stroke, ...extra })}/>`;
}

function line(x1, y1, x2, y2, stroke = colors.line, width = 1) {
  return `<line ${attrs({ x1, y1, x2, y2, stroke, "stroke-width": width })}/>`;
}

function text(value, x, y, size = 14, fill = colors.text, weight = 500, extra = {}) {
  return el("text", { x, y, fill, "font-size": size, "font-weight": weight, ...extra }, esc(value));
}

function pill(label, x, y, fill = colors.surface2, stroke = colors.line, textColor = colors.text, width) {
  const w = width || Math.max(68, label.length * 12 + 30);
  return [
    rect(x, y, w, 34, fill, stroke, 10),
    text(label, x + 15, y + 22, 13, textColor, 650),
  ].join("");
}

function button(label, x, y, width = 112, variant = "default") {
  const primary = variant === "primary";
  return [
    rect(x, y, width, 38, primary ? colors.primary : colors.surface, primary ? colors.primary : colors.line, 10),
    text(label, x + width / 2, y + 24, 14, primary ? "#fff" : colors.text, 700, { "text-anchor": "middle" }),
  ].join("");
}

function tinyDot(x, y, fill) {
  return `<circle ${attrs({ cx: x, cy: y, r: 4, fill })}/>`;
}

function metric(label, value, x, y, width = 210, accent = colors.primary) {
  return [
    rect(x, y, width, 74, colors.surface, colors.line, 14),
    text(label, x + 18, y + 27, 13, colors.muted, 600),
    text(value, x + 18, y + 56, 24, colors.text, 750),
    rect(x + width - 8, y + 14, 4, 46, accent, "none", 2),
  ].join("");
}

function toolbar(x, y, width, tabs = [], action = "추가") {
  const tabMarkup = tabs.map((tab, index) => {
    const active = index === 0;
    return pill(tab, x + 14 + index * 102, y + 13, active ? colors.primary : colors.surface, active ? colors.primary : colors.line, active ? "#fff" : colors.text, 92);
  }).join("");
  return [
    rect(x, y, width, 62, colors.surface, colors.line, 14),
    tabMarkup,
    button(action, x + width - 132, y + 12, 110, "primary"),
  ].join("");
}

function filterBar(x, y, width, search = "검색", chips = ["필터", "보기", "정렬"]) {
  const chipsMarkup = chips.map((chip, index) => pill(chip, x + width - 305 + index * 84, y + 11, colors.surface, colors.line, colors.text, 74)).join("");
  return [
    rect(x, y, width, 56, colors.surface, colors.line, 14),
    `<circle ${attrs({ cx: x + 26, cy: y + 28, r: 7, fill: "none", stroke: colors.faint, "stroke-width": 2 })}/>` +
      line(x + 31, y + 33, x + 38, y + 40, colors.faint, 2),
    text(search, x + 52, y + 34, 14, colors.muted, 500),
    chipsMarkup,
  ].join("");
}

function table(x, y, width, columns, rows, options = {}) {
  const rowH = options.rowH || 52;
  const headerH = 42;
  const totalH = headerH + rows.length * rowH;
  const colWidths = columns.map((col) => col.w || Math.floor(width / columns.length));
  let cx = x;
  const header = columns.map((col, index) => {
    const mark = text(col.label, cx + 12, y + 27, 12, colors.muted, 700);
    cx += colWidths[index];
    return mark;
  }).join("");
  const verticals = colWidths.slice(0, -1).reduce((acc, w) => {
    const prev = acc.pos + w;
    acc.markup += line(prev, y, prev, y + totalH, colors.line2);
    acc.pos = prev;
    return acc;
  }, { markup: "", pos: x }).markup;
  const rowMarkup = rows.map((row, rowIndex) => {
    const ry = y + headerH + rowIndex * rowH;
    let tx = x;
    const fill = rowIndex % 2 === 0 ? colors.surface : "#fbfcfd";
    const cells = row.map((cell, colIndex) => {
      const value = typeof cell === "object" ? cell.value : cell;
      const cFill = typeof cell === "object" ? cell.color || colors.text : colors.text;
      const weight = typeof cell === "object" ? cell.weight || 550 : 550;
      const size = typeof cell === "object" ? cell.size || 13 : 13;
      const align = columns[colIndex]?.align || "left";
      const txPos = align === "right" ? tx + colWidths[colIndex] - 12 : tx + 12;
      const anchor = align === "right" ? "end" : "start";
      const cellText = text(value, txPos, ry + rowH / 2 + 5, size, cFill, weight, { "text-anchor": anchor });
      tx += colWidths[colIndex];
      return cellText;
    }).join("");
    return rect(x, ry, width, rowH, fill, colors.line2, 0) + cells;
  }).join("");
  return [
    rect(x, y, width, totalH, colors.surface, colors.line, 14),
    rect(x, y, width, headerH, "#fafbfc", "none", 14),
    line(x, y + headerH, x + width, y + headerH, colors.line),
    verticals,
    header,
    rowMarkup,
  ].join("");
}

function sidebar(active) {
  let y = 98;
  const groups = navGroups.map(([group, items]) => {
    const header = text(group, 24, y, 12, colors.faint, 800);
    y += 20;
    const rows = items.map((item) => {
      const selected = item === active || (active === "수업설계" && item === "수업계획") || (active === "환경설정" && item === "환경설정");
      const row = [
        selected ? rect(16, y - 20, sidebarW - 32, 34, colors.primarySoft, "none", 10) : "",
        rect(28, y - 9, 14, 14, selected ? colors.primary : colors.line, "none", 4),
        text(item, 54, y + 3, 14, selected ? colors.primary : colors.text, selected ? 800 : 600),
      ].join("");
      y += 40;
      return row;
    }).join("");
    y += 20;
    return header + rows;
  }).join("");

  return [
    rect(0, 0, sidebarW, H, colors.sidebar, "none", 0),
    line(sidebarW, 0, sidebarW, H, colors.line),
    rect(24, 24, 36, 36, colors.surface, colors.line, 10),
    text("T", 36, 48, 18, colors.primary, 850),
    text("TIPS Dashboard", 72, 38, 15, colors.text, 800),
    text("운영 포털", 72, 57, 12, colors.muted, 600),
    groups,
    rect(18, H - 74, sidebarW - 36, 50, colors.surface, colors.line, 14),
    text("임현준", 62, H - 44, 14, colors.text, 750),
    text("yeoyuasset", 62, H - 27, 11, colors.muted, 500),
    rect(32, H - 58, 24, 24, colors.primarySoft, "none", 99),
  ].join("");
}

function header(section, title) {
  return [
    rect(sidebarW, 0, W - sidebarW, topH, colors.surface, "none", 0),
    line(sidebarW, topH, W, topH, colors.line),
    text(section, contentX, 43, 13, colors.muted, 650),
    text("/", contentX + 45, 43, 13, colors.faint, 500),
    text(title, contentX + 64, 43, 18, colors.text, 850),
    button("홈페이지 확인", W - 470, 20, 130, "outline"),
    rect(W - 318, 20, 228, 36, colors.surface, colors.line, 9),
    text("빠른 이동", W - 268, 43, 13, colors.muted, 650),
    rect(W - 78, 20, 36, 36, colors.surface, colors.line, 9),
  ].join("");
}

function shell({ active, section, title, content }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#111827" flood-opacity="0.08"/>
    </filter>
    <linearGradient id="coolWash" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#f8fbff"/>
      <stop offset="1" stop-color="#f4f6f8"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="${colors.bg}"/>
  ${sidebar(active)}
  ${header(section, title)}
  ${content}
</svg>`;
}

function dashboardScreen() {
  const x = contentX;
  const y = contentY;
  const w = contentW;
  return shell({
    active: "대시보드",
    section: "운영",
    title: "대시보드",
    content: [
      text("오늘 할 일", x, y + 8, 26, colors.text, 850),
      text("관리팀이 지금 처리해야 하는 항목만 남긴 운영 홈", x, y + 34, 14, colors.muted, 550),
      metric("교재 요청", "5", x, y + 64, 210, colors.primary),
      metric("수업계획 미완료", "13", x + 226, y + 64, 230, colors.violet),
      metric("재고 실사", "62", x + 472, y + 64, 210, colors.amber),
      metric("오늘 수업", "18", x + 698, y + 64, 210, colors.teal),
      rect(x, y + 170, 840, 330, colors.surface, colors.line, 18, { filter: "url(#shadow)" }),
      text("우선 처리", x + 24, y + 204, 18, colors.text, 800),
      table(x + 20, y + 226, 800, [
        { label: "업무", w: 260 },
        { label: "대상", w: 300 },
        { label: "기한", w: 110 },
        { label: "상태", w: 130 },
      ], [
        ["교재 미등록 요청", "문제로마스터하는 중학영문법", "오늘", { value: "검토", color: colors.amber, weight: 800 }],
        ["수업 진도 미배정", "고3 모고반 · 6월 5회", "오늘", { value: "배정", color: colors.primary, weight: 800 }],
        ["재고 실사", "본관 영어 교재 237종", "이번주", { value: "진행", color: colors.teal, weight: 800 }],
        ["학생 상태 확인", "퇴원 처리 대기 3명", "내일", { value: "확인", color: colors.muted, weight: 800 }],
      ], { rowH: 56 }),
      rect(x + 872, y + 170, w - 872, 330, colors.surface, colors.line, 18, { filter: "url(#shadow)" }),
      text("운영 흐름", x + 896, y + 204, 18, colors.text, 800),
      ...["요청", "주문", "입고", "출고", "정산"].map((label, index) => {
        const cx = x + 928 + index * 104;
        return [
          `<circle ${attrs({ cx, cy: y + 280, r: 28, fill: index < 2 ? colors.primary : colors.surface2, stroke: index < 2 ? colors.primary : colors.line })}/>`,
          text(label, cx, y + 286, 13, index < 2 ? "#fff" : colors.muted, 800, { "text-anchor": "middle" }),
          index < 4 ? line(cx + 28, y + 280, cx + 76, y + 280, colors.line, 2) : "",
        ].join("");
      }),
      table(x, y + 532, w, [
        { label: "최근 이벤트", w: 310 },
        { label: "연결", w: 330 },
        { label: "담당", w: 150 },
        { label: "다음 행동", w: 240 },
        { label: "시간", w: 160 },
      ], [
        ["출고 대기 생성", "고3 모고반 · 테스트 교재", "관리팀", "재고 확인", "10분 전"],
        ["교재 요청 접수", "고1 영어 · 직접 입력", "영어팀", "마스터 검토", "18분 전"],
        ["수업계획 저장", "강부희 · 5월 진도", "수학팀", "교재 범위 배정", "42분 전"],
        ["학생 상태 변경", "차예은 · 재원", "관리팀", "이력 확인", "1시간 전"],
      ], { rowH: 58 }),
    ].join(""),
  });
}

function academicCalendarScreen() {
  const x = contentX;
  const y = contentY;
  const w = contentW;
  const monthX = x + 34;
  const monthY = y + 150;
  const cell = 84;
  const calendar = Array.from({ length: 35 }, (_, i) => {
    const col = i % 7;
    const row = Math.floor(i / 7);
    const d = i - 1;
    const isEvent = [5, 8, 14, 17, 23].includes(d);
    const isExam = [18, 19, 20].includes(d);
    return [
      rect(monthX + col * cell, monthY + row * 72, cell - 6, 66, isExam ? colors.redSoft : isEvent ? colors.primarySoft : colors.surface, colors.line, 14),
      text(d > 0 ? `${d}` : `${30 + i}`, monthX + col * cell + 12, monthY + row * 72 + 22, 12, d > 0 ? colors.text : colors.faint, 700),
      isEvent ? text(isExam ? "기말" : "특강", monthX + col * cell + 38, monthY + row * 72 + 42, 12, isExam ? colors.red : colors.primary, 800, { "text-anchor": "middle" }) : "",
    ].join("");
  }).join("");
  return shell({
    active: "학사일정",
    section: "운영",
    title: "학사일정",
    content: [
      toolbar(x, y, w, ["월", "연간", "시험", "휴강"], "일정 추가"),
      rect(x, y + 92, 760, 600, colors.surface, colors.line, 18, { filter: "url(#shadow)" }),
      text("2026년 6월", x + 32, y + 132, 24, colors.text, 850),
      ["일", "월", "화", "수", "목", "금", "토"].map((d, i) => text(d, monthX + i * cell + 38, monthY - 18, 12, colors.muted, 800, { "text-anchor": "middle" })).join(""),
      calendar,
      rect(x + 792, y + 92, w - 792, 600, colors.surface, colors.line, 18, { filter: "url(#shadow)" }),
      text("연간 보드", x + 824, y + 132, 24, colors.text, 850),
      ...["1학기", "여름", "2학기", "겨울"].map((label, i) => {
        const yy = y + 170 + i * 118;
        return [
          text(label, x + 824, yy, 15, colors.text, 800),
          rect(x + 900, yy - 20, 450, 42, i === 1 ? colors.primarySoft : colors.surface2, colors.line, 12),
          text(i === 1 ? "방학 특강 · 교재 입고 집중" : "시험 · 휴강 · 보강 일정", x + 918, yy + 6, 13, i === 1 ? colors.primary : colors.muted, 700),
        ].join("");
      }),
    ].join(""),
  });
}

function timetableScreen() {
  const x = contentX;
  const y = contentY;
  const w = contentW;
  const gridX = x + 24;
  const gridY = y + 144;
  const hourH = 74;
  const dayW = 160;
  const days = ["월", "화", "수", "목", "금", "토"];
  const blocks = [
    [0, 0, 2, "고1 공통수학", colors.teal],
    [1, 1, 2, "고3 모고반", colors.primary],
    [2, 0, 2, "중2 내신", colors.violet],
    [3, 2, 2, "고2 영어", colors.amber],
    [4, 1, 2, "고1 영어", colors.primary],
    [5, 0, 3, "주말 특강", colors.green],
  ];
  return shell({
    active: "시간표",
    section: "운영",
    title: "시간표",
    content: [
      filterBar(x, y, w, "선생님, 강의실, 수업명 검색", ["이번주", "본관", "영어"]),
      rect(x, y + 82, 1040, 700, colors.surface, colors.line, 18, { filter: "url(#shadow)" }),
      ...days.map((day, i) => text(day, gridX + 90 + i * dayW, gridY - 26, 13, colors.muted, 800, { "text-anchor": "middle" })),
      ...Array.from({ length: 8 }, (_, i) => [
        text(`${14 + i}:00`, gridX, gridY + i * hourH + 22, 12, colors.faint, 700),
        line(gridX + 52, gridY + i * hourH, gridX + 1010, gridY + i * hourH, colors.line2),
      ].join("")).join(""),
      ...Array.from({ length: 7 }, (_, i) => line(gridX + 52 + i * dayW, gridY - 44, gridX + 52 + i * dayW, gridY + 592, colors.line2)).join(""),
      ...blocks.map(([day, slot, span, label, color]) => [
        rect(gridX + 60 + day * dayW, gridY + 8 + slot * hourH, dayW - 16, span * hourH - 14, `${color}18`, color, 16),
        text(label, gridX + 76 + day * dayW, gridY + 38 + slot * hourH, 14, color, 850),
        text("강의실 · 선생님", gridX + 76 + day * dayW, gridY + 62 + slot * hourH, 12, colors.muted, 650),
      ].join("")).join(""),
      rect(x + 1070, y + 82, w - 1070, 700, colors.surface, colors.line, 18, { filter: "url(#shadow)" }),
      text("충돌 점검", x + 1098, y + 122, 22, colors.text, 850),
      ...["강의실 중복 없음", "관리팀 제외됨", "보강 후보 3건", "빈 강의실 4칸"].map((item, i) => [
        rect(x + 1098, y + 162 + i * 64, w - 1130, 48, i === 2 ? colors.amberSoft : colors.surface2, colors.line, 12),
        text(item, x + 1118, y + 193 + i * 64, 14, i === 2 ? colors.amber : colors.text, 750),
      ].join("")),
    ].join(""),
  });
}

function curriculumScreen() {
  const x = contentX;
  const y = contentY;
  const w = contentW;
  return shell({
    active: "수업계획",
    section: "관리",
    title: "수업계획",
    content: [
      filterBar(x, y, w, "반명, 선생님, 교재 검색", ["학기", "과목", "상태"]),
      rect(x, y + 82, 360, 690, colors.surface, colors.line, 18, { filter: "url(#shadow)" }),
      text("반 목록", x + 24, y + 120, 22, colors.text, 850),
      ...["고1 공통수학2", "고3 모고반", "중2 내신", "고1 영어 내신", "중3 특강"].map((item, i) => [
        rect(x + 20, y + 150 + i * 82, 320, 66, i === 0 ? colors.primarySoft : colors.surface, i === 0 ? colors.primary : colors.line, 14),
        text(item, x + 38, y + 180 + i * 82, 15, colors.text, 800),
        text(i % 2 === 0 ? "진도 미완료" : "일정 완료", x + 38, y + 202 + i * 82, 12, i % 2 === 0 ? colors.amber : colors.teal, 700),
      ].join("")),
      rect(x + 388, y + 82, w - 388, 690, colors.surface, colors.line, 18, { filter: "url(#shadow)" }),
      text("고1 공통수학2", x + 420, y + 126, 24, colors.text, 850),
      button("수업설계 열기", x + w - 560, y + 100, 140, "primary"),
      table(x + 420, y + 168, w - 468, [
        { label: "월", w: 100 },
        { label: "회차", w: 110 },
        { label: "교재", w: 300 },
        { label: "진도", w: 360 },
        { label: "상태", w: 120 },
      ], [
        ["5월", "8회", "고3 내신 기말", "1단원-2단원 · 개념", { value: "미배정 5", color: colors.amber, weight: 800 }],
        ["6월", "5회", "고3 내신 기말", "3단원-4단원 · 실전", { value: "완료", color: colors.teal, weight: 800 }],
        ["7월", "8회", "모의고사 제본", "회차 자동 생성", { value: "검토", color: colors.primary, weight: 800 }],
      ], { rowH: 62 }),
      rect(x + 420, y + 430, w - 468, 230, "url(#coolWash)", colors.line, 18),
      text("계획 완성도", x + 448, y + 470, 18, colors.text, 800),
      rect(x + 448, y + 502, w - 524, 16, colors.line2, "none", 99),
      rect(x + 448, y + 502, 520, 16, colors.primary, "none", 99),
      text("일정 21회 · 진도 13/21 · 교재 2권", x + 448, y + 550, 16, colors.text, 750),
    ].join(""),
  });
}

function lessonDesignScreen() {
  const x = contentX;
  const y = contentY;
  const w = contentW;
  const listX = x;
  const boardX = x + 518;
  return shell({
    active: "수업설계",
    section: "수업계획",
    title: "수업설계",
    content: [
      toolbar(x, y, w, ["일정 생성", "진도 생성"], "저장"),
      rect(listX, y + 88, 486, 690, colors.surface, colors.line, 18, { filter: "url(#shadow)" }),
      text("회차 목록", listX + 24, y + 128, 22, colors.text, 850),
      ...["5월 8회", "6월 5회", "7월 8회"].map((label, i) => [
        pill(label, listX + 24 + i * 88, y + 148, i === 0 ? colors.primary : colors.surface, i === 0 ? colors.primary : colors.line, i === 0 ? "#fff" : colors.text, 78),
      ].join("")),
      ...Array.from({ length: 8 }, (_, i) => [
        rect(listX + 24, y + 198 + i * 64, 438, 54, i === 1 ? colors.primarySoft : colors.surface, i === 1 ? colors.primary : colors.line2, 14),
        text(`${i + 1}회차`, listX + 44, y + 230 + i * 64, 15, colors.text, 800),
        text(`2026.05.${String(4 + i).padStart(2, "0")}`, listX + 118, y + 230 + i * 64, 12, colors.muted, 650),
        pill(i < 3 ? "0/2권" : "2/2권", listX + 378, y + 209 + i * 64, i < 3 ? colors.amberSoft : colors.tealSoft, i < 3 ? colors.amber : colors.teal, i < 3 ? colors.amber : colors.teal, 70),
      ].join("")).join(""),
      rect(boardX, y + 88, w - 518, 690, colors.surface, colors.line, 18, { filter: "url(#shadow)" }),
      text("2회차 진도", boardX + 28, y + 132, 24, colors.text, 850),
      button("이전", boardX + w - 840, y + 106, 76),
      button("다음", boardX + w - 752, y + 106, 76),
      rect(boardX + 28, y + 172, w - 574, 138, colors.primarySoft, colors.primary, 18),
      text("고3 내신 기말", boardX + 56, y + 210, 18, colors.text, 850),
      text("주교재 · 4회차부터 8회차까지 사용", boardX + 56, y + 236, 13, colors.primary, 750),
      pill("1단원", boardX + 56, y + 256, colors.surface, colors.line, colors.text, 90),
      pill("2단원", boardX + 154, y + 256, colors.surface, colors.line, colors.text, 90),
      pill("개념", boardX + 252, y + 256, colors.surface, colors.line, colors.text, 86),
      table(boardX + 28, y + 344, w - 574, [
        { label: "교재", w: 270 },
        { label: "시작", w: 120 },
        { label: "종료", w: 120 },
        { label: "이번 회차", w: 250 },
        { label: "상태", w: 110 },
      ], [
        ["고3 내신 기말", "4회차", "8회차", "1단원-2단원 · 개념", { value: "입력", color: colors.primary, weight: 800 }],
        ["모의고사 제본", "6회차", "13회차", "기간 밖", { value: "대기", color: colors.muted, weight: 800 }],
        ["부교재 프린트", "1회차", "전체", "숙제 범위", { value: "완료", color: colors.teal, weight: 800 }],
      ], { rowH: 62 }),
    ].join(""),
  });
}

function studentsScreen() {
  const x = contentX;
  const y = contentY;
  const w = contentW;
  return shell({
    active: "학생관리",
    section: "관리",
    title: "학생관리",
    content: [
      filterBar(x, y, w, "학생명, 학교, 연락처 검색", ["재원", "학년", "수업"]),
      rect(x, y + 82, 850, 710, colors.surface, colors.line, 18, { filter: "url(#shadow)" }),
      table(x + 20, y + 106, 810, [
        { label: "상태", w: 90 },
        { label: "학생", w: 170 },
        { label: "학교", w: 170 },
        { label: "수업", w: 220 },
        { label: "교재", w: 110 },
        { label: "최근 이력", w: 150 },
      ], [
        [{ value: "재원", color: colors.teal, weight: 800 }, "조준혁", "고3", "고3 모고반", "2권", "출고 5/5"],
        [{ value: "재원", color: colors.teal, weight: 800 }, "차예은", "고3", "고3 모고반", "2권", "수강 등록"],
        [{ value: "퇴원", color: colors.muted, weight: 800 }, "이은석", "고2", "이전 수업", "4권", "퇴원 4/30"],
        [{ value: "재원", color: colors.teal, weight: 800 }, "전재원", "중3", "중3 내신", "1권", "교재 반품"],
      ], { rowH: 66 }),
      rect(x + 878, y + 82, w - 878, 710, colors.surface, colors.line, 18, { filter: "url(#shadow)" }),
      text("학생 상세", x + 910, y + 126, 24, colors.text, 850),
      text("조준혁 · 재원", x + 910, y + 158, 14, colors.muted, 650),
      ...["수강 등록 · 고3 모고반", "교재 출고 · 테스트", "진도 배정 · 2회차", "상태 유지 · 재원"].map((item, i) => [
        tinyDot(x + 924, y + 216 + i * 74, i < 2 ? colors.primary : colors.line),
        line(x + 924, y + 224 + i * 74, x + 924, y + 282 + i * 74, colors.line),
        text(item, x + 950, y + 222 + i * 74, 15, colors.text, 760),
        text("학생-수업-교재 이력", x + 950, y + 244 + i * 74, 12, colors.muted, 600),
      ].join("")),
    ].join(""),
  });
}

function classesScreen() {
  const x = contentX;
  const y = contentY;
  const w = contentW;
  return shell({
    active: "수업관리",
    section: "관리",
    title: "수업관리",
    content: [
      toolbar(x, y, w, ["수강", "개강 준비", "종강"], "수업 추가"),
      filterBar(x, y + 76, w, "수업명, 선생님, 교재 검색", ["과목", "기간", "강의실"]),
      rect(x, y + 152, w, 620, colors.surface, colors.line, 18, { filter: "url(#shadow)" }),
      table(x + 20, y + 178, w - 40, [
        { label: "상태", w: 100 },
        { label: "수업", w: 250 },
        { label: "선생님", w: 160 },
        { label: "시간", w: 230 },
        { label: "학생", w: 120, align: "right" },
        { label: "교재", w: 240 },
        { label: "다음 행동", w: 220 },
      ], [
        [{ value: "수강", color: colors.teal, weight: 800 }, "고3 모고반", "강부희", "월화 18:00-20:00", "5명", "고3 내신 기말", "진도 배정"],
        [{ value: "수강", color: colors.teal, weight: 800 }, "고1 공통수학2", "양소윤", "금토 15:30-17:00", "7명", "공통수학2 2권", "일정 확인"],
        [{ value: "준비", color: colors.amber, weight: 800 }, "여름 특강", "김성은", "미정", "0명", "교재 미정", "개강 준비"],
        [{ value: "종강", color: colors.muted, weight: 800 }, "중2 내신", "김민경", "완료", "9명", "출고 완료", "이력 보기"],
      ], { rowH: 66 }),
    ].join(""),
  });
}

function textbooksScreen() {
  const x = contentX;
  const y = contentY;
  const w = contentW;
  return shell({
    active: "교재관리",
    section: "관리",
    title: "교재관리",
    content: [
      toolbar(x, y, w, ["마스터", "요청", "주문·입고", "출고", "재고", "정산"], "요청 추가"),
      rect(x, y + 76, w, 54, colors.surface, colors.line, 14),
      pill("대기 5", x + 14, y + 86, colors.primary, colors.primary, "#fff", 82),
      pill("미등록 요청 1", x + 104, y + 86, colors.surface, colors.line, colors.amber, 126),
      pill("출고 대기 2", x + 238, y + 86, colors.surface, colors.line, colors.teal, 112),
      filterBar(x, y + 146, w, "교재명, 수업, 학생, 요청자", ["필터", "일괄", "보기"]),
      rect(x, y + 222, w, 560, colors.surface, colors.line, 18, { filter: "url(#shadow)" }),
      text("주문·입고", x + 24, y + 262, 22, colors.text, 850),
      text("표시 1건 · 요청 1", x + 122, y + 262, 13, colors.muted, 650),
      table(x + 20, y + 292, w - 40, [
        { label: "진행", w: 110 },
        { label: "처리일시", w: 170 },
        { label: "요청자", w: 130 },
        { label: "교재명", w: 330 },
        { label: "위치", w: 90 },
        { label: "수업", w: 170 },
        { label: "요청", w: 80, align: "right" },
        { label: "판단", w: 150 },
        { label: "작업", w: 180 },
      ], [
        [{ value: "요청", color: colors.primary, weight: 800 }, "5.5 오후 09:59", "-", "문제로마스터하는 중학영문법", "본관", "수업 미지정", "1", { value: "마스터 등록", color: colors.amber, weight: 800 }, "검토"],
        [{ value: "주문", color: colors.violet, weight: 800 }, "5.5 오후 10:13", "양소윤", "일품 중등 수학 2-1", "본관", "고3 모고반", "6", { value: "적정", color: colors.teal, weight: 800 }, "입고"],
        [{ value: "출고", color: colors.teal, weight: 800 }, "5.5 오후 10:20", "관리팀", "테스트 교재", "본관", "고3 모고반", "5", { value: "부족 4", color: colors.red, weight: 800 }, "보류"],
      ], { rowH: 64 }),
    ].join(""),
  });
}

function settingsScreen() {
  const x = contentX;
  const y = contentY;
  const w = contentW;
  return shell({
    active: "환경설정",
    section: "설정",
    title: "교재 설정",
    content: [
      rect(x, y, w, 62, colors.surface, colors.line, 14),
      ["출판사 28", "총판 6", "세부과목 16"].map((tab, i) => pill(tab, x + 14 + i * 118, y + 14, i === 0 ? colors.primary : colors.surface, i === 0 ? colors.primary : colors.line, i === 0 ? "#fff" : colors.text, 106)).join(""),
      filterBar(x, y + 78, w, "출판사, 총판, 세부과목 검색", ["과목", "정렬", "저장"]),
      rect(x, y + 154, w, 618, colors.surface, colors.line, 18, { filter: "url(#shadow)" }),
      table(x + 20, y + 180, w - 40, [
        { label: "과목", w: 170 },
        { label: "출판사", w: 280 },
        { label: "연결 교재", w: 130, align: "right" },
        { label: "총판", w: 260 },
        { label: "상태", w: 120 },
        { label: "작업", w: 140 },
      ], [
        ["수학", "개념원리", "17종", "영주교육", { value: "사용", color: colors.teal, weight: 800 }, "수정"],
        ["영어, 수학", "능률", "54종", "영주교육", { value: "사용", color: colors.teal, weight: 800 }, "수정"],
        ["영어", "다락원", "0종", "대진서점", { value: "검토", color: colors.amber, weight: 800 }, "정리"],
        ["수학", "수경출판사", "13종", "영주교육", { value: "병합 완료", color: colors.primary, weight: 800 }, "이력"],
      ], { rowH: 66 }),
      rect(x + 930, y + 218, 300, 286, colors.primarySoft, colors.primary, 18),
      text("세부과목 순서", x + 958, y + 258, 20, colors.text, 850),
      ...["공통수학1", "공통수학2", "단어", "독해", "문법"].map((item, i) => [
        rect(x + 958, y + 284 + i * 40, 244, 30, colors.surface, colors.line, 8),
        text(`${i + 1}. ${item}`, x + 974, y + 304 + i * 40, 13, colors.text, 700),
      ].join("")),
    ].join(""),
  });
}

const screens = [
  { id: "01-dashboard", name: "대시보드", svg: dashboardScreen() },
  { id: "02-academic-calendar", name: "학사일정", svg: academicCalendarScreen() },
  { id: "03-timetable", name: "시간표", svg: timetableScreen() },
  { id: "04-curriculum", name: "수업계획", svg: curriculumScreen() },
  { id: "05-lesson-design", name: "수업설계", svg: lessonDesignScreen() },
  { id: "06-students", name: "학생관리", svg: studentsScreen() },
  { id: "07-classes", name: "수업관리", svg: classesScreen() },
  { id: "08-textbooks", name: "교재관리", svg: textbooksScreen() },
  { id: "09-textbook-settings", name: "교재 설정", svg: settingsScreen() },
];

function htmlIndex() {
  const cards = screens.map((screen) => `
    <article class="screen-card">
      <div class="screen-head">
        <span>${screen.id.replace("-", ". ")}</span>
        <strong>${screen.name}</strong>
      </div>
      <img src="screens/${screen.id}.svg" alt="${screen.name} 목표 화면" />
    </article>
  `).join("");
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TIPS Dashboard 목표 UI 보드</title>
  <style>
    :root { color-scheme: light; --bg:#f6f7f9; --text:#111827; --muted:#657282; --line:#dfe4ec; --blue:#2563eb; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font-family: "Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif; }
    main { max-width: 1680px; margin: 0 auto; padding: 48px 40px 72px; }
    header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-end; margin-bottom: 32px; }
    h1 { margin: 0; font-size: 32px; letter-spacing: -0.02em; }
    p { margin: 8px 0 0; color: var(--muted); }
    .principles { display: flex; gap: 8px; flex-wrap: wrap; }
    .principles span { border: 1px solid var(--line); background: #fff; border-radius: 999px; padding: 8px 12px; font-size: 13px; font-weight: 700; }
    .grid { display: grid; grid-template-columns: 1fr; gap: 28px; }
    .screen-card { background: #fff; border: 1px solid var(--line); border-radius: 24px; overflow: hidden; box-shadow: 0 24px 60px -36px rgba(15,23,42,.36); }
    .screen-head { height: 52px; display: flex; align-items: center; gap: 10px; padding: 0 18px; border-bottom: 1px solid var(--line); }
    .screen-head span { color: var(--blue); font-weight: 800; font-size: 13px; }
    .screen-head strong { font-size: 15px; }
    img { display: block; width: 100%; height: auto; background: #fff; }
    @media (min-width: 1200px) { .grid { grid-template-columns: 1fr 1fr; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>TIPS Dashboard 최종 목표 UI 보드</h1>
        <p>메뉴별 구현 기준 이미지. 같은 쉘, 다른 업무 표면, 최소한의 설명.</p>
      </div>
      <div class="principles">
        <span>Design is how it works</span>
        <span>Simplicity as precision</span>
        <span>One clear next action</span>
        <span>No unnecessary chrome</span>
      </div>
    </header>
    <section class="grid">${cards}</section>
  </main>
</body>
</html>`;
}

function targetBoardSvg() {
  const cardWidth = 980;
  const cardHeight = 720;
  const gap = 36;
  const margin = 72;
  const headerHeight = 168;
  const cols = 3;
  const rows = Math.ceil(screens.length / cols);
  const width = margin * 2 + cols * cardWidth + (cols - 1) * gap;
  const height = margin * 2 + headerHeight + rows * cardHeight + (rows - 1) * gap;
  const cards = screens.map((screen, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = margin + col * (cardWidth + gap);
    const y = margin + headerHeight + row * (cardHeight + gap);
    const imageHref = `data:image/svg+xml;base64,${Buffer.from(screen.svg, "utf8").toString("base64")}`;
    return `
      <g transform="translate(${x} ${y})">
        <rect width="${cardWidth}" height="${cardHeight}" rx="28" fill="#ffffff" stroke="#dfe4ec"/>
        <rect width="${cardWidth}" height="62" rx="28" fill="#ffffff"/>
        <rect y="34" width="${cardWidth}" height="28" fill="#ffffff"/>
        <line x1="0" y1="62" x2="${cardWidth}" y2="62" stroke="#dfe4ec"/>
        <text x="28" y="39" font-size="22" font-weight="800" fill="#2563eb">${screen.id}</text>
        <text x="250" y="39" font-size="22" font-weight="800" fill="#111827">${screen.name}</text>
        <image x="22" y="84" width="${cardWidth - 44}" height="${cardHeight - 110}" preserveAspectRatio="xMidYMid meet" href="${imageHref}"/>
      </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#f6f7f9"/>
  <text x="${margin}" y="${margin + 34}" font-size="44" font-weight="900" fill="#111827">TIPS Dashboard Target UI Blueprint</text>
  <text x="${margin}" y="${margin + 78}" font-size="22" font-weight="650" fill="#657282">Menu-level final-state screens for the admin dashboard implementation pass.</text>
  <g transform="translate(${margin} ${margin + 108})">
    <rect width="244" height="42" rx="21" fill="#ffffff" stroke="#dfe4ec"/>
    <text x="20" y="28" font-size="16" font-weight="800" fill="#111827">Design is how it works</text>
    <rect x="262" width="246" height="42" rx="21" fill="#ffffff" stroke="#dfe4ec"/>
    <text x="282" y="28" font-size="16" font-weight="800" fill="#111827">Simplicity as precision</text>
    <rect x="526" width="220" height="42" rx="21" fill="#ffffff" stroke="#dfe4ec"/>
    <text x="546" y="28" font-size="16" font-weight="800" fill="#111827">One clear next action</text>
    <rect x="764" width="236" height="42" rx="21" fill="#ffffff" stroke="#dfe4ec"/>
    <text x="784" y="28" font-size="16" font-weight="800" fill="#111827">No unnecessary chrome</text>
  </g>
  ${cards}
</svg>`;
}

function markdownReport() {
  const screenList = screens.map((screen) => `- [${screen.name}](screens/${screen.id}.svg)`).join("\n");
  return `# TIPS Dashboard 목표 UI 설계

## 목표

운영자가 매일 쓰는 학원 관리 대시보드를 “많은 기능을 설명하는 화면”이 아니라 “다음 행동이 보이는 업무 도구”로 수렴시킨다. 모든 메뉴는 같은 쉘, 같은 필터 언어, 같은 선택/일괄 처리 패턴을 공유한다.

## 디자인 시스템 원칙

1. 디자인은 외관이 아니라 작동 방식이다. 모든 색, 여백, 버튼, 테이블 열은 사용자의 다음 행동을 더 빠르게 만드는 근거가 있어야 한다.
2. 단순함은 궁극의 정교함이다. 화면을 비우는 것이 아니라 판단에 필요 없는 복잡함을 제거한다.
3. 미니멀리즘은 장식 축소가 아니라 업무 동선 정리다. 핵심 작업에 직접 기여하지 않는 버튼, 카드, 설명은 숨기거나 제거한다.
4. 직관성은 설명 없이 바로 쓰는 것이다. 사용자가 지금 무엇을 보고, 무엇을 선택했고, 다음에 무엇을 해야 하는지 화면 자체가 말해야 한다.
5. 데이터 화면은 예쁘기 전에 정확히 작동해야 한다. 검색, 필터, 선택, 일괄 처리, 저장 상태가 같은 문법으로 반복되어야 한다.

## 핵심 방향

1. 상단에는 하나의 주 작업만 남긴다. 보조 필터는 \`필터\`, \`보기\`, \`정렬\` 아래로 접는다.
2. 데이터가 많을 때는 카드가 아니라 그룹화된 데이터베이스를 기본으로 한다.
3. 그룹 헤더에는 개수와 합계만 두고, 그룹의 속성 열은 반복 표시하지 않는다.
4. 선택하면 상단/하단 액션바가 나타난다. 평소에는 일괄 버튼을 숨긴다.
5. 학생-수업-교재는 같은 이력 타임라인 언어로 연결한다.
6. PC는 넓은 표와 보조 패널, 모바일은 현장 입력 중심의 단일 열로 간다.

## 목표 이미지

${screenList}

## 참고한 디자인 패턴

- Apple Human Interface Guidelines: 리스트와 테이블은 텍스트 기반 정보를 빠르게 훑고, 선택 상태를 명확하게 보여주는 데 적합하다.
- Linear Filters: 필터를 화면 위에 계속 펼치지 않고 하나의 필터 버튼과 메뉴로 진입시킨다.
- Notion Database Grouping: 큰 데이터는 접고 펼칠 수 있는 그룹과 그룹 요약으로 이해시킨다.
- Shopify Polaris Index Table: 긴 리소스 목록은 필터, 정렬, 선택, 일괄 액션을 같은 패턴으로 묶는다.
- Airtable Views: 같은 데이터를 업무별 보기로 재구성한다.

## 구현 우선순위

1. 공통 쉘과 상단 작업바를 먼저 통일한다.
2. 교재관리와 수업계획의 데이터베이스형 그룹 테이블을 기준 컴포넌트로 만든다.
3. 학생관리/수업관리는 이력 패널을 붙여 관계형 기록을 보이게 한다.
4. 환경설정은 탭을 최상단으로 올리고 검색/추가/저장을 그 아래에 고정한다.
`;
}

function researchHtml() {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"/><title>TIPS Design Research</title><style>
body{font-family:system-ui,-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;line-height:1.65;margin:0;background:#f7f8fb;color:#111827}
main{max-width:900px;margin:auto;padding:48px 28px}h1{font-size:32px}h2{margin-top:40px}.callout{background:#eaf1ff;border:1px solid #bfdbfe;border-radius:16px;padding:18px}li{margin:8px 0}a{color:#2563eb}code{background:#eef2f7;padding:2px 6px;border-radius:6px}</style></head><body><main>
<h1>TIPS Dashboard Design Research</h1>
<div class="callout">최종 목표는 장식적인 대시보드가 아니라, 관리팀이 같은 화면에서 판단하고 처리할 수 있는 조용하고 빠른 운영 도구다.</div>
<h2>Recommendations</h2>
<ol>
<li>모든 메뉴의 필터는 하나의 필터 버튼 아래로 정리한다.</li>
<li>교재/학생/수업처럼 데이터가 많은 화면은 그룹화된 테이블을 기준으로 한다.</li>
<li>선택 전에는 일괄 액션을 숨기고, 선택 후에만 필요한 액션바를 띄운다.</li>
<li>관계형 기록은 오른쪽 이력 패널로 통일한다.</li>
<li>환경설정은 탭, 검색, 저장, 테이블의 순서로 고정한다.</li>
</ol>
<h2>References</h2>
<ul>
<li><a href="https://developer.apple.com/design/human-interface-guidelines/lists-and-tables">Apple HIG Lists and Tables</a></li>
<li><a href="https://linear.app/docs/filters">Linear Filters</a></li>
<li><a href="https://noteforms.com/notion-glossary/database-grouping">Notion Database Grouping summary</a></li>
<li><a href="https://polaris-react.shopify.com/components/tables/index-table?example=index-table-with-bulk-actions">Shopify Polaris Index Table</a></li>
<li><a href="https://blog.airtable.com/introduction-to-airtable-views/">Airtable Views</a></li>
</ul>
<p>목표 이미지는 <code>docs/design/target-ui/index.html</code>에서 확인한다.</p>
</main></body></html>`;
}

await mkdir(screenDir, { recursive: true });
await mkdir(path.join(researchDir, "references"), { recursive: true });

for (const screen of screens) {
  await writeFile(path.join(screenDir, `${screen.id}.svg`), screen.svg, "utf8");
}

await writeFile(path.join(outDir, "index.html"), htmlIndex(), "utf8");
await writeFile(path.join(outDir, "target-ui-board.svg"), targetBoardSvg(), "utf8");
await writeFile(path.join(outDir, "README.md"), markdownReport(), "utf8");
await writeFile(path.join(researchDir, "report.md"), markdownReport(), "utf8");
await writeFile(path.join(researchDir, "report.html"), researchHtml(), "utf8");

console.log(`Generated ${screens.length} target UI screens in ${outDir}`);
