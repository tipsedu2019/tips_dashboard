import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Clock3,
  MapPin,
  Pencil,
  Save,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import ClassSchedulePlanner from "./data-manager/ClassSchedulePlanner";
import ClassScheduleProgressEditor from "./data-manager/ClassScheduleProgressEditor";
import ClassScheduleChecklistEditor from "./data-manager/ClassScheduleChecklistEditor";
import ClassSchedulePlanPreview from "./ClassSchedulePlanPreview";
import ClassScheduleProgressBoard from "./ClassScheduleProgressBoard";
import TextbookQuickEditorModal from "./data-manager/TextbookQuickEditorModal";
import useViewport from "../hooks/useViewport";
import { PublicLandingCard } from "./PublicClassLandingView";
import BottomSheet from "./ui/BottomSheet";
import { Badge, Button, Dialog, SegmentedControl, TextField } from "./ui/tds";
import {
  applyCalendarDateSubstitution,
  applyCalendarDateToggle,
  SUBJECT_OPTIONS,
  buildSchedulePlanForSave,
  calculateSchedulePlan,
  normalizeSchedulePlan,
  parseDateValue,
} from "../lib/classSchedulePlanner";

function normalizeSummaryBadges(summaryBadges = []) {
  return (summaryBadges || [])
    .map((badge) =>
      typeof badge === "string" ? { label: badge, tone: "neutral" } : badge,
    )
    .filter((badge) => badge?.label);
}

function buildEnrollmentFact(classItem = {}) {
  const enrolledCount = Array.isArray(classItem.studentIds)
    ? classItem.studentIds.length
    : Number(classItem.enrolledCount ?? classItem.currentCount ?? 0);
  const capacity = Number(classItem.capacity) || 0;

  if (!enrolledCount && !capacity) {
    return null;
  }

  return {
    key: "enrollment",
    icon: Users,
    value:
      capacity > 0 ? `${enrolledCount}/${capacity}명` : `${enrolledCount}명`,
  };
}

function buildEditableStats(selectedTextbookCount, calculated) {
  const actualUpdatedSessions = (calculated?.sessions || []).filter(
    (session) => session.progressStatus !== "pending",
  ).length;

  return [
    { key: "textbooks", label: "연결 교재", value: `${selectedTextbookCount}권` },
    {
      key: "sessions",
      label: "생성 회차",
      value: `${(calculated?.sessions || []).length}회`,
    },
    { key: "actual", label: "실진도 입력", value: `${actualUpdatedSessions}회` },
  ];
}

function buildHeaderFacts(classItem = {}, editableStats = []) {
  const enrollmentFact = buildEnrollmentFact(classItem);

  return [
    { key: "schedule", icon: Clock3, value: classItem.schedule || "시간 미정" },
    { key: "teacher", icon: UserRound, value: classItem.teacher || "미정" },
    {
      key: "room",
      icon: MapPin,
      value: classItem.classroom || classItem.room || "미정",
    },
    enrollmentFact
      ? {
          key: enrollmentFact.key,
          icon: enrollmentFact.icon,
          value: enrollmentFact.value,
        }
      : null,
    ...editableStats.map((item) => ({
      key: item.key,
      value: `${item.label} ${item.value}`,
      className: "is-stat",
    })),
  ].filter(Boolean);
}

function buildSelectedTextbooks(textbookIds = [], textbooksCatalog = []) {
  return (textbookIds || [])
    .map((id) => (textbooksCatalog || []).find((item) => item.id === id))
    .filter(Boolean);
}

function hasPlanEntryContent(entry = {}) {
  return Boolean(entry.start || entry.end || entry.label || entry.memo);
}

function hasActualEntryContent(entry = {}) {
  return Boolean(
    entry.start ||
      entry.end ||
      entry.label ||
      entry.publicNote ||
      entry.teacherNote ||
      (entry.status && entry.status !== "pending"),
  );
}

function createDraftClass(classItem = {}) {
  return {
    subject: String(classItem.subject || "").trim() || SUBJECT_OPTIONS[0],
    className: String(
      classItem.displayClassName || classItem.className || classItem.name || "",
    ).trim(),
    textbookIds: [...new Set((classItem.textbookIds || []).filter(Boolean))],
  };
}

function buildPlanDefaults(
  classItem = {},
  draftClass = {},
  textbooksCatalog = [],
) {
  return {
    className: draftClass.className || classItem.className || classItem.name || "",
    subject: draftClass.subject || classItem.subject || "",
    schedule: classItem.schedule || "",
    startDate: classItem.startDate || "",
    endDate: classItem.endDate || "",
    textbookIds: draftClass.textbookIds || classItem.textbookIds || [],
    textbooks: textbooksCatalog,
  };
}

function buildStableSnapshot({ classPatch, schedulePlan, defaults }) {
  const savedPlan = buildSchedulePlanForSave(schedulePlan, {
    ...defaults,
    className: classPatch.className,
    subject: classPatch.subject,
    textbookIds: classPatch.textbookIds,
  });
  const { history, generatedAt, ...stablePlan } = savedPlan || {};
  return JSON.stringify({
    classPatch: {
      subject: classPatch.subject,
      className: classPatch.className,
      textbookIds: classPatch.textbookIds,
    },
    schedulePlan: stablePlan,
  });
}

function getValidationMessage(draftClass, calculated) {
  if (!String(draftClass.className || "").trim()) {
    return "공식 수업명을 입력해 주세요.";
  }
  if (!String(draftClass.subject || "").trim()) {
    return "과목을 선택해 주세요.";
  }
  if (!(calculated?.selectedDays || []).length) {
    return "수업 요일을 하나 이상 선택해 주세요.";
  }
  if (!(calculated?.billingPeriods || []).length) {
    return "기간을 하나 이상 만들어 주세요.";
  }

  const invalidPeriod = (calculated?.billingPeriods || []).find((period) => {
    const startDate = parseDateValue(period.startDate);
    const endDate = parseDateValue(period.endDate);
    return !startDate || !endDate || startDate > endDate;
  });
  if (invalidPeriod) {
    return "모든 기간의 시작일과 종료일을 올바르게 입력해 주세요.";
  }
  if ((calculated?.overlapIds || []).length > 0) {
    return "기간끼리 겹치는 구간을 정리한 뒤 저장해 주세요.";
  }
  if (!(calculated?.sessions || []).length) {
    return "회차가 아직 생성되지 않았습니다. 요일과 기간을 먼저 맞춰 주세요.";
  }
  return "";
}

function buildSubjectItems(currentSubject) {
  const options = SUBJECT_OPTIONS.includes(currentSubject)
    ? SUBJECT_OPTIONS
    : [...SUBJECT_OPTIONS, currentSubject].filter(Boolean);

  return options.map((subject) => ({
    value: subject,
    label: subject,
    ariaLabel: `${subject} 선택`,
  }));
}

function getStepState(steps, stepKey) {
  const stepIndex = steps.findIndex((step) => step.key === stepKey);
  const firstIncompleteIndex = steps.findIndex(
    (step) => !step.optional && !step.complete,
  );

  if (steps[stepIndex]?.complete) {
    return "done";
  }
  if (firstIncompleteIndex === -1 || stepIndex === firstIncompleteIndex) {
    return "current";
  }
  return "todo";
}

function getMobileChipToneClass(tone = "neutral") {
  if (tone === "warning") {
    return "is-warning";
  }
  if (tone === "danger") {
    return "is-danger";
  }
  if (tone === "accent" || tone === "blue" || tone === "primary") {
    return "is-accent";
  }
  return "is-neutral";
}

function BuilderStepper({ steps }) {
  return (
    <ol
      className="class-plan-builder-stepper"
      data-testid="class-plan-builder-stepper"
    >
      {steps.map((step, index) => (
        <li
          key={step.key}
          className={`class-plan-builder-step ${getStepState(steps, step.key)} ${step.optional ? "is-optional" : ""}`}
        >
          <span className="class-plan-builder-step-index">{index + 1}</span>
          <span className="class-plan-builder-step-copy">
            <strong>{step.label}</strong>
            <span>{step.description}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function BuilderSection({
  title,
  description,
  complete = false,
  optional = false,
  open = true,
  onToggle,
  testId,
  children,
}) {
  return (
    <section
      className={`class-plan-builder-section ${open ? "is-open" : "is-collapsed"}`}
      data-testid={testId}
    >
      <button
        type="button"
        className="class-plan-builder-section-head"
        onClick={onToggle}
      >
        <div className="class-plan-builder-section-copy">
          <div className="class-plan-builder-section-title-row">
            <strong>{title}</strong>
            {optional ? (
              <Badge size="small" type="gray" badgeStyle="weak">
                선택 사항
              </Badge>
            ) : null}
            {complete ? (
              <Badge size="small" type="blue" badgeStyle="weak">
                완료
              </Badge>
            ) : null}
          </div>
          <span>{description}</span>
        </div>
        {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>

      {open ? <div className="class-plan-builder-section-body">{children}</div> : null}
    </section>
  );
}

function ReviewCard({ label, value, tone = "default" }) {
  return (
    <div className={`class-plan-review-card is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function HeaderFactChip({ fact }) {
  const Icon = fact.icon;
  return (
    <span
      key={fact.key}
      className={`class-plan-desktop-header-chip ${fact.className || ""}`.trim()}
    >
      {Icon ? <Icon size={14} /> : null}
      <span>{fact.value}</span>
    </span>
  );
}

export default function ClassSchedulePlanModal({
  open,
  editable = false,
  mode = "readonly",
  classItem,
  plan,
  onPlanChange,
  onSubjectChange,
  onClassNameChange,
  onSaveDraft,
  onClose,
  emptyMessage = "아직 등록된 수업 계획이 없습니다.",
  warningBanner = null,
  primaryActionLabel = "",
  onPrimaryAction,
  secondaryActionLabel = "",
  onSecondaryAction,
  summaryBadges = [],
  textbooksCatalog = [],
  onTextbookIdsChange,
  onSaveTextbook,
  defaultEditableTab = "schedule",
}) {
  const { isMobile } = useViewport();
  const safeClass = classItem || {};
  const requestedBuilderMode = mode === "builder";
  const requestedChecklistMode = mode === "checklist";
  const resolvedMode = !editable
    ? "readonly"
    : requestedChecklistMode
      ? "checklist"
      : requestedBuilderMode
        ? "builder"
        : defaultEditableTab === "actual"
          ? "checklist"
          : "builder";
  const isReadonlyMode = resolvedMode === "readonly";
  const isBuilderMode = resolvedMode === "builder";
  const isChecklistMode = resolvedMode === "checklist";
  const isEditableMode = !isReadonlyMode;

  const [draftClass, setDraftClass] = useState(createDraftClass(safeClass));
  const [draftPlan, setDraftPlan] = useState(null);
  const [baselineSnapshot, setBaselineSnapshot] = useState("");
  const [textbookEditorState, setTextbookEditorState] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [expandedSections, setExpandedSections] = useState({
    settings: true,
    schedule: true,
    progress: true,
    textbooks: true,
    review: true,
  });

  useEffect(() => {
    if (!open) {
      setTextbookEditorState(null);
      setShowDiscardDialog(false);
      return;
    }

    const nextDraftClass = createDraftClass(safeClass);
    const nextDefaults = buildPlanDefaults(
      safeClass,
      nextDraftClass,
      textbooksCatalog,
    );
    const nextDraftPlan = normalizeSchedulePlan(plan, nextDefaults);
    const nextSnapshot = buildStableSnapshot({
      classPatch: nextDraftClass,
      schedulePlan: nextDraftPlan,
      defaults: nextDefaults,
    });

    setDraftClass(nextDraftClass);
    setDraftPlan(nextDraftPlan);
    setBaselineSnapshot(nextSnapshot);
    setExpandedSections({
      settings: true,
      schedule: true,
      progress: true,
      textbooks: true,
      review: true,
    });
  }, [open, plan, safeClass.id, textbooksCatalog]);

  const displayClassName =
    draftClass.className ||
    safeClass.displayClassName ||
    safeClass.className ||
    safeClass.name ||
    "이름 없는 수업";
  const headerTitle = isBuilderMode
    ? "수업 설계"
    : isChecklistMode
      ? "진도 체크"
      : "수업 계획";

  const normalizedSummary = useMemo(
    () => normalizeSummaryBadges(summaryBadges),
    [summaryBadges],
  );
  const draftDefaults = useMemo(
    () => buildPlanDefaults(safeClass, draftClass, textbooksCatalog),
    [draftClass, safeClass, textbooksCatalog],
  );
  const normalizedDraftPlan = useMemo(
    () => normalizeSchedulePlan(draftPlan, draftDefaults),
    [draftDefaults, draftPlan],
  );
  const calculated = useMemo(
    () => calculateSchedulePlan(normalizedDraftPlan),
    [normalizedDraftPlan],
  );
  const savedPreviewPlan = useMemo(
    () => buildSchedulePlanForSave(normalizedDraftPlan, draftDefaults),
    [draftDefaults, normalizedDraftPlan],
  );
  const selectedTextbooks = useMemo(
    () => buildSelectedTextbooks(draftClass.textbookIds, textbooksCatalog),
    [draftClass.textbookIds, textbooksCatalog],
  );
  const editableStats = useMemo(
    () => buildEditableStats(selectedTextbooks.length, calculated),
    [calculated, selectedTextbooks.length],
  );
  const headerFacts = useMemo(
    () =>
      buildHeaderFacts(
        {
          ...safeClass,
          subject: draftClass.subject,
          className: draftClass.className,
          textbookIds: draftClass.textbookIds,
        },
        isEditableMode ? editableStats : [],
      ),
    [draftClass, editableStats, isEditableMode, safeClass],
  );
  const planTemplateCount = useMemo(
    () =>
      (calculated.sessions || []).filter((session) =>
        (session.textbookEntries || []).some((entry) =>
          hasPlanEntryContent(entry.plan || {}),
        ),
      ).length,
    [calculated.sessions],
  );
  const actualTemplateCount = useMemo(
    () =>
      (calculated.sessions || []).filter((session) =>
        (session.textbookEntries || []).some((entry) =>
          hasActualEntryContent(entry.actual || {}),
        ),
      ).length,
    [calculated.sessions],
  );
  const checklistSummary = useMemo(() => {
    const sessions = calculated.sessions || [];
    const done = sessions.filter(
      (session) => session.progressStatus === "done",
    ).length;
    const partial = sessions.filter(
      (session) => session.progressStatus === "partial",
    ).length;
    return {
      total: sessions.length,
      done,
      partial,
      pending: Math.max(sessions.length - done - partial, 0),
    };
  }, [calculated.sessions]);
  const validationMessage = isBuilderMode
    ? getValidationMessage(draftClass, calculated)
    : "";
  const currentSnapshot = useMemo(
    () =>
      buildStableSnapshot({
        classPatch: draftClass,
        schedulePlan: normalizedDraftPlan,
        defaults: draftDefaults,
      }),
    [draftClass, draftDefaults, normalizedDraftPlan],
  );
  const isDirty = isEditableMode && baselineSnapshot !== currentSnapshot;
  const subjectItems = useMemo(
    () => buildSubjectItems(draftClass.subject),
    [draftClass.subject],
  );
  const steps = useMemo(
    () => [
      {
        key: "settings",
        label: "기본 설정",
        description: "과목과 수업명을 먼저 정리합니다.",
        complete: Boolean(
          String(draftClass.className || "").trim() &&
            String(draftClass.subject || "").trim(),
        ),
      },
      {
        key: "schedule",
        label: "일정 생성",
        description: "요일과 기간으로 회차를 만듭니다.",
        complete: !validationMessage && (calculated.sessions || []).length > 0,
      },
      {
        key: "progress",
        label: "진도 템플릿",
        description: "선택 사항으로 회차별 계획 범위를 잡습니다.",
        complete: planTemplateCount > 0,
        optional: true,
      },
      {
        key: "textbooks",
        label: "교재 연결",
        description: "교재를 연결하고 순서를 정리합니다.",
        complete: selectedTextbooks.length > 0,
      },
      {
        key: "review",
        label: "검토 및 저장",
        description: "미리보기를 확인하고 저장합니다.",
        complete: !isDirty,
      },
    ],
    [
      calculated.sessions,
      draftClass.className,
      draftClass.subject,
      isDirty,
      planTemplateCount,
      selectedTextbooks.length,
      validationMessage,
    ],
  );

  const updateDraftTextbookIds = (updater) => {
    setDraftClass((current) => {
      const currentIds = [...(current.textbookIds || [])];
      const nextIds =
        typeof updater === "function" ? updater(currentIds) : updater;
      return {
        ...current,
        textbookIds: [...new Set((nextIds || []).filter(Boolean))],
      };
    });
  };

  const moveTextbook = (textbookId, direction) => {
    updateDraftTextbookIds((currentIds) => {
      const index = currentIds.indexOf(textbookId);
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (index < 0 || targetIndex < 0 || targetIndex >= currentIds.length) {
        return currentIds;
      }
      const nextIds = [...currentIds];
      const [target] = nextIds.splice(index, 1);
      nextIds.splice(targetIndex, 0, target);
      return nextIds;
    });
  };

  const makePrimaryTextbook = (textbookId) => {
    updateDraftTextbookIds((currentIds) => [
      textbookId,
      ...currentIds.filter((id) => id !== textbookId),
    ]);
  };

  const toggleSection = (key) => {
    setExpandedSections((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };

  const handleRequestClose = () => {
    if (!isEditableMode || !isDirty) {
      onClose?.();
      return;
    }
    setShowDiscardDialog(true);
  };

  const handlePreviewCalendarToggle = (date, meta) => {
    setDraftPlan((currentPlan) =>
      applyCalendarDateToggle(currentPlan || normalizedDraftPlan, date, meta),
    );
  };

  const handlePreviewCalendarSubstitution = (sourceDate, targetDate) => {
    setDraftPlan((currentPlan) =>
      applyCalendarDateSubstitution(
        currentPlan || normalizedDraftPlan,
        sourceDate,
        targetDate,
      ),
    );
  };

  const handleSave = async () => {
    if (!isEditableMode || (isBuilderMode && validationMessage)) {
      return;
    }

    const payload = {
      classPatch: {
        subject: draftClass.subject,
        className: draftClass.className,
        textbookIds: draftClass.textbookIds,
      },
      schedulePlan: normalizedDraftPlan,
    };

    setIsSaving(true);
    try {
      if (onSaveDraft) {
        await onSaveDraft(payload);
      } else {
        onSubjectChange?.(payload.classPatch.subject, payload.schedulePlan);
        onClassNameChange?.(payload.classPatch.className, payload.schedulePlan);
        onTextbookIdsChange?.(payload.classPatch.textbookIds);
        onPlanChange?.(payload.schedulePlan);
      }
      setBaselineSnapshot(currentSnapshot);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTextbookSave = async (textbookPayload) => {
    const result = await onSaveTextbook?.(textbookPayload);
    if (result?.ok && result.textbook?.id) {
      updateDraftTextbookIds((currentIds) =>
        currentIds.includes(result.textbook.id)
          ? currentIds
          : [...currentIds, result.textbook.id],
      );
      setTextbookEditorState(null);
    }
    return result;
  };

  if (!open) {
    return null;
  }

  const publicCardClass = {
    ...safeClass,
    subject: draftClass.subject || safeClass.subject,
    className: displayClassName,
    textbookIds: draftClass.textbookIds,
    schedulePlan: savedPreviewPlan,
  };

  const headerTags = [
    draftClass.subject || safeClass.subject,
    safeClass.grade,
    ...normalizedSummary.map((badge) => badge.label),
  ].filter(Boolean);

  const saveBar = (
    <div className="class-plan-save-bar" data-testid="class-plan-save-bar">
      <div className="class-plan-save-bar-copy">
        <strong>
          {validationMessage
            ? "저장 전에 입력을 조금만 더 다듬어 주세요."
            : isDirty
              ? "변경 사항이 저장 대기 중입니다."
              : "저장된 상태입니다."}
        </strong>
        <span>
          {validationMessage ||
            "자동 저장은 꺼져 있고, 저장 버튼을 눌러야 반영됩니다."}
        </span>
      </div>
      <div className="class-plan-save-bar-actions">
        <Button
          type="primary"
          style="weak"
          size={isMobile ? "big" : "medium"}
          onPress={handleRequestClose}
          disabled={isSaving}
          data-testid="class-plan-cancel-button"
        >
          닫기
        </Button>
        <Button
          type="primary"
          style="fill"
          size={isMobile ? "big" : "medium"}
          onPress={handleSave}
          loading={isSaving}
          disabled={!isDirty || Boolean(validationMessage)}
          data-testid="class-plan-save-button"
        >
          저장
        </Button>
      </div>
    </div>
  );
  const desktopHeaderSaveButton =
    isEditableMode && !isMobile ? (
      <button
        type="button"
        className={`btn-icon class-plan-desktop-save ${isDirty && !validationMessage ? "is-ready" : ""}`.trim()}
        onClick={handleSave}
        disabled={!isDirty || Boolean(validationMessage) || isSaving}
        aria-label={
          validationMessage
            ? validationMessage
            : isSaving
              ? "저장 중"
              : isDirty
                ? "저장"
                : "저장됨"
        }
        title={
          validationMessage ||
          (isSaving ? "저장 중" : isDirty ? "저장" : "저장됨")
        }
        data-testid="class-plan-save-button"
      >
        <Save size={18} />
      </button>
    ) : null;

  const renderMobileSummary = () => {
    const items = isReadonlyMode
      ? [
          { label: "수업 요일", value: safeClass.schedule || "미정" },
          { label: "선생님", value: safeClass.teacher || "미정" },
          {
            label: "현원/정원",
            value: buildEnrollmentFact(safeClass)?.value || "미정",
          },
        ]
      : [
          {
            label: "생성 회차",
            value: `${(calculated.sessions || []).length}회`,
          },
          {
            label: "계획 템플릿",
            value: `${planTemplateCount}회`,
          },
          {
            label: isChecklistMode ? "완료" : "연결 교재",
            value: isChecklistMode
              ? `${checklistSummary.done}회`
              : `${selectedTextbooks.length}권`,
          },
        ];

    const chips = isReadonlyMode
      ? normalizedSummary
      : [
          { label: draftClass.subject, tone: "accent" },
          safeClass.grade ? { label: safeClass.grade, tone: "neutral" } : null,
          isDirty ? { label: "저장 전 변경", tone: "warning" } : null,
        ].filter(Boolean);

    return (
      <div className="class-schedule-modal-mobile-summary">
        <div className="class-schedule-modal-mobile-summary-head">
          <strong>{displayClassName}</strong>
          <div className="class-schedule-modal-mobile-summary-copy">
            {isBuilderMode
              ? "기본 설정부터 일정 생성, 진도 템플릿, 교재 연결까지 한 흐름으로 설계합니다."
              : isChecklistMode
                ? "완성된 일정과 계획을 기준으로 회차별 진행 상태를 빠르게 체크합니다."
                : "수업 일정표와 계획 진도, 실제 진도를 한 번에 확인할 수 있습니다."}
          </div>
        </div>

        <div className="class-schedule-modal-mobile-summary-grid">
          {items.map((item) => (
            <div key={item.label} className="class-schedule-modal-mobile-summary-item">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>

        {chips.length > 0 ? (
          <div className="class-schedule-modal-mobile-summary-chips">
            {chips.map((badge) => (
              <span
                key={badge.label}
                className={`class-schedule-modal-mobile-summary-chip ${getMobileChipToneClass(badge.tone)}`}
              >
                {badge.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  const renderDesktopHeader = () => (
    <header
      className={`class-plan-desktop-header ${isEditableMode ? "is-editable" : "is-public-detail"}`}
    >
      <div className="class-plan-desktop-header-copy">
        <div className="class-plan-desktop-header-title">{headerTitle}</div>
        <div
          className="class-plan-desktop-header-main-row"
          data-testid="class-plan-desktop-header-main-row"
        >
          <div className="class-plan-desktop-header-subtitle">{displayClassName}</div>

          {headerTags.length > 0 ? (
            <div className="class-plan-desktop-header-tags">
              {headerTags.map((tag, index) => (
                <span
                  key={`${tag}-${index}`}
                  className={`class-plan-desktop-header-tag ${index > 1 ? "is-neutral" : ""}`.trim()}
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}

          <div
            className="class-plan-desktop-header-meta"
            data-testid="class-plan-desktop-header-meta"
          >
            {headerFacts.map((fact) => (
              <HeaderFactChip key={fact.key} fact={fact} />
            ))}
          </div>
        </div>
      </div>

      <div className="class-plan-desktop-header-actions">
        {desktopHeaderSaveButton}
        <button
          type="button"
          className="theme-toggle class-plan-desktop-close"
          onClick={handleRequestClose}
          aria-label="닫기"
        >
          <X size={22} />
        </button>
      </div>
    </header>
  );

  const renderTextbooksSection = () => (
    <div className="class-plan-builder-textbooks">
      <div className="class-plan-builder-textbook-actions">
        <Button
          type="primary"
          style="fill"
          size="medium"
          onPress={() => setTextbookEditorState({ textbook: null })}
          disabled={!onSaveTextbook}
        >
          새 교재 등록
        </Button>
      </div>

      <div className="class-plan-builder-textbook-grid">
        <div className="class-plan-builder-textbook-column">
          <div className="class-plan-builder-textbook-head">
            <strong>연결된 교재</strong>
            <Badge size="small" type="blue" badgeStyle="weak">
              {selectedTextbooks.length}권
            </Badge>
          </div>

          {selectedTextbooks.length > 0 ? (
            <div className="class-plan-builder-textbook-list">
              {selectedTextbooks.map((textbook, index) => (
                <div
                  key={textbook.id}
                  className="class-plan-builder-textbook-item"
                >
                  <div className="class-plan-builder-textbook-copy">
                    <div className="class-plan-builder-textbook-title">
                      <BookOpen size={15} />
                      <strong>{textbook.title}</strong>
                    </div>
                    <div className="class-plan-builder-textbook-meta">
                      <Badge
                        size="small"
                        type={index === 0 ? "blue" : "teal"}
                        badgeStyle="weak"
                      >
                        {index === 0 ? "대표 교재" : "보조 교재"}
                      </Badge>
                      <span>{textbook.publisher || "출판사 미등록"}</span>
                    </div>
                  </div>

                  <div className="class-plan-builder-textbook-item-actions">
                    <button
                      type="button"
                      className="action-chip"
                      onClick={() => makePrimaryTextbook(textbook.id)}
                      disabled={index === 0}
                    >
                      대표
                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => moveTextbook(textbook.id, "up")}
                      disabled={index === 0}
                      aria-label="교재 위로 이동"
                    >
                      <ChevronUp size={16} />
                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => moveTextbook(textbook.id, "down")}
                      disabled={index === selectedTextbooks.length - 1}
                      aria-label="교재 아래로 이동"
                    >
                      <ChevronDown size={16} />
                    </button>
                    {onSaveTextbook ? (
                      <button
                        type="button"
                        className="btn-icon"
                        onClick={() => setTextbookEditorState({ textbook })}
                        aria-label="교재 수정"
                      >
                        <Pencil size={16} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() =>
                        updateDraftTextbookIds((currentIds) =>
                          currentIds.filter((id) => id !== textbook.id),
                        )
                      }
                      aria-label="교재 연결 해제"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="class-plan-builder-empty">
              아직 연결된 교재가 없습니다. 오른쪽 카탈로그에서 수업에 맞는 교재를
              골라 주세요.
            </div>
          )}
        </div>

        <div className="class-plan-builder-textbook-column">
          <div className="class-plan-builder-textbook-head">
            <strong>교재 카탈로그</strong>
            <Badge size="small" type="teal" badgeStyle="weak">
              {textbooksCatalog.length}권
            </Badge>
          </div>

          {textbooksCatalog.length > 0 ? (
            <div className="class-plan-builder-catalog-list">
              {textbooksCatalog.map((textbook) => {
                const isSelected = draftClass.textbookIds.includes(textbook.id);
                return (
                  <button
                    key={textbook.id}
                    type="button"
                    className={`class-plan-builder-catalog-item ${isSelected ? "is-selected" : ""}`}
                    onClick={() =>
                      updateDraftTextbookIds((currentIds) =>
                        isSelected
                          ? currentIds.filter((id) => id !== textbook.id)
                          : [...currentIds, textbook.id],
                      )
                    }
                  >
                    <span>
                      <strong>{textbook.title}</strong>
                      <span>{textbook.publisher || "출판사 미등록"}</span>
                    </span>
                    <span>{isSelected ? "연결됨" : "연결"}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="class-plan-builder-empty">
              등록된 교재가 없습니다. 새 교재 등록 버튼으로 먼저 만들어 주세요.
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const previewPanel = (
    <aside
      className="class-plan-builder-preview"
      data-testid="class-plan-builder-preview"
    >
      <ClassSchedulePlanPreview
        plan={normalizedDraftPlan}
        className={displayClassName}
        subject={draftClass.subject}
        interactive={resolvedMode === "builder"}
        onToggleDate={handlePreviewCalendarToggle}
        onSubstitution={handlePreviewCalendarSubstitution}
        allowExport
        emptyMessage={emptyMessage}
        variant="editor-summary"
      />
    </aside>
  );

  const renderBuilderWorkspace = () => (
    <div className="class-plan-sheet-content class-plan-sheet-content--editable-workspace">
      <div
        className="class-plan-builder-layout"
        data-testid="class-plan-builder-layout"
      >
        <div className="class-plan-builder-main">
          {warningBanner ? (
            <div className="class-plan-sheet-warning">{warningBanner}</div>
          ) : null}

          <BuilderStepper steps={steps} />

          <BuilderSection
            title="기본 설정"
            description="과목과 대표 수업명을 먼저 정리합니다."
            complete={steps[0].complete}
            open={expandedSections.settings}
            onToggle={() => toggleSection("settings")}
            testId="class-plan-builder-section-settings"
          >
            <div className="class-plan-settings-grid">
              <div className="class-plan-settings-card">
                <span className="class-plan-sheet-eyebrow">과목</span>
                <SegmentedControl
                  value={draftClass.subject}
                  onValueChange={(nextValue) =>
                    setDraftClass((current) => ({
                      ...current,
                      subject: nextValue,
                    }))
                  }
                  items={subjectItems}
                  size="small"
                  alignment="fixed"
                />
              </div>

              <div className="class-plan-settings-card">
                <TextField
                  label="공식 수업명"
                  labelOption="sustain"
                  help="공개 수업 카드와 수업 계획 제목에 그대로 반영됩니다."
                  value={draftClass.className}
                  placeholder="[영] 대기고3"
                  onChangeText={(nextValue) =>
                    setDraftClass((current) => ({
                      ...current,
                      className: nextValue,
                    }))
                  }
                />
              </div>

              <div className="class-plan-settings-facts">
                <ReviewCard label="요일시간" value={safeClass.schedule || "시간 미정"} />
                <ReviewCard label="선생님" value={safeClass.teacher || "미정"} />
                <ReviewCard
                  label="강의실"
                  value={safeClass.classroom || safeClass.room || "미정"}
                />
              </div>
            </div>
          </BuilderSection>

          <BuilderSection
            title="일정 생성"
            description="수업 요일과 기간을 조정해 회차를 생성합니다."
            complete={steps[1].complete}
            open={expandedSections.schedule}
            onToggle={() => toggleSection("schedule")}
            testId="class-plan-builder-section-schedule"
          >
            <ClassSchedulePlanner
              value={normalizedDraftPlan}
              className={draftClass.className}
              subject={draftClass.subject}
              schedule={safeClass.schedule || ""}
              startDate={safeClass.startDate || ""}
              endDate={safeClass.endDate || ""}
              onPlanChange={setDraftPlan}
              onSubjectChange={(nextSubject, nextPlan) => {
                setDraftClass((current) => ({ ...current, subject: nextSubject }));
                if (nextPlan) {
                  setDraftPlan(nextPlan);
                }
              }}
              onClassNameChange={(nextClassName, nextPlan) => {
                setDraftClass((current) => ({
                  ...current,
                  className: nextClassName,
                }));
                if (nextPlan) {
                  setDraftPlan(nextPlan);
                }
              }}
              showPreview={false}
              showIdentityFields={false}
            />
          </BuilderSection>

          <BuilderSection
            title="진도 템플릿"
            description="선택 사항으로 회차별 계획 범위와 메모를 미리 넣어둘 수 있습니다."
            complete={steps[2].complete}
            optional
            open={expandedSections.progress}
            onToggle={() => toggleSection("progress")}
            testId="class-plan-builder-section-progress"
          >
            <ClassScheduleProgressEditor
              value={normalizedDraftPlan}
              className={draftClass.className}
              subject={draftClass.subject}
              schedule={safeClass.schedule || ""}
              startDate={safeClass.startDate || ""}
              endDate={safeClass.endDate || ""}
              onPlanChange={setDraftPlan}
              mode="plan"
              compact={true}
              textbooksCatalog={textbooksCatalog}
              textbookIds={draftClass.textbookIds}
            />
          </BuilderSection>

          <BuilderSection
            title="교재 연결"
            description="대표 교재와 보조 교재 순서를 정리합니다."
            complete={steps[3].complete}
            open={expandedSections.textbooks}
            onToggle={() => toggleSection("textbooks")}
            testId="class-plan-builder-section-textbooks"
          >
            {renderTextbooksSection()}
          </BuilderSection>

          <BuilderSection
            title="검토 및 저장"
            description="오른쪽 미리보기를 확인한 뒤 저장합니다."
            complete={steps[4].complete}
            open={expandedSections.review}
            onToggle={() => toggleSection("review")}
            testId="class-plan-builder-section-review"
          >
            <div className="class-plan-review-grid">
              <ReviewCard
                label="생성 회차"
                value={`${(calculated.sessions || []).length}회`}
                tone="primary"
              />
              <ReviewCard label="계획 템플릿" value={`${planTemplateCount}회`} />
              <ReviewCard label="연결 교재" value={`${selectedTextbooks.length}권`} />
              <ReviewCard
                label="저장 상태"
                value={isDirty ? "저장 전 변경 있음" : "저장됨"}
                tone={isDirty ? "warning" : "success"}
              />
            </div>
            <p className="class-plan-review-copy">
              오른쪽 미리보기는 draft를 바로 반영합니다. 실제 데이터는 저장 버튼을
              눌렀을 때만 업데이트됩니다.
            </p>
          </BuilderSection>
        </div>

        {previewPanel}
      </div>
      {isMobile ? saveBar : null}
    </div>
  );

  const renderChecklistWorkspace = () => (
    <div className="class-plan-sheet-content class-plan-sheet-content--editable-workspace">
      <div
        className="class-plan-builder-layout"
        data-testid="class-plan-builder-layout"
      >
        <div className="class-plan-builder-main">
          {warningBanner ? (
            <div className="class-plan-sheet-warning">{warningBanner}</div>
          ) : null}

          <section className="class-plan-checklist-overview">
            <div className="class-plan-checklist-overview-copy">
              <span className="class-plan-sheet-eyebrow">Teacher Checklist</span>
              <strong>완성된 일정 기준으로 회차 상태만 빠르게 체크합니다.</strong>
              <p>
                일정과 계획 템플릿은 그대로 참고하고, 각 회차를 미진행, 진행 중,
                완료로만 정리합니다.
              </p>
            </div>
            <div className="class-plan-review-grid">
              <ReviewCard label="전체 회차" value={`${checklistSummary.total}회`} />
              <ReviewCard label="완료" value={`${checklistSummary.done}회`} tone="success" />
              <ReviewCard
                label="진행 중"
                value={`${checklistSummary.partial}회`}
                tone="warning"
              />
              <ReviewCard label="대기" value={`${checklistSummary.pending}회`} />
            </div>
          </section>

          <BuilderSection
            title="진도 체크"
            description="회차별 상태와 내부 메모만 저장합니다."
            complete={checklistSummary.total > 0 && checklistSummary.pending === 0}
            open={expandedSections.progress}
            onToggle={() => toggleSection("progress")}
            testId="class-plan-builder-section-progress"
          >
            <div className="class-plan-checklist-editor">
              <ClassScheduleChecklistEditor
                value={normalizedDraftPlan}
                className={draftClass.className}
                subject={draftClass.subject}
                schedule={safeClass.schedule || ""}
                startDate={safeClass.startDate || ""}
                endDate={safeClass.endDate || ""}
                onPlanChange={setDraftPlan}
                textbooksCatalog={textbooksCatalog}
                textbookIds={draftClass.textbookIds}
              />
            </div>
          </BuilderSection>

          <BuilderSection
            title="검토 및 저장"
            description="오른쪽 미리보기와 체크 결과를 확인한 뒤 저장합니다."
            complete={!isDirty}
            open={expandedSections.review}
            onToggle={() => toggleSection("review")}
            testId="class-plan-builder-section-review"
          >
            <div className="class-plan-review-grid">
              <ReviewCard label="생성 회차" value={`${checklistSummary.total}회`} />
              <ReviewCard
                label="실진도 입력"
                value={`${actualTemplateCount}회`}
                tone="primary"
              />
              <ReviewCard label="연결 교재" value={`${selectedTextbooks.length}권`} />
              <ReviewCard
                label="저장 상태"
                value={isDirty ? "저장 전 변경 있음" : "저장됨"}
                tone={isDirty ? "warning" : "success"}
              />
            </div>
          </BuilderSection>
        </div>

        {previewPanel}
      </div>
      {isMobile ? saveBar : null}
    </div>
  );

  const renderReadonlyWorkspace = () => {
    const hasPlanBoardContent = planTemplateCount > 0;
    const hasActualBoardContent =
      actualTemplateCount > 0 ||
      (calculated.sessions || []).some(
        (session) => session.progressStatus && session.progressStatus !== "pending",
      );

    return (
      <div className="class-plan-sheet-content is-public">
        {warningBanner ? (
          <div className="class-plan-sheet-warning">{warningBanner}</div>
        ) : null}

        <div className="class-plan-sheet-public-stack">
          <div className="class-plan-sheet-public-card-wrapper">
            <PublicLandingCard classItem={publicCardClass} hideActions />
          </div>

          <section className="class-plan-sheet-summary">
            <div className="class-plan-sheet-summary-copy">
              <span className="class-plan-sheet-eyebrow">Class Plan</span>
              <p>
                수업 일정표와 계획 진도, 실제 진도를 한 번에 확인할 수 있습니다.
              </p>
            </div>

            {normalizedSummary.length > 0 ? (
              <div className="class-plan-sheet-badge-row">
                {normalizedSummary.map((badge) => (
                  <Badge
                    key={badge.label}
                    size="small"
                    type={badge.type || "blue"}
                    badgeStyle="weak"
                  >
                    {badge.label}
                  </Badge>
                ))}
              </div>
            ) : null}

            <div className="class-plan-sheet-meta-grid">
              {headerFacts.map((fact) => (
                <div key={fact.key} className="class-plan-sheet-meta-item">
                  <div className="class-plan-sheet-meta-label">
                    {fact.icon ? <fact.icon size={14} /> : null}
                    <span>{fact.key}</span>
                  </div>
                  <strong>{fact.value}</strong>
                </div>
              ))}
            </div>
          </section>

          <ClassSchedulePlanPreview
            plan={savedPreviewPlan}
            className={displayClassName}
            subject={draftClass.subject}
            allowExport
            emptyMessage={emptyMessage}
          />

          {hasPlanBoardContent ? (
            <ClassScheduleProgressBoard
              plan={savedPreviewPlan}
              className={displayClassName}
              subject={draftClass.subject}
              schedule={safeClass.schedule || ""}
              startDate={safeClass.startDate || ""}
              endDate={safeClass.endDate || ""}
              textbookIds={draftClass.textbookIds}
              textbooksCatalog={textbooksCatalog}
              mode="plan"
              title="계획 진도"
              description="회차별로 설계된 계획 범위를 정리했습니다."
              emptyMessage="아직 계획 진도가 입력되지 않았습니다."
            />
          ) : null}

          {hasActualBoardContent ? (
            <ClassScheduleProgressBoard
              plan={savedPreviewPlan}
              className={displayClassName}
              subject={draftClass.subject}
              schedule={safeClass.schedule || ""}
              startDate={safeClass.startDate || ""}
              endDate={safeClass.endDate || ""}
              textbookIds={draftClass.textbookIds}
              textbooksCatalog={textbooksCatalog}
              mode="actual"
              title="실제 진도"
              description="최근 수업에서 실제로 진행된 범위를 정리했습니다."
              emptyMessage="아직 실제 진도가 입력되지 않았습니다."
              hidePendingActual
              publicOnly
            />
          ) : null}

          {primaryActionLabel || secondaryActionLabel ? (
            <div className="class-schedule-modal-action-row">
              {secondaryActionLabel ? (
                <Button
                  type="primary"
                  style="weak"
                  size="big"
                  onPress={onSecondaryAction}
                  className="class-schedule-modal-secondary-action"
                >
                  {secondaryActionLabel}
                </Button>
              ) : null}
              {primaryActionLabel ? (
                <Button
                  type="primary"
                  style="fill"
                  size="big"
                  onPress={onPrimaryAction}
                  className="class-schedule-modal-primary-action"
                >
                  {primaryActionLabel}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const body = isBuilderMode
    ? renderBuilderWorkspace()
    : isChecklistMode
      ? renderChecklistWorkspace()
      : renderReadonlyWorkspace();

  const overlay = isMobile ? (
    <BottomSheet
      open={open}
      onClose={handleRequestClose}
      title={headerTitle}
      subtitle={isReadonlyMode ? draftClass.subject || safeClass.subject || "" : ""}
      testId="class-schedule-plan-modal"
      sheetClassName={
        isReadonlyMode ? "class-plan-bottom-sheet--public" : "class-plan-bottom-sheet--editable"
      }
      bodyClassName="class-plan-mobile-body"
      fullHeightOnMobile={isEditableMode}
      showHandleOnMobile
    >
      <div className="class-plan-sheet">
        {renderMobileSummary()}
        {body}
      </div>
    </BottomSheet>
  ) : (
    <div className="modal-overlay class-plan-modal-overlay" onClick={handleRequestClose}>
      <div
        className={`workspace-surface class-plan-desktop-modal ${isReadonlyMode ? "is-public-detail" : "is-editable"}`}
        data-testid="class-schedule-plan-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={`class-plan-sheet ${isReadonlyMode ? "is-public-detail" : "is-editable"}`}>
          {renderDesktopHeader()}
          {body}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {overlay}

      <Dialog
        open={showDiscardDialog}
        title="저장하지 않은 변경이 있습니다"
        description="지금 닫으면 이번에 수정한 일정과 진도 체크 내용이 사라집니다."
        leftButton={
          <Button
            type="primary"
            style="weak"
            size="medium"
            onPress={() => setShowDiscardDialog(false)}
          >
            계속 편집
          </Button>
        }
        rightButton={
          <Button
            type="primary"
            style="fill"
            size="medium"
            onPress={() => {
              setShowDiscardDialog(false);
              onClose?.();
            }}
          >
            저장 안 하고 닫기
          </Button>
        }
        onClose={() => setShowDiscardDialog(false)}
      />

      {textbookEditorState ? (
        <TextbookQuickEditorModal
          open={Boolean(textbookEditorState)}
          textbook={textbookEditorState.textbook}
          onSave={handleTextbookSave}
          onClose={() => setTextbookEditorState(null)}
        />
      ) : null}
    </>
  );
}
