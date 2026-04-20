import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("admin manual page centralizes usage guidance in a dedicated route", () => {
  const source = read("v2/src/app/admin/manual/page.tsx");

  assert.match(source, /운영 화면 사용설명서/);
  assert.match(source, /사용설명서/);
  assert.match(source, /운영 화면 설명을 이 메뉴에만 모았습니다/);
  assert.match(source, /수업일정 워크스페이스/);
  assert.match(source, /커리큘럼 워크스페이스/);
  assert.match(source, /학생·수업·교재 관리/);
});

test("admin sidebar omits manual and external-check groups from the live nav", () => {
  const source = read("v2/src/lib/navigation.ts");

  assert.equal(source.includes('label: "사용설명"'), false);
  assert.equal(source.includes('label: "외부 확인"'), false);
  assert.equal(source.includes('items: [{ title: "사용설명서", url: "/admin/manual"'), false);
  assert.equal(source.includes('title: "수업 소개 확인",'), false);
});

test("dashboard no longer contains the old usage-order helper card", () => {
  const source = read("v2/src/app/admin/dashboard/page.tsx");

  assert.equal(source.includes("대시보드 사용 순서"), false);
  assert.equal(source.includes("먼저 수업일정에서"), false);
  assert.equal(source.includes("이어갈 수 있도록 정리했습니다"), false);
});

test("class schedule workspace removes inline usage guidance from operational panels", () => {
  const source = read("v2/src/features/operations/class-schedule-workspace.tsx");

  assert.equal(source.includes("그룹 카드를 누르면 해당 묶음만 다시 확인할 수 있습니다."), false);
  assert.equal(source.includes("다시 누르면 전체 목록으로 돌아갑니다."), false);
  assert.equal(source.includes("표나 동기 그룹 카드에서 반을 선택하면 실제 기록 메모와 진행 흐름을 바로 확인합니다."), false);
  assert.equal(source.includes("표에서 반을 선택해 세부 현황을 확인하세요."), false);
  assert.match(source, /선택 중인 반의 실제 기록과 진행 데이터를 요약합니다/);
  assert.match(source, /선택 중인 반이 없습니다/);
});

test("curriculum workspace removes inline usage guidance from operational panels", () => {
  const source = read("v2/src/features/academic/curriculum-workspace.tsx");

  assert.equal(source.includes("업데이트 대기 회차를 우선 확인하세요."), false);
  assert.equal(source.includes("표나 우선 점검 카드에서 반을 선택하면 바로 세부 현황을 확인합니다."), false);
  assert.equal(source.includes("표에서 반을 선택해 세부 현황을 확인하세요."), false);
  assert.equal(source.includes("선택 중인 반의 계획·진도 데이터를 요약합니다"), false);
  assert.equal(source.includes("선택 중인 반이 없습니다"), false);
});

test("timetable workspace keeps empty-state and view copy descriptive instead of instructional", () => {
  const source = read("v2/src/features/academic/timetable-workspace.tsx");

  assert.equal(source.includes("강의실 점유 상태와 충돌을 빠르게 확인합니다."), false);
  assert.equal(source.includes("요일별로 교사 축을 펼쳐 당일 운영을 점검합니다."), false);
  assert.equal(source.includes("요일별 강의실 회전과 공실을 함께 확인합니다."), false);
  assert.equal(source.includes("학기, 과목, 대상 선택을 조정해 보세요."), false);
  assert.match(source, /강의실 점유 상태와 충돌 현황을 같은 축에서 비교합니다/);
  assert.match(source, /학기, 과목, 대상 선택 결과가 비어 있습니다/);
});

test("academic calendar surfaces keep edit-state copy descriptive instead of instructive", () => {
  const workspaceSource = read("v2/src/features/operations/academic-calendar-workspace.tsx");
  const editorSource = read("v2/src/features/operations/academic-event-editor-sheet.tsx");

  assert.equal(workspaceSource.includes("실제 일정 데이터를 입력하면 이 화면은 자동으로 라이브 데이터로 전환됩니다."), false);
  assert.equal(workspaceSource.includes("운영 권한 계정에서 사용할 수 있습니다."), false);
  assert.match(workspaceSource, /현재는 TIPS 기본 일정 세트가 표시되고 있습니다/);
  assert.match(workspaceSource, /학사일정 조회 전용 상태입니다/);

  assert.equal(editorSource.includes("먼저 학교 정보를 확인해 주세요."), false);
  assert.equal(editorSource.includes("한 번에 수정할 수 있습니다."), false);
  assert.equal(editorSource.includes("안내 포인트를 적어 두세요."), false);
  assert.match(editorSource, /같은 시트에서 편집합니다/);
  assert.match(editorSource, /현재는 새 일정을 저장할 수 없습니다/);
  assert.match(editorSource, /운영 메모, 범위, 준비물, 공지 항목/);
});
