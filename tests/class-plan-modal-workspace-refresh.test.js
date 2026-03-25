import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const modalSource = readFileSync(
  join(process.cwd(), "src", "components", "ClassSchedulePlanModal.jsx"),
  "utf8",
);

const progressEditorSource = readFileSync(
  join(
    process.cwd(),
    "src",
    "components",
    "data-manager",
    "ClassScheduleProgressEditor.jsx",
  ),
  "utf8",
);

const plannerSource = readFileSync(
  join(
    process.cwd(),
    "src",
    "components",
    "data-manager",
    "ClassSchedulePlanner.jsx",
  ),
  "utf8",
);

const previewSource = readFileSync(
  join(process.cwd(), "src", "components", "ClassSchedulePlanPreview.jsx"),
  "utf8",
);

const plannerLibSource = readFileSync(
  join(process.cwd(), "src", "lib", "classSchedulePlanner.js"),
  "utf8",
);

const workspaceStyles = readFileSync(
  join(process.cwd(), "src", "index.css"),
  "utf8",
);

test("editable class plan modal uses a work-first desktop shell with a right rail", () => {
  assert.match(modalSource, /mode = "readonly"/);
  assert.match(modalSource, /mode === "builder"/);
  assert.match(modalSource, /mode === "checklist"/);
  assert.match(modalSource, /onSaveDraft/);
  assert.match(modalSource, /class-plan-builder-layout/);
  assert.match(modalSource, /class-plan-builder-preview/);
  assert.match(modalSource, /class-plan-desktop-save/);
  assert.match(workspaceStyles, /\.class-plan-builder-layout/);
  assert.match(workspaceStyles, /\.class-plan-desktop-save/);
});

test("editable desktop header surfaces class metadata and the legacy editable tabs are removed", () => {
  assert.match(modalSource, /class-plan-desktop-header-meta/);
  assert.match(modalSource, /class-plan-desktop-header-chip/);
  assert.match(modalSource, /class-plan-desktop-header-main-row/);
  assert.match(modalSource, /class-plan-builder-stepper/);
  assert.match(modalSource, /class-plan-builder-section/);
  assert.doesNotMatch(modalSource, /class-plan-editable-tabs/);
  assert.match(workspaceStyles, /\.class-plan-desktop-header-meta/);
  assert.match(workspaceStyles, /\.class-plan-desktop-header-chip/);
  assert.match(workspaceStyles, /\.class-plan-desktop-header-main-row/);
  assert.match(workspaceStyles, /\.class-plan-builder-stepper/);
  assert.match(workspaceStyles, /\.class-plan-builder-section/);
});

test("schedule planner can run as a controls-only builder section when the modal owns preview", () => {
  assert.match(plannerSource, /planner-controls-column/);
  assert.match(plannerSource, /showPreview = true/);
  assert.match(workspaceStyles, /\.planner-controls-column/);
  assert.match(workspaceStyles, /\.planner-preview-column/);
  assert.match(plannerSource, /!showPreview/);
  assert.match(plannerSource, /controlsLayout = "stack"/);
  assert.match(plannerSource, /controlsLayout === "split"/);
  assert.match(modalSource, /controlsLayout="split"/);
  assert.match(workspaceStyles, /\.planner-controls-column\.is-builder-split/);
  assert.match(workspaceStyles, /\.planner-top-grid\.is-controls-only/);
  assert.doesNotMatch(
    plannerSource,
    /if\s*\(\s*planner\.billingPeriods\.length <= 1\s*\)\s*\{\s*return;\s*\}/,
  );
});

test("progress editor supports a condensed plan-template mode and checklist mode is rendered separately", () => {
  assert.match(progressEditorSource, /activeSessionId/);
  assert.match(progressEditorSource, /class-plan-progress-session-nav/);
  assert.match(progressEditorSource, /class-plan-progress-session-detail/);
  assert.match(progressEditorSource, /compact = false/);
  assert.match(modalSource, /class-plan-checklist-editor/);
});

test("preview uses explicit day labels, month colors, and the updated legend copy", () => {
  assert.match(previewSource, /class-plan-day-label/);
  assert.match(previewSource, /class-plan-day-bubble/);
  assert.match(previewSource, /monthColor/);
  assert.match(
    previewSource,
    /session\.state === "active" \|\|\s*session\.state === "force_active" \|\|\s*session\.state === "makeup"/,
  );
  assert.doesNotMatch(previewSource, /key:\s*"days"/);
  assert.doesNotMatch(previewSource, /<span>\{group\.billingLabel\}<\/span>/);
  assert.match(workspaceStyles, /\.class-plan-day-label/);
  assert.match(workspaceStyles, /\.class-plan-day-bubble/);
  assert.match(workspaceStyles, /\.class-plan-day-cell\.is-filled \.class-plan-day-bubble/);
  assert.match(
    workspaceStyles,
    /\.class-plan-session-panel,\s*[\s\S]*\.class-plan-session-stack\s*\{[\s\S]*background:\s*transparent;/,
  );
  assert.match(
    workspaceStyles,
    /\.class-plan-session-group-header span\s*\{[\s\S]*display:\s*none;/,
  );
  assert.match(workspaceStyles, /\.class-plan-preview-badge\.is-makeup/);
  assert.match(workspaceStyles, /\.class-plan-day-label\s*\{[\s\S]*background:\s*none;/);
  assert.match(
    workspaceStyles,
    /\.class-plan-day-bubble\s*\{[\s\S]*width:\s*min\(100%,\s*52px\);[\s\S]*aspect-ratio:\s*1 \/ 1;[\s\S]*box-sizing:\s*border-box;/,
  );
  assert.match(
    workspaceStyles,
    /\.class-plan-day-cell\.is-current-month\s*\{[\s\S]*color:\s*var\(--class-plan-cell-idle-text,\s*#94a3b8\);/,
  );
  assert.match(plannerLibSource, /\\uBCF4\\uAC15|\uBCF4\uAC15/);
});

test("preview renders every session list as a unified vertical month stepper instead of split card and table layouts", () => {
  assert.match(previewSource, /function SessionVerticalStepper/);
  assert.match(previewSource, /class-plan-session-vertical-list/);
  assert.match(previewSource, /class-plan-session-vertical-group/);
  assert.match(previewSource, /class-plan-stepper-stem/);
  assert.match(previewSource, /class-plan-stepper-stem-fill/);
  assert.doesNotMatch(previewSource, /function SessionCards/);
  assert.doesNotMatch(previewSource, /function SessionTable/);
  assert.doesNotMatch(previewSource, /compact=\{false\}/);
  assert.match(workspaceStyles, /\.class-plan-session-vertical-list/);
  assert.match(workspaceStyles, /\.class-plan-session-vertical-group/);
  assert.match(previewSource, /hasSessionDetailContent/);
  assert.match(
    workspaceStyles,
    /\.class-plan-session-card\.class-plan-session-vertical-item\.has-detail/,
  );
  assert.match(
    workspaceStyles,
    /\.class-plan-stepper-stem\s*\{[\s\S]*width:\s*24px;[\s\S]*border-radius:\s*999px;/,
  );
  assert.match(
    workspaceStyles,
    /\.class-plan-session-group-track\s*\{[\s\S]*linear-gradient\(/,
  );
});

test("builder preview stays interactive and wires calendar toggle and drag substitution handlers", () => {
  assert.match(modalSource, /interactive=\{resolvedMode === "builder"\}/);
  assert.match(modalSource, /onToggleDate=\{handlePreviewCalendarToggle\}/);
  assert.match(modalSource, /onSubstitution=\{handlePreviewCalendarSubstitution\}/);
  assert.match(modalSource, /isMobile \? saveBar : null/);
  assert.match(plannerSource, /onToggleDate=\{handleCalendarToggle\}/);
  assert.match(plannerSource, /onSubstitution=\{handleSubstitution\}/);
  assert.match(
    workspaceStyles,
    /\.class-plan-builder-preview\s*\{[\s\S]*overflow-y:\s*auto;[\s\S]*overscroll-behavior:\s*contain;/,
  );
  assert.match(
    workspaceStyles,
    /\.class-plan-builder-preview\s+\.class-plan-preview-surface\s*\{[\s\S]*position:\s*static;/,
  );
  assert.match(
    workspaceStyles,
    /\.class-plan-builder-main\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;/,
  );
  assert.match(
    workspaceStyles,
    /\.class-plan-builder-main\s*>\s*\*\s*\{[\s\S]*flex-shrink:\s*0;/,
  );
});
