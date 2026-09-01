import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const ts = require("typescript");

async function loadTsxRuntime(relativePath, overrides = {}) {
  const fileName = new URL(relativePath, import.meta.url);
  const source = await readFile(fileName, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: fileName.pathname,
  }).outputText;
  const runtimeModule = { exports: {} };
  const runtimeRequire = (specifier) => (
    Object.prototype.hasOwnProperty.call(overrides, specifier)
      ? overrides[specifier]
      : require(specifier)
  );
  const factory = vm.runInThisContext(`(function(require, module, exports) {${output}\n})`, {
    filename: fileName.pathname,
  });
  factory(runtimeRequire, runtimeModule, runtimeModule.exports);
  return runtimeModule.exports;
}

function Label({ children, ...props }) {
  return createElement("label", props, children);
}

function withoutProps(input, names) {
  const output = { ...input };
  for (const name of names) delete output[name];
  return output;
}

function Input({ value, ...props }) {
  return createElement("input", {
    ...withoutProps(props, ["onChange"]),
    defaultValue: value,
  });
}

function Textarea({ value, ...props }) {
  return createElement("textarea", {
    ...withoutProps(props, ["onChange"]),
    defaultValue: value,
  });
}

function Button({ children, ...props }) {
  return createElement("button", withoutProps(props, ["onClick", "variant", "size"]), children);
}

function RegistrationSelect({
  value,
  options = [],
  ...props
}) {
  return createElement(
    "select",
    {
      ...withoutProps(props, ["onValueChange", "placeholder"]),
      defaultValue: value,
    },
    options.map((option) => createElement("option", { key: option.value, value: option.value }, option.label)),
  );
}

function DateTimePickerControl({
  dateAriaLabel,
  timeAriaLabel,
  ...props
}) {
  return createElement("div", {
    ...withoutProps(props, ["onChange", "timeOptions", "disablePortal", "value"]),
    "aria-label": `${dateAriaLabel} ${timeAriaLabel}`,
  });
}

function assertTextOrder(html, labels) {
  const visibleText = html.replace(/<[^>]+>/g, " ");
  let cursor = -1;
  for (const label of labels) {
    const next = visibleText.indexOf(label, cursor + 1);
    assert.ok(next > cursor, `${label} should follow the preceding field`);
    cursor = next;
  }
}

test("new registration inquiry fields follow the requested three-column reading order", async () => {
  const { RegistrationInquiryCommonFields } = await loadTsxRuntime(
    "../src/features/tasks/registration-application-inquiry-fields.tsx",
    {
      "@/components/ui/button": { Button },
      "@/components/ui/input": { Input },
      "@/components/ui/label": { Label },
      "@/components/ui/textarea": { Textarea },
      "./registration-school-options": {
        getRegistrationSchoolLevelFromGrade: (grade) => grade ? "middle" : null,
      },
      "./registration-workflow": {
        getRegistrationGradeOptions: () => ["초1", "중1", "고1"],
        isValidRegistrationMobilePhone: () => true,
      },
      "./registration-select": { RegistrationSelect },
    },
  );

  const html = renderToStaticMarkup(createElement(RegistrationInquiryCommonFields, {
    values: {
      studentName: "",
      schoolGrade: "중1",
      schoolName: "",
      parentPhone: "",
      studentPhone: "",
      inquiryAt: "2026-09-01T09:49:00Z",
      requestNote: "",
    },
    onChange: () => {},
  }));

  assertTextOrder(html, [
    "학생명",
    "학년",
    "학교",
    "학부모 전화",
    "학생 전화",
    "문의일시",
    "요청 사항",
  ]);
  assert.match(html, /data-common-field="school-name"/);
  assert.match(html, /data-common-field="inquiry-at"/);
  assert.match(html, /type="datetime-local"/);
  assert.match(html, /value="2026-09-01T18:49"/);
  assert.doesNotMatch(html, /\srequired=""/);
  assert.doesNotMatch(html, /문의일시 자동/);
});

const subjectOrder = ["영어", "수학", "과학"];
const initialPlanOverrides = {
  "@/components/ui/date-time-picker": { DateTimePickerControl },
  "@/components/ui/label": { Label },
  "@/components/ui/button": { Button },
  "./registration-intake-workflow": {
    getRegistrationInitialWorkflowParticipants: (draft, action) => subjectOrder.filter(
      (subject) => draft.subjectPlans[subject] === action,
    ),
    setRegistrationInitialSubjectAction: (draft) => draft,
  },
  "./registration-level-test-place.ts": {
    REGISTRATION_LEVEL_TEST_PLACES: ["본관", "별관"],
    normalizeRegistrationLevelTestPlace: (place) => place || null,
  },
  "./registration-select": { RegistrationSelect },
  "./registration-workflow": { REGISTRATION_TIME_OPTIONS: [] },
  "../../lib/academic-subject-registry.ts": {
    sortAcademicSubjects: (subjects) => subjectOrder.filter((subject) => subjects.includes(subject)),
  },
};

function initialPlanProps() {
  return {
    subjects: subjectOrder,
    draft: {
      subjectPlans: {
        "영어": "visit",
        "수학": "direct_phone",
        "과학": "inquiry",
      },
      levelTestScheduledAt: "",
      levelTestPlace: "",
      visitScheduledAt: "",
      visitPlace: "",
      directorOverrides: {},
    },
    resolvedDirectorIds: {},
    directorOptionsBySubject: {
      "영어": [{ value: "english-director", label: "영어 책임자" }],
      "수학": [{ value: "math-director", label: "수학 책임자" }],
      "과학": [{ value: "science-director", label: "과학 책임자" }],
    },
    disabled: false,
    onChange: () => {},
  };
}

test("new registration scheduling uses the requested visible labels", async () => {
  const {
    RegistrationInitialConsultationFields,
    RegistrationInitialLevelTestFields,
  } = await loadTsxRuntime(
    "../src/features/tasks/registration-initial-plan-control.tsx",
    initialPlanOverrides,
  );

  const levelTestHtml = renderToStaticMarkup(createElement(
    RegistrationInitialLevelTestFields,
    initialPlanProps(),
  ));
  const consultationHtml = renderToStaticMarkup(createElement(
    RegistrationInitialConsultationFields,
    initialPlanProps(),
  ));

  assert.match(levelTestHtml, />레벨테스트 예약일시</);
  assert.match(consultationHtml, />방문상담 예약일시</);
  assert.match(consultationHtml, />장소</);
  assert.doesNotMatch(consultationHtml, />방문상담일시</);
  assert.doesNotMatch(consultationHtml, />방문상담실</);
});

test("consultation controls preserve every selected inquiry subject column", async () => {
  const { RegistrationInitialConsultationFields } = await loadTsxRuntime(
    "../src/features/tasks/registration-initial-plan-control.tsx",
    initialPlanOverrides,
  );
  const html = renderToStaticMarkup(createElement(
    RegistrationInitialConsultationFields,
    initialPlanProps(),
  ));

  for (const row of ["mode", "director"]) {
    for (const subject of subjectOrder) {
      assert.match(
        html,
        new RegExp(`data-registration-consultation-slot="${row}:${subject}"`),
        `${row} should retain the ${subject} column`,
      );
    }
  }
  assert.match(html, />영어 상담 방식</);
  assert.match(html, />수학 상담 방식</);
  assert.match(html, />영어 상담 책임자</);
  assert.match(html, />수학 상담 책임자</);
  assert.doesNotMatch(html, />과학 상담 방식</);
  assert.doesNotMatch(html, />과학 상담 책임자</);
});

test("new registration shell hides the process stepper while detail mode can still render it", async () => {
  const { RegistrationApplicationShell } = await loadTsxRuntime(
    "../src/features/tasks/registration-application-shell.tsx",
    {
      "./registration-application-model": {
        isRegistrationApplicationSectionContentDisabled: () => false,
      },
    },
  );
  const state = { editable: true, current: true, lockReason: "" };
  const sectionStates = {
    inquiry: state,
    level_test: state,
    consultation: state,
    placement: state,
    admission: state,
  };
  const renderShell = (mode) => renderToStaticMarkup(createElement(RegistrationApplicationShell, {
    mode,
    studentName: "새 등록 신청",
    closeAction: createElement("button", null, "닫기"),
    progress: createElement("div", { "data-process-stepper": true }, "프로세스 스텝퍼"),
    sectionStates,
    inquiry: "문의 내용",
    levelTest: "레벨테스트 내용",
    consultation: "상담 내용",
    waiting: "대기 내용",
    registration: "등록 내용",
    admission: "입학 내용",
  }));

  assert.doesNotMatch(renderShell("create"), /data-process-stepper/);
  assert.match(renderShell("detail"), /data-process-stepper/);
});
