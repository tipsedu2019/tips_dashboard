import {
  Suspense,
  lazy,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import {
  BarChart2,
  BookOpen,
  Building2,
  Calendar,
  LayoutGrid,
  CalendarDays,
  Eye,
  LogOut,
  Menu,
  Moon,
  Settings2,
  Sun,
  Users,
} from "lucide-react";
import { dataService } from "./services/dataService";
import { useAuth } from "./contexts/AuthContext";
import { isE2EModeEnabled } from "./testing/e2e/e2eMode";
import { e2eDataService } from "./testing/e2e/mockDataService";
import LoginModal from "./components/SettingsModal";
import ChangePasswordModal from "./components/ChangePasswordModal";
import ClassScheduleWorkspaceBoundary from "./components/class-schedule/ClassScheduleWorkspaceBoundary";
import BottomSheet from "./components/ui/BottomSheet";
import PageLoader from "./components/ui/PageLoader";
import StatusBanner from "./components/ui/StatusBanner";
import TermManagerModal from "./components/ui/TermManagerModal";
import TimetableTopFilterBar from "./components/ui/TimetableTopFilterBar";
import { Tab } from "./components/ui/tds";
import useViewport, { TABLET_BREAKPOINT } from "./hooks/useViewport";
import { ACTIVE_CLASS_STATUS, computeClassStatus } from "./lib/classStatus";
import {
  buildClassroomMaster,
  buildTeacherMaster,
} from "./lib/resourceCatalogs";
import { sortSubjectOptions } from "./lib/subjectUtils";
import {
  DAY_LABELS,
  getClassroomDisplayName,
  parseSchedule,
  splitClassroomList,
  splitTeacherList,
} from "./data/sampleData";

const ClassroomWeeklyView = lazy(
  () => import("./components/ClassroomWeeklyView"),
);
const TeacherWeeklyView = lazy(() => import("./components/TeacherWeeklyView"));
const DailyClassroomView = lazy(
  () => import("./components/DailyClassroomView"),
);
const DailyTeacherView = lazy(() => import("./components/DailyTeacherView"));
const DataManager = lazy(() => import("./components/DataManager"));
const AcademicCalendarView = lazy(
  () => import("./components/AcademicCalendarView"),
);
const CurriculumProgressWorkspace = lazy(
  () => import("./components/CurriculumProgressWorkspace"),
);
const ClassScheduleWorkspace = lazy(
  () => import("./components/class-schedule/ClassScheduleWorkspace"),
);
const PublicClassListView = lazy(
  () => import("./components/PublicClassLandingView"),
);
const StatsDashboard = lazy(() => import("./components/StatsDashboard"));

const ALL_OPTION = "\uC804\uCCB4"; const LOCAL_TERM_STORAGE_KEY = "tips-dashboard:local-terms";
const CURRENT_TERM_STORAGE_KEY = "tips-dashboard:current-term";
const CURRENT_TERM_PREFERENCE_KEY = "tips-dashboard:current-term";
const TIMETABLE_FILTER_STORAGE_KEY = "tips-dashboard:timetable-filters-v2";
const DEFAULT_TIMETABLE_FILTERS = {
  term: "",
  subject: [],
  grade: [],
  teacher: [],
  classroom: [],
  day: [],
};
const TIMETABLE_VIEW_IDS = [
  "teacher-weekly",
  "classroom-weekly",
  "daily-teacher",
  "daily-classroom",
];
const DEFAULT_TIMETABLE_VIEW = TIMETABLE_VIEW_IDS[0];
const TIMETABLE_TABS = [
  {
    id: "teacher-weekly",
    label: "\uC120\uC0DD\uB2D8 \uC8FC\uAC04",
    icon: Users,
    description:
      "\uC120\uC0DD\uB2D8\uBCC4 \uC8FC\uAC04 \uC2DC\uAC04\uD45C\uB97C \uBE44\uAD50\uD558\uACE0 \uC6B4\uC601 \uD604\uD669\uC744 \uD55C \uBC88\uC5D0 \uD655\uC778\uD569\uB2C8\uB2E4.",
  },
  {
    id: "classroom-weekly",
    label: "\uAC15\uC758\uC2E4 \uC8FC\uAC04",
    icon: Building2,
    description:
      "\uAC15\uC758\uC2E4\uBCC4 \uC8FC\uAC04 \uC2DC\uAC04\uD45C\uB97C \uBE44\uAD50\uD558\uACE0 \uACF5\uAC04 \uC6B4\uC601 \uD604\uD669\uC744 \uD655\uC778\uD569\uB2C8\uB2E4.",
  },
  {
    id: "daily-teacher",
    label: "\uC77C\uBCC4 \uC120\uC0DD\uB2D8",
    icon: Users,
    description:
      "\uC694\uC77C\uBCC4\uB85C \uC120\uC0DD\uB2D8 \uBC30\uCE58\uC640 \uBE48 \uC2DC\uAC04\uC744 \uC810\uAC80\uD569\uB2C8\uB2E4.",
  },
  {
    id: "daily-classroom",
    label: "\uC77C\uBCC4 \uAC15\uC758\uC2E4",
    icon: Building2,
    description:
      "\uC694\uC77C\uBCC4\uB85C \uAC15\uC758\uC2E4 \uBC30\uCE58\uC640 \uACF5\uC2E4 \uC0C1\uD0DC\uB97C \uD55C \uB208\uC5D0 \uD655\uC778\uD569\uB2C8\uB2E4.",
  },
];
const MANAGER_VIEW_TAB_MAP = {
  "students-manager": "students",
  "classes-manager": "classes",
  "textbooks-manager": "textbooks",
};

const NAV_VIEWS = [
  { id: "stats", label: "\uB300\uC2DC\uBCF4\uB4DC", icon: BarChart2, staffOnly: false },
  {
    id: "academic-calendar",
    label: "\uD559\uC0AC\uC77C\uC815",
    icon: CalendarDays,
    staffOnly: false,
  },
  {
    id: "class-schedule",
    label: "\uC218\uC5C5\uC77C\uC815",
    icon: Calendar,
    staffOnly: false,
  },
  { id: "timetable", label: "\uC2DC\uAC04\uD45C", icon: LayoutGrid, staffOnly: false },
  {
    id: "curriculum-roadmap",
    label: "\uC218\uC5C5\uACC4\uD68D",
    icon: BookOpen,
    staffOnly: true,
  },
  {
    id: "textbooks-manager",
    label: "\uAD50\uC7AC\uAD00\uB9AC",
    icon: BookOpen,
    staffOnly: true,
  },
  {
    id: "classes-manager",
    label: "\uC218\uC5C5\uAD00\uB9AC",
    icon: Calendar,
    staffOnly: true,
  },
  {
    id: "students-manager",
    label: "\uD559\uC0DD\uAD00\uB9AC",
    icon: Users,
    staffOnly: true,
  },
];

const DASHBOARD_BOTTOM_NAV_ITEMS = [
  { id: "stats", label: "\uB300\uC2DC\uBCF4\uB4DC", icon: BarChart2 },
  { id: "academic-calendar", label: "\uD559\uC0AC\uC77C\uC815", icon: CalendarDays },
  { id: "class-schedule", label: "\uC218\uC5C5\uC77C\uC815", icon: Calendar },
  { id: "timetable", label: "\uC2DC\uAC04\uD45C", icon: LayoutGrid },
  {
    id: "curriculum-roadmap",
    label: "\uC218\uC5C5\uACC4\uD68D",
    icon: BookOpen,
    staffOnly: true,
  },
  {
    id: "textbooks-manager",
    label: "\uAD50\uC7AC\uAD00\uB9AC",
    icon: BookOpen,
    staffOnly: true,
    desktopOnly: true,
  },
  {
    id: "classes-manager",
    label: "\uC218\uC5C5\uAD00\uB9AC",
    icon: Calendar,
    staffOnly: true,
    desktopOnly: true,
  },
  {
    id: "students-manager",
    label: "\uD559\uC0DD\uAD00\uB9AC",
    icon: Users,
    staffOnly: true,
    desktopOnly: true,
  },
];

const DASHBOARD_VIEW_SUMMARIES = {
  stats: {
    title: "\uB300\uC2DC\uBCF4\uB4DC",
    description:
      "\uC8FC\uC694 \uC6B4\uC601 \uC9C0\uD45C\uC640 \uBE60\uB978 \uC9C4\uC785 \uB9C1\uD06C\uB97C \uD55C \uD654\uBA74\uC5D0\uC11C \uD655\uC778\uD569\uB2C8\uB2E4.",
  },
  timetable: {
    title: "\uC2DC\uAC04\uD45C",
    description:
      "\uC120\uC0DD\uB2D8\uACFC \uAC15\uC758\uC2E4 \uC6B4\uC601 \uD604\uD669\uC744 \uD0ED\uBCC4\uB85C \uBE44\uAD50\uD558\uACE0 \uC800\uC7A5\uAE4C\uC9C0 \uD55C \uBC88\uC5D0 \uCC98\uB9AC\uD569\uB2C8\uB2E4.",
  },
  "academic-calendar": {
    title: "\uD559\uC0AC\uC77C\uC815",
    description:
      "\uD559\uC0AC \uCEA8\uB9B0\uB354\uC640 \uD559\uAD50 \uC5F0\uAC04\uC77C\uC815\uD45C\uB97C \uD55C \uC6CC\uD06C\uC2A4\uD398\uC774\uC2A4\uC5D0\uC11C \uD568\uAED8 \uAD00\uB9AC\uD569\uB2C8\uB2E4.",
  },
  "class-schedule": {
    title: "\uC218\uC5C5\uC77C\uC815",
    description:
      "\uC218\uC5C5 \uC77C\uC815, \uC9C4\uB3C4, \uACF5\uAC1C \uD0C0\uC784\uB77C\uC778\uC744 \uD558\uB098\uC758 \uC6CC\uD06C\uC2A4\uD398\uC774\uC2A4\uC5D0\uC11C \uC6B4\uC601\uD558\uB294 \uC0C8 \uC149 \uD654\uBA74\uC785\uB2C8\uB2E4.",
  },
  "curriculum-roadmap": {
    title: "\uC218\uC5C5\uACC4\uD68D",
    description:
      "\uBC18\uBCC4 \uC218\uC5C5 \uACC4\uD68D\uACFC \uC2E4\uC81C \uC9C4\uB3C4 \uD604\uD669\uC744 \uD55C \uC6CC\uD06C\uC2A4\uD398\uC774\uC2A4\uC5D0\uC11C \uC810\uAC80\uD569\uB2C8\uB2E4.",
  },
  "students-manager": {
    title: "\uD559\uC0DD\uAD00\uB9AC",
    description:
      "\uD559\uC0DD \uAE30\uBCF8 \uC815\uBCF4\uC640 \uD559\uAD50, \uD559\uB144, \uBCF4\uD638\uC790 \uC5F0\uB77D\uCC98\uB97C \uAD00\uB9AC\uD569\uB2C8\uB2E4.",
  },
  "classes-manager": {
    title: "\uC218\uC5C5\uAD00\uB9AC",
    description:
      "\uC218\uC5C5 \uD3B8\uC131, \uB2F4\uB2F9 \uC120\uC0DD\uB2D8, \uAC15\uC758\uC2E4, \uC218\uC5C5 \uACC4\uD68D \uC5F0\uACB0\uAE4C\uC9C0 \uD55C \uD750\uB984\uC73C\uB85C \uAD00\uB9AC\uD569\uB2C8\uB2E4.",
  },
  "textbooks-manager": {
    title: "\uAD50\uC7AC\uAD00\uB9AC",
    description:
      "\uAD50\uC7AC \uC815\uBCF4\uC640 \uBAA9\uCC28, \uC218\uC5C5 \uC5F0\uACB0 \uAE30\uC900\uC774 \uB418\uB294 \uAD50\uC7AC \uB370\uC774\uD130\uB97C \uC815\uB9AC\uD569\uB2C8\uB2E4.",
  },
};

function parseLocalDate(value) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getPublicModeFromLocation() {
  if (typeof window === "undefined") {
    return false;
  }
  const params = new URLSearchParams(window.location.search);
  return params.get("view") === "public";
}

function replacePublicMode(next) {
  if (typeof window === "undefined") {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  if (next) {
    params.set("view", "public");
  } else {
    params.delete("view");
  }

  const nextQuery = params.toString();
  const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash || ""}`;
  window.history.replaceState({}, "", nextUrl);
}

function FilledNavIcon({ name, size = 20, fallbackIcon: FallbackIcon = null }) {
  const commonProps = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "currentColor",
    "aria-hidden": "true",
    className: "dashboard-filled-nav-icon",
  };

  switch (name) {
    case "stats":
      return (
        <svg {...commonProps}>
          <path d="M6 20.5a1 1 0 0 1-1-1V12a1 1 0 1 1 2 0v7.5a1 1 0 0 1-1 1Zm6 0a1 1 0 0 1-1-1v-15a1 1 0 1 1 2 0v15a1 1 0 0 1-1 1Zm6 0a1 1 0 0 1-1-1V9a1 1 0 1 1 2 0v10.5a1 1 0 0 1-1 1Z" />
        </svg>
      );
    case "timetable":
      return (
        <svg {...commonProps}>
          <path d="M5.6 3.6h4.8A1.6 1.6 0 0 1 12 5.2V10a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 10V5.2a1.6 1.6 0 0 1 1.6-1.6Zm8 0h4.8A1.6 1.6 0 0 1 20 5.2V10a1.6 1.6 0 0 1-1.6 1.6h-4.8A1.6 1.6 0 0 1 12 10V5.2a1.6 1.6 0 0 1 1.6-1.6Zm-8 8.8h4.8A1.6 1.6 0 0 1 12 14v4.8a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 18.8V14a1.6 1.6 0 0 1 1.6-1.6Zm8 0h4.8A1.6 1.6 0 0 1 20 14v4.8a1.6 1.6 0 0 1-1.6 1.6h-4.8A1.6 1.6 0 0 1 12 18.8V14a1.6 1.6 0 0 1 1.6-1.6Z" />
        </svg>
      );
    case "academic-calendar":
      return (
        <svg {...commonProps}>
          <path d="M7.2 2.5a1 1 0 0 1 1 1v.8h7.6v-.8a1 1 0 1 1 2 0v.8h.7A2.5 2.5 0 0 1 21 6.8v10.7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5V6.8a2.5 2.5 0 0 1 2.5-2.5h.7v-.8a1 1 0 0 1 1-1Zm-1.7 6.7h13V6.8a.5.5 0 0 0-.5-.5h-13a.5.5 0 0 0-.5.5v2.4Zm2.1 3.3a1 1 0 1 0 0 2h2.2a1 1 0 1 0 0-2H7.6Zm5 0a1 1 0 1 0 0 2h3.8a1 1 0 1 0 0-2h-3.8Zm-5 4a1 1 0 1 0 0 2h8.8a1 1 0 1 0 0-2H7.6Z" />
        </svg>
      );
    case "class-schedule":
      return (
        <svg {...commonProps}>
          <path d="M7 3.2a1 1 0 0 1 1 1V5h8v-.8a1 1 0 1 1 2 0V5h.8A2.2 2.2 0 0 1 21 7.2v11.1a2.2 2.2 0 0 1-2.2 2.2H5.2A2.2 2.2 0 0 1 3 18.3V7.2A2.2 2.2 0 0 1 5.2 5H6v-.8a1 1 0 0 1 1-1Zm-1.8 6v9.1a.2.2 0 0 0 .2.2h13.4a.2.2 0 0 0 .2-.2V9.2H5.2Zm2.1 2.2h3.4a1 1 0 1 1 0 2H7.3a1 1 0 1 1 0-2Zm6.1 0a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0v-4a1 1 0 0 1 1-1Zm4.1 2a1 1 0 0 1-1 1h-1.7a1 1 0 1 1 0-2h1.7a1 1 0 0 1 1 1Z" />
        </svg>
      );
    case "curriculum-roadmap":
      return (
        <svg {...commonProps}>
          <path d="M5 4.2A2.8 2.8 0 0 0 2.2 7v10.3c0 .83.67 1.5 1.5 1.5h1.45c.96 0 1.9.25 2.72.72l2.38 1.36a.5.5 0 0 0 .75-.43V7A2.8 2.8 0 0 0 8.2 4.2H5Z" />
          <path d="M19 4.2A2.8 2.8 0 0 1 21.8 7v10.3c0 .83-.67 1.5-1.5 1.5h-1.45c-.96 0-1.9.25-2.72.72l-2.38 1.36a.5.5 0 0 1-.75-.43V7a2.8 2.8 0 0 1 2.8-2.8H19Z" />
        </svg>
      );
    case "students-manager":
      return (
        <svg {...commonProps}>
          <path d="M12 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-5.7 6.8a5.7 5.7 0 0 1 11.4 0 .9.9 0 0 1-.9.9H7.2a.9.9 0 0 1-.9-.9Z" />
          <path d="M5.4 12.8a2.8 2.8 0 1 0-2.8-2.8 2.8 2.8 0 0 0 2.8 2.8Zm13.2 0a2.8 2.8 0 1 0-2.8-2.8 2.8 2.8 0 0 0 2.8 2.8Z" opacity=".72" />
        </svg>
      );
    case "classes-manager":
      return (
        <svg {...commonProps}>
          <path d="M7 3.2a1 1 0 0 1 1 1V5h8v-.8a1 1 0 1 1 2 0V5h.8A2.2 2.2 0 0 1 21 7.2v11.1a2.2 2.2 0 0 1-2.2 2.2H5.2A2.2 2.2 0 0 1 3 18.3V7.2A2.2 2.2 0 0 1 5.2 5H6v-.8a1 1 0 0 1 1-1Zm-1.8 6v9.1a.2.2 0 0 0 .2.2h13.4a.2.2 0 0 0 .2-.2V9.2H5.2Zm2.3 2.2h3.5a1 1 0 1 1 0 2H7.5a1 1 0 1 1 0-2Zm0 4.1h8.8a1 1 0 1 1 0 2H7.5a1 1 0 1 1 0-2Z" />
        </svg>
      );
    case "textbooks-manager":
      return (
        <svg {...commonProps}>
          <path d="M6 4.3A2.3 2.3 0 0 0 3.7 6.6v10.8c0 .72.58 1.3 1.3 1.3h1.8c.72 0 1.44.18 2.08.53l2.47 1.34a.5.5 0 0 0 .74-.44V6.6A2.3 2.3 0 0 0 9.8 4.3H6Z" />
          <path d="M18 4.3a2.3 2.3 0 0 1 2.3 2.3v10.8c0 .72-.58 1.3-1.3 1.3h-1.8c-.72 0-1.44.18-2.08.53l-2.47 1.34a.5.5 0 0 1-.74-.44V6.6A2.3 2.3 0 0 1 14.2 4.3H18Z" />
        </svg>
      );
    default:
      return FallbackIcon ? (
        <FallbackIcon size={size} strokeWidth={1.85} fill="currentColor" />
      ) : null;
  }
}

function mergeTermsByName(...collections) {
  const merged = new Map();

  collections
    .flat()
    .filter(Boolean)
    .forEach((term, index) => {
      const name = String(term?.name || term?.period || "").trim();
      if (!name) {
        return;
      }

      const previous = merged.get(name) || {};
      merged.set(name, {
        ...previous,
        ...term,
        name,
        sortOrder: Number(
          term?.sortOrder ?? term?.sort_order ?? previous.sortOrder ?? index,
        ),
      });
    });

  return [...merged.values()];
}

function readStoredJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeTimetableFilters(raw = null) {
  return {
    term: typeof raw?.term === "string" ? raw.term : "",
    subject: Array.isArray(raw?.subject) ? raw.subject.filter(Boolean) : [],
    grade: Array.isArray(raw?.grade) ? raw.grade.filter(Boolean) : [],
    teacher: Array.isArray(raw?.teacher) ? raw.teacher.filter(Boolean) : [],
    classroom: Array.isArray(raw?.classroom)
      ? raw.classroom.filter(Boolean)
      : [],
    day: Array.isArray(raw?.day) ? raw.day.filter(Boolean) : [],
  };
}

function normalizeCurrentTermPreference(raw = null) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const name = String(raw?.name || "").trim();
  const academicYear = raw?.academicYear ? Number(raw.academicYear) : null;
  const termId = raw?.termId ? String(raw.termId) : "";

  if (!name && !termId) {
    return null;
  }

  return {
    termId,
    academicYear: Number.isFinite(academicYear) ? academicYear : null,
    name,
  };
}

function resolveClassTermName(classItem, managedTerms = []) {
  const directPeriod = String(classItem?.period || "").trim();
  if (directPeriod) {
    return directPeriod;
  }

  const matchedTerm = (managedTerms || []).find(
    (term) => String(term.id || "") === String(classItem?.termId || ""),
  );
  return String(matchedTerm?.name || "").trim();
}

function collectClassTeachers(classItem) {
  const teachers = new Set(splitTeacherList(classItem?.teacher));

  parseSchedule(classItem?.schedule, classItem).forEach((slot) => {
    splitTeacherList(slot?.teacher).forEach((teacher) => {
      if (teacher) {
        teachers.add(teacher);
      }
    });
  });

  return [...teachers].filter(Boolean);
}

function collectClassClassrooms(classItem) {
  const classrooms = new Set(
    splitClassroomList(classItem?.classroom || classItem?.room)
      .map((value) => getClassroomDisplayName(value))
      .filter(Boolean),
  );

  parseSchedule(classItem?.schedule, classItem).forEach((slot) => {
    const classroom = getClassroomDisplayName(slot?.classroom || "");
    if (classroom) {
      classrooms.add(classroom);
    }
  });

  return [...classrooms];
}

function filterResourceNamesBySubjects(entries = [], selectedSubjects = []) {
  const normalizedSubjects = Array.isArray(selectedSubjects)
    ? selectedSubjects
      .map((value) => String(value || "").trim())
      .filter(Boolean)
    : [];

  if (normalizedSubjects.length === 0) {
    return (entries || [])
      .filter((entry) => entry?.isVisible !== false)
      .map((entry) => entry.name);
  }

  const subjectSet = new Set(normalizedSubjects);

  return (entries || [])
    .filter((entry) => {
      if (entry?.isVisible === false) {
        return false;
      }

      const subjects = Array.isArray(entry?.subjects)
        ? entry.subjects
          .map((value) => String(value || "").trim())
          .filter(Boolean)
        : [];

      return subjects.some((subject) => subjectSet.has(subject));
    })
    .map((entry) => entry.name);
}

function buildStatusBanner(authError, data) {
  if (authError) {
    return {
      variant: "warning",
      title: "\uB85C\uADF8\uC778 \uC138\uC158\uC5D0 \uBB38\uC81C\uAC00 \uC788\uC2B5\uB2C8\uB2E4.",
      message: authError,
    };
  }

  if (data.error && !data.isConnected) {
    return {
      variant: "error",
      title: "??⑥щ턄????⑤슡???釉띾쐝?",
      message: data.error,
    };
  }

  if (data.error) {
    return {
      variant: "warning",
      title: "\uB370\uC774\uD130 \uC77D\uAE30\uC5D0 \uC77C\uBD80 \uBB38\uC81C\uAC00 \uC788\uC2B5\uB2C8\uB2E4.",
      message: data.error,
    };
  }

  return null;
}

export default function App() {
  const { width, isMobile, isTablet, isCompact, isDesktop } = useViewport();
  const defaultDashboardView = "stats";
  const activeDataService = isE2EModeEnabled() ? e2eDataService : dataService;
  const [currentView, setCurrentView] = useState(() => defaultDashboardView);
  const [data, setData] = useState({
    classes: [],
    students: [],
    textbooks: [],
    progressLogs: [],
    classScheduleSyncGroups: [],
    classScheduleSyncGroupMembers: [],
    classTerms: [],
    academicEvents: [],
    academicSchools: [],
    teacherCatalogs: [],
    classroomCatalogs: [],
    academicCurriculumProfiles: [],
    academicSupplementMaterials: [],
    academicEventExamDetails: [],
    academicExamMaterialPlans: [],
    academicExamMaterialItems: [],
    academicExamDays: [],
    academicExamScopes: [],
    academyCurriculumPlans: [],
    academyCurriculumMaterials: [],
    academyCurriculumPeriodCatalogs: [],
    academyCurriculumPeriodPlans: [],
    academyCurriculumPeriodItems: [],
    isConnected: false,
    isLoading: true,
    lastUpdated: null,
    error: null,
  });
  const [showLogin, setShowLogin] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => !isCompact);
  const [timetableFilters, setTimetableFilters] = useState(() =>
    normalizeTimetableFilters(
      readStoredJson(TIMETABLE_FILTER_STORAGE_KEY, DEFAULT_TIMETABLE_FILTERS),
    ),
  );
  const [timetableGridColumns, setTimetableGridColumns] = useState(2);
  const [timetableExportRequest, setTimetableExportRequest] = useState(null);
  const [currentTermPreference, setCurrentTermPreference] = useState(() =>
    normalizeCurrentTermPreference(
      readStoredJson(CURRENT_TERM_STORAGE_KEY, null),
    ),
  );
  const [filterMode, setFilterMode] = useState("period");
  const [selectedDate, setSelectedDate] = useState(() =>
    toDateInputValue(new Date()),
  );
  const [selectedPeriod, setSelectedPeriod] = useState(ALL_OPTION);
  const [selectedSubject, setSelectedSubject] = useState(ALL_OPTION);
  const [isPeriodDropdownOpen, setIsPeriodDropdownOpen] = useState(false);
  const [isTermManagerOpen, setIsTermManagerOpen] = useState(false);
  const [isTimetableFilterSheetOpen, setIsTimetableFilterSheetOpen] =
    useState(false);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("theme") || "light",
  );
  const [isPublicMode, setIsPublicMode] = useState(() =>
    getPublicModeFromLocation(),
  );
  const [localTerms, setLocalTerms] = useState(() =>
    readStoredJson(LOCAL_TERM_STORAGE_KEY, []),
  );
  const [sidebarTooltip, setSidebarTooltip] = useState(null);
  const [isSubjectFlyoutOpen, setIsSubjectFlyoutOpen] = useState(false);
  const [subjectFlyoutAnchor, setSubjectFlyoutAnchor] = useState(null);
  const [isPeriodFlyoutOpen, setIsPeriodFlyoutOpen] = useState(false);
  const [periodFlyoutAnchor, setPeriodFlyoutAnchor] = useState(null);
  const [curriculumRoadmapIntent, setCurriculumRoadmapIntent] = useState(null);
  const [academicCalendarIntent, setAcademicCalendarIntent] = useState(null);
  const subjectFlyoutCloseTimerRef = useRef(null);
  const periodFlyoutCloseTimerRef = useRef(null);

  const {
    user,
    isStaff,
    isTeacher,
    canAccessDashboard,
    mustChangePassword,
    logout,
    loading,
    authError,
  } = useAuth();
  const useBottomNavShell = true;
  const forceDesktopLayout = isDesktop && width <= TABLET_BREAKPOINT;
  const dashboardShellLayoutClass = useBottomNavShell
    ? (isDesktop ? "dashboard-bottom-nav-desktop-shell" : "dashboard-bottom-nav-only")
    : "";
  const hasDesktopSidebar = !useBottomNavShell && !isCompact;
  const showMinimalSidebar = hasDesktopSidebar && !sidebarOpen;
  const canAccessCurriculumRoadmap = isStaff || isTeacher;

  const changeView = (nextView, { closeSidebar = true } = {}) => {
    startTransition(() => {
      setCurrentView(nextView);
    });
    if (closeSidebar && isCompact) {
      setSidebarOpen(false);
    }
  };

  const goHome = () => {
    changeView(defaultDashboardView);
  };

  const openCurriculumRoadmap = (intent = null) => {
    setCurriculumRoadmapIntent(
      intent ? { ...intent, nonce: Date.now() } : { nonce: Date.now() },
    );
    changeView("curriculum-roadmap", { closeSidebar: false });
  };

  const openAcademicCalendar = (intent = null) => {
    setAcademicCalendarIntent(
      intent ? { ...intent, nonce: Date.now() } : { nonce: Date.now() },
    );
    changeView("academic-calendar", { closeSidebar: false });
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(
        LOCAL_TERM_STORAGE_KEY,
        JSON.stringify(localTerms || []),
      );
    } catch {
      // ignore local storage persistence failures
    }
  }, [localTerms]);

  useEffect(() => {
    try {
      localStorage.setItem(
        TIMETABLE_FILTER_STORAGE_KEY,
        JSON.stringify(timetableFilters),
      );
    } catch {
      // ignore local storage persistence failures
    }
  }, [timetableFilters]);

  useEffect(() => {
    try {
      if (currentTermPreference) {
        localStorage.setItem(
          CURRENT_TERM_STORAGE_KEY,
          JSON.stringify(currentTermPreference),
        );
      } else {
        localStorage.removeItem(CURRENT_TERM_STORAGE_KEY);
      }
    } catch {
      // ignore local storage persistence failures
    }
  }, [currentTermPreference]);

  useEffect(() => {
    let cancelled = false;

    activeDataService
      .getAppPreference?.(CURRENT_TERM_PREFERENCE_KEY)
      .then((savedPreference) => {
        if (cancelled) {
          return;
        }
        const normalized = normalizeCurrentTermPreference(
          savedPreference?.value || savedPreference || null,
        );
        if (normalized) {
          setCurrentTermPreference(normalized);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("Current term preference load skipped:", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeDataService]);

  useEffect(() => {
    const unsubscribe = activeDataService.subscribe(setData);
    return unsubscribe;
  }, [activeDataService]);

  useEffect(() => {
    if (!isCompact || !TIMETABLE_VIEW_IDS.includes(currentView)) {
      setIsTimetableFilterSheetOpen(false);
    }
  }, [currentView, isCompact]);

  useEffect(() => {
    const handlePopState = () => {
      setIsPublicMode(getPublicModeFromLocation());
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (
      !isStaff ||
      data.isLoading ||
      !Array.isArray(data.classes) ||
      data.classes.length === 0
    ) {
      return;
    }

    const storageKey = "tips-dashboard:classroom-normalize-v1";
    if (localStorage.getItem(storageKey)) {
      return;
    }

    const hasLegacyRoom = data.classes.some((classItem) => {
      const room = classItem.roomRaw || classItem.room || "";
      return room && room !== classItem.classroom;
    });

    if (!hasLegacyRoom) {
      localStorage.setItem(storageKey, "clean");
      return;
    }

    let cancelled = false;
    activeDataService
      .normalizeLegacyClassrooms(data.classes)
      .then((updatedCount) => {
        if (cancelled || updatedCount === 0) {
          return;
        }
        localStorage.setItem(storageKey, String(updatedCount));
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("Legacy classroom normalization skipped:", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeDataService, data.classes, data.isLoading, isStaff]);

  useEffect(() => {
    if (currentView === "planner") {
      changeView("classes-manager", { closeSidebar: false });
    }
    if (currentView === "curriculum-dashboard") {
      changeView("curriculum-roadmap", { closeSidebar: false });
    }
  }, [currentView]);

  useEffect(() => {
    if (isCompact) {
      setSidebarOpen(false);
      return;
    }

    setSidebarOpen(true);
  }, [isCompact]);

  useEffect(() => {
    if (!showMinimalSidebar) {
      setSidebarTooltip(null);
    }
  }, [showMinimalSidebar]);

  useEffect(() => {
    if (
      user &&
      ((MANAGER_VIEW_TAB_MAP[currentView] && !isStaff) ||
        (currentView === "curriculum-roadmap" && !canAccessCurriculumRoadmap))
    ) {
      changeView("stats", { closeSidebar: false });
    }
  }, [canAccessCurriculumRoadmap, currentView, isStaff, user]);

  const persistCurrentTermPreference = useCallback(
    async (nextPreference) => {
      const normalized = normalizeCurrentTermPreference(nextPreference);
      setCurrentTermPreference(normalized);

      if (!activeDataService.setAppPreference) {
        return;
      }

      try {
        await activeDataService.setAppPreference(
          CURRENT_TERM_PREFERENCE_KEY,
          normalized,
        );
      } catch (error) {
        console.warn("Current term preference save skipped:", error);
      }
    },
    [activeDataService],
  );

  const handleTimetableFilterChange = useCallback((key, value) => {
    setTimetableFilters((current) =>
      normalizeTimetableFilters({
        ...current,
        [key]: Array.isArray(value) ? [...value] : value,
      }),
    );
  }, []);

  const resetTimetableFilters = useCallback(() => {
    setTimetableFilters(normalizeTimetableFilters(DEFAULT_TIMETABLE_FILTERS));
  }, []);

  const periodMeta = useMemo(() => {
    const result = {};

    (data.classTerms || []).forEach((term) => {
      const name = term.name || term.period || "";
      if (!name) return;
      result[name] = {
        startDate: term.startDate || term.start_date || "",
        endDate: term.endDate || term.end_date || "",
        status: term.status || "",
        academicYear: term.academicYear || term.academic_year || "",
      };
    });

    (localTerms || []).forEach((term) => {
      const name = term.name || term.period || "";
      if (!name || result[name]) return;
      result[name] = {
        startDate: term.startDate || term.start_date || "",
        endDate: term.endDate || term.end_date || "",
        status: term.status || "",
        academicYear: term.academicYear || term.academic_year || "",
      };
    });

    (data.classes || []).forEach((classItem) => {
      if (!classItem.period || result[classItem.period]) return;
      result[classItem.period] = {
        startDate: classItem.startDate,
        endDate: classItem.endDate,
        status: computeClassStatus(classItem),
        academicYear: "",
      };
    });

    return result;
  }, [data.classTerms, data.classes, localTerms]);

  const termNames = useMemo(() => {
    const values = new Set();

    (data.classTerms || []).forEach((term) => {
      const name = term.name || term.period || "";
      if (name) {
        values.add(name);
      }
    });

    (localTerms || []).forEach((term) => {
      const name = term.name || term.period || "";
      if (name) {
        values.add(name);
      }
    });

    (data.classes || []).forEach((classItem) => {
      if (classItem.period) {
        values.add(classItem.period);
      }
    });

    return Array.from(values).sort((left, right) =>
      left.localeCompare(right, "ko"),
    );
  }, [data.classTerms, data.classes, localTerms]);

  const managedTerms = useMemo(() => {
    const result = [];
    const knownNames = new Set();

    mergeTermsByName(localTerms || [], data.classTerms || []).forEach(
      (term, index) => {
        const name = term.name || term.period || "";
        if (!name) return;
        knownNames.add(name);
        result.push({
          ...term,
          id: term.id,
          academicYear: Number(
            term.academicYear || term.academic_year || new Date().getFullYear(),
          ),
          name,
          status: term.status || periodMeta[name]?.status || ACTIVE_CLASS_STATUS,
          startDate:
            term.startDate ||
            term.start_date ||
            periodMeta[name]?.startDate ||
            "",
          endDate:
            term.endDate || term.end_date || periodMeta[name]?.endDate || "",
          sortOrder: Number(term.sortOrder ?? term.sort_order ?? index),
        });
      },
    );

    termNames.forEach((period, index) => {
      if (knownNames.has(period)) return;
      result.push({
        id: `legacy-${period}`,
        academicYear: Number(
          periodMeta[period]?.academicYear || new Date().getFullYear(),
        ),
        name: period,
        status: periodMeta[period]?.status || ACTIVE_CLASS_STATUS,
        startDate: periodMeta[period]?.startDate || "",
        endDate: periodMeta[period]?.endDate || "",
        sortOrder: result.length + index,
        legacyOnly: true,
      });
    });

    return result.sort((left, right) => {
      const yearGap =
        Number(right.academicYear || 0) - Number(left.academicYear || 0);
      if (yearGap !== 0) {
        return yearGap;
      }
      return Number(left.sortOrder || 0) - Number(right.sortOrder || 0);
    });
  }, [data.classTerms, localTerms, periodMeta, termNames]);

  const periods = useMemo(() => [ALL_OPTION, ...termNames], [termNames]);

  const currentTerm = useMemo(() => {
    if (!currentTermPreference) {
      return null;
    }

    return (
      managedTerms.find((term) => {
        const sameId =
          currentTermPreference.termId &&
          String(term.id || "") === String(currentTermPreference.termId);
        const sameYearAndName =
          currentTermPreference.academicYear &&
          Number(term.academicYear || 0) ===
          Number(currentTermPreference.academicYear) &&
          term.name === currentTermPreference.name;
        const sameName =
          currentTermPreference.name &&
          term.name === currentTermPreference.name;
        return sameId || sameYearAndName || sameName;
      }) || null
    );
  }, [currentTermPreference, managedTerms]);

  const currentTermName = currentTerm?.name || "";

  useEffect(() => {
    const availableTerms = new Set(managedTerms.map((term) => term.name));
    setTimetableFilters((current) => {
      const next = normalizeTimetableFilters(current);
      let changed = false;

      if (next.term && !availableTerms.has(next.term)) {
        next.term = "";
        changed = true;
      }

      if (!next.term && currentTermName) {
        next.term = currentTermName;
        changed = true;
      }

      return changed ? next : current;
    });
  }, [currentTermName, managedTerms]);

  const termFilteredClasses = useMemo(() => {
    if (!timetableFilters.term) {
      return data.classes;
    }
    return (data.classes || []).filter(
      (classItem) =>
        resolveClassTermName(classItem, managedTerms) === timetableFilters.term,
    );
  }, [data.classes, managedTerms, timetableFilters.term]);

  const subjectOptions = useMemo(
    () =>
      sortSubjectOptions(
        termFilteredClasses
          .map((classItem) => classItem.subject)
          .filter(Boolean),
        { includeDefaults: false },
      ),
    [termFilteredClasses],
  );
  const subjects = useMemo(
    () => [ALL_OPTION, ...subjectOptions],
    [subjectOptions],
  );

  const subjectFilteredClasses = useMemo(() => {
    if (!timetableFilters.subject.length) {
      return termFilteredClasses;
    }
    const selectedSubjects = new Set(timetableFilters.subject);
    return termFilteredClasses.filter((classItem) =>
      selectedSubjects.has(classItem.subject),
    );
  }, [termFilteredClasses, timetableFilters.subject]);

  const timetableTeacherMaster = useMemo(
    () => buildTeacherMaster(data.teacherCatalogs, subjectFilteredClasses),
    [data.teacherCatalogs, subjectFilteredClasses],
  );

  const teacherOptions = useMemo(
    () =>
      filterResourceNamesBySubjects(
        timetableTeacherMaster,
        timetableFilters.subject,
      ),
    [timetableTeacherMaster, timetableFilters.subject],
  );

  const timetableClassroomMaster = useMemo(
    () => buildClassroomMaster(data.classroomCatalogs, subjectFilteredClasses),
    [data.classroomCatalogs, subjectFilteredClasses],
  );

  const classroomOptions = useMemo(
    () =>
      filterResourceNamesBySubjects(
        timetableClassroomMaster,
        timetableFilters.subject,
      ),
    [timetableClassroomMaster, timetableFilters.subject],
  );

  useEffect(() => {
    setTimetableFilters((current) => {
      const next = normalizeTimetableFilters(current);
      const sanitized = {
        ...next,
        subject: next.subject.filter((value) => subjectOptions.includes(value)),
        teacher: next.teacher.filter((value) => teacherOptions.includes(value)),
        classroom: next.classroom.filter((value) =>
          classroomOptions.includes(value),
        ),
        day: next.day.filter((value) => DAY_LABELS.includes(value)),
      };

      const changed =
        sanitized.subject.length !== next.subject.length ||
        sanitized.teacher.length !== next.teacher.length ||
        sanitized.classroom.length !== next.classroom.length ||
        sanitized.day.length !== next.day.length;

      return changed ? sanitized : current;
    });
  }, [classroomOptions, subjectOptions, teacherOptions]);

  const filteredClasses = useMemo(() => {
    let nextClasses = subjectFilteredClasses;

    const activeTeacherFilters =
      currentView === "teacher-weekly" ? timetableFilters.teacher : [];
    const activeClassroomFilters =
      currentView === "classroom-weekly" ? timetableFilters.classroom : [];
    const activeDayFilters =
      currentView === "daily-teacher" || currentView === "daily-classroom"
        ? timetableFilters.day
        : [];

    if (activeTeacherFilters.length > 0) {
      const selectedTeachers = new Set(activeTeacherFilters);
      nextClasses = nextClasses.filter((classItem) =>
        collectClassTeachers(classItem).some((teacher) =>
          selectedTeachers.has(teacher),
        ),
      );
    }

    if (activeClassroomFilters.length > 0) {
      const selectedClassrooms = new Set(activeClassroomFilters);
      nextClasses = nextClasses.filter((classItem) =>
        collectClassClassrooms(classItem).some((classroom) =>
          selectedClassrooms.has(classroom),
        ),
      );
    }

    if (activeDayFilters.length > 0) {
      const selectedDays = new Set(activeDayFilters);
      nextClasses = nextClasses.filter((classItem) =>
        parseSchedule(classItem.schedule, classItem).some((slot) =>
          selectedDays.has(slot.day),
        ),
      );
    }

    return nextClasses;
  }, [
    currentView,
    subjectFilteredClasses,
    timetableFilters.classroom,
    timetableFilters.day,
    timetableFilters.teacher,
  ]);

  const weeklyAxisClasses = useMemo(() => filteredClasses, [filteredClasses]);

  const statusBanner = useMemo(
    () => buildStatusBanner(authError, data),
    [authError, data],
  );
  const visibleViews = useMemo(
    () =>
      NAV_VIEWS.filter((view) => {
        if (!view.staffOnly) return true;
        if (view.id === "curriculum-roadmap") {
          return canAccessCurriculumRoadmap;
        }
        return isStaff;
      }),
    [canAccessCurriculumRoadmap, isStaff],
  );
  const currentViewMeta = useMemo(
    () =>
      visibleViews.find(
        (view) =>
          view.id ===
          (TIMETABLE_VIEW_IDS.includes(currentView)
            ? "timetable"
            : currentView),
      ) || NAV_VIEWS[0],
    [currentView, visibleViews],
  );
  const currentTimetableTab = useMemo(
    () =>
      TIMETABLE_TABS.find((tab) => tab.id === currentView) || TIMETABLE_TABS[0],
    [currentView],
  );
  const currentViewLabel = TIMETABLE_VIEW_IDS.includes(currentView)
    ? currentTimetableTab.label
    : currentViewMeta.label;
  const dashboardViewSummaryMeta =
    DASHBOARD_VIEW_SUMMARIES[
    TIMETABLE_VIEW_IDS.includes(currentView) ? "timetable" : currentView
    ] || DASHBOARD_VIEW_SUMMARIES.stats;
  const sidebarWorkspaceViews = useMemo(
    () => visibleViews.filter((view) => !MANAGER_VIEW_TAB_MAP[view.id]),
    [visibleViews],
  );
  const sidebarManagerViews = useMemo(
    () => visibleViews.filter((view) => MANAGER_VIEW_TAB_MAP[view.id]),
    [visibleViews],
  );
  const timetableSummaryTokens = useMemo(() => {
    const tokens = [];
    if (timetableFilters.term || currentTermName) {
      tokens.push(`???욋뵛 鸚?${timetableFilters.term || currentTermName}`);
    }
    if (timetableFilters.subject.length > 0) {
      tokens.push(
        ...timetableFilters.subject
          .slice(0, 2)
          .map((value) => `??λ닑??鸚?${value}`),
      );
    }
    if (currentView === "teacher-weekly" && timetableFilters.teacher.length > 0) {
      tokens.push(
        ...timetableFilters.teacher
          .slice(0, 1)
          .map((value) => `??ル―臾??鸚?${value}`),
      );
    }
    if (currentView === "classroom-weekly" && timetableFilters.classroom.length > 0) {
      tokens.push(
        ...timetableFilters.classroom
          .slice(0, 1)
          .map((value) => `?띠룆踰???鸚?${value}`),
      );
    }
    if (
      (currentView === "daily-teacher" || currentView === "daily-classroom") &&
      timetableFilters.day.length > 0
    ) {
      tokens.push(...timetableFilters.day.slice(0, 1).map((value) => `??븐슦逾?鸚?${value}`));
    }
    tokens.push(`${filteredClasses.length}????琉우뵜`);
    return tokens;
  }, [
    currentView,
    currentTermName,
    filteredClasses.length,
    timetableFilters.classroom,
    timetableFilters.day,
    timetableFilters.subject,
    timetableFilters.teacher,
    timetableFilters.term,
  ]);
  const activeBottomNavTab = useMemo(() => {
    if (TIMETABLE_VIEW_IDS.includes(currentView)) {
      return "timetable";
    }

    if (currentView === "academic-calendar") {
      return "academic-calendar";
    }

    if (currentView === "class-schedule") {
      return "class-schedule";
    }

    if (currentView === "curriculum-roadmap") {
      return "curriculum-roadmap";
    }

    if (MANAGER_VIEW_TAB_MAP[currentView]) {
      return currentView;
    }

    return "stats";
  }, [currentView]);
  const bottomNavItems = useMemo(
    () =>
      DASHBOARD_BOTTOM_NAV_ITEMS.filter((item) => {
        const canAccessItem =
          !item.staffOnly ||
          isStaff ||
          (item.id === "curriculum-roadmap" && canAccessCurriculumRoadmap);
        return canAccessItem && (!item.desktopOnly || !isMobile);
      }),
    [canAccessCurriculumRoadmap, isMobile, isStaff],
  );

  const displayUserName = user?.name || user?.email || "\uC0AC\uC6A9\uC790"; const isDataBootstrapping = data.isLoading && !data.lastUpdated;
  const isUnifiedTimetableView = TIMETABLE_VIEW_IDS.includes(currentView);
  useEffect(() => {
    setTimetableExportRequest(null);
  }, [currentView]);
  const timetableDefaultStatus = timetableFilters.term
    ? periodMeta[timetableFilters.term]?.status || ACTIVE_CLASS_STATUS
    : ACTIVE_CLASS_STATUS;
  const timetableDefaultPeriod = timetableFilters.term || currentTermName || "";
  const timetableTopFilterConfig = useMemo(() => {
    if (!isUnifiedTimetableView) {
      return null;
    }

    const baseConfig = {
      termOptions: managedTerms,
      currentTermLabel: currentTermName,
      selectedTerm: timetableFilters.term,
      onTermChange: (nextValue) =>
        handleTimetableFilterChange("term", nextValue),
      subjectOptions,
      selectedSubjectValues: timetableFilters.subject,
      onSubjectChange: (nextValues) =>
        handleTimetableFilterChange("subject", nextValues),
      gridCount: timetableGridColumns,
      onGridCountChange: (nextCount) =>
        setTimetableGridColumns(Math.min(2, Math.max(1, Number(nextCount) || 2))),
      onExportImage: () =>
        setTimetableExportRequest({
          view: currentView,
          nonce: Date.now(),
        }),
    };

    if (currentView === "teacher-weekly") {
      return {
        ...baseConfig,
        axisLabel: "\uC120\uC0DD\uB2D8",
        axisOptions: teacherOptions,
        selectedAxisValues: timetableFilters.teacher,
        onAxisChange: (nextValues) =>
          handleTimetableFilterChange("teacher", nextValues),
        axisAlignment: "fluid",
      };
    }

    if (currentView === "classroom-weekly") {
      return {
        ...baseConfig,
        axisLabel: "\uAC15\uC758\uC2E4",
        axisOptions: classroomOptions,
        selectedAxisValues: timetableFilters.classroom,
        onAxisChange: (nextValues) =>
          handleTimetableFilterChange("classroom", nextValues),
        axisAlignment: "fluid",
      };
    }

    if (currentView === "daily-teacher" || currentView === "daily-classroom") {
      return {
        ...baseConfig,
        axisLabel: "\uC694\uC77C",
        axisOptions: DAY_LABELS,
        selectedAxisValues: timetableFilters.day,
        onAxisChange: (nextValues) =>
          handleTimetableFilterChange("day", nextValues),
        axisAlignment: "fixed",
      };
    }

    return null;
  }, [
    classroomOptions,
    currentTermName,
    currentView,
    handleTimetableFilterChange,
    isUnifiedTimetableView,
    managedTerms,
    subjectOptions,
    teacherOptions,
    timetableFilters.classroom,
    timetableFilters.day,
    timetableFilters.subject,
    timetableFilters.teacher,
    timetableFilters.term,
    timetableGridColumns,
  ]);

  const toggleTheme = () =>
    setTheme((current) => (current === "light" ? "dark" : "light"));
  const clearSubjectFlyoutCloseTimer = () => {
    if (subjectFlyoutCloseTimerRef.current) {
      window.clearTimeout(subjectFlyoutCloseTimerRef.current);
      subjectFlyoutCloseTimerRef.current = null;
    }
  };
  const clearPeriodFlyoutCloseTimer = () => {
    if (periodFlyoutCloseTimerRef.current) {
      window.clearTimeout(periodFlyoutCloseTimerRef.current);
      periodFlyoutCloseTimerRef.current = null;
    }
  };
  const openSidebarTooltip = (event, label) => {
    if (!showMinimalSidebar || !label) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setSidebarTooltip({
      label,
      top: rect.top + rect.height / 2,
      left: rect.right + 14,
    });
  };
  const closeSidebarTooltip = () => {
    setSidebarTooltip(null);
  };
  const openSubjectFlyout = (event) => {
    if (!showMinimalSidebar) {
      return;
    }
    clearSubjectFlyoutCloseTimer();
    clearPeriodFlyoutCloseTimer();
    const rect = event.currentTarget.getBoundingClientRect();
    setSubjectFlyoutAnchor({
      top: rect.top + rect.height / 2,
      left: rect.right + 14,
    });
    setIsSubjectFlyoutOpen(true);
    setIsPeriodFlyoutOpen(false);
    setSidebarTooltip(null);
  };
  const scheduleCloseSubjectFlyout = () => {
    clearSubjectFlyoutCloseTimer();
    subjectFlyoutCloseTimerRef.current = window.setTimeout(() => {
      setIsSubjectFlyoutOpen(false);
    }, 100);
  };
  const openPeriodFlyout = (event) => {
    if (!showMinimalSidebar) {
      return;
    }
    clearPeriodFlyoutCloseTimer();
    clearSubjectFlyoutCloseTimer();
    const rect = event.currentTarget.getBoundingClientRect();
    setPeriodFlyoutAnchor({
      top: rect.top + rect.height / 2,
      left: rect.right + 14,
    });
    setIsPeriodFlyoutOpen(true);
    setIsSubjectFlyoutOpen(false);
    setSidebarTooltip(null);
  };
  const scheduleClosePeriodFlyout = () => {
    clearPeriodFlyoutCloseTimer();
    periodFlyoutCloseTimerRef.current = window.setTimeout(() => {
      setIsPeriodFlyoutOpen(false);
    }, 100);
  };
  const selectPeriodFromFlyout = (period) => {
    setSelectedPeriod(period);
    localStorage.setItem("selectedPeriod", period);
    setFilterMode("period");
    localStorage.setItem("filterMode", "period");
    setIsPeriodFlyoutOpen(false);
  };
  const navigateMobileTab = (tabId) => {
    if (tabId === "timetable") {
      startTransition(() => {
        setCurrentView((current) =>
          TIMETABLE_VIEW_IDS.includes(current) ? current : DEFAULT_TIMETABLE_VIEW,
        );
      });
      return;
    }

    if (tabId === "curriculum-roadmap") {
      openCurriculumRoadmap();
      return;
    }

    changeView(tabId, { closeSidebar: false });
  };

  const setFilterModeAndPersist = (mode) => {
    setFilterMode(mode);
    localStorage.setItem("filterMode", mode);
  };

  const setPublicModeAndSync = (next) => {
    const applyModeChange = () => {
      setIsPublicMode(next);
      replacePublicMode(next);
      if (!next) {
        setCurrentView(defaultDashboardView);
        setSidebarOpen(!isCompact);
      }
    };

    if (
      typeof document !== "undefined" &&
      typeof document.startViewTransition === "function"
    ) {
      const root = document.documentElement;
      root.dataset.shellTransition = next ? "to-public" : "to-dashboard";

      const transition = document.startViewTransition(() => {
        flushSync(() => {
          applyModeChange();
        });
      });

      transition.finished.finally(() => {
        delete root.dataset.shellTransition;
      });
      return;
    }

    applyModeChange();
  };

  const openStudentSchedule = () => {
    changeView(DEFAULT_TIMETABLE_VIEW, { closeSidebar: false });
  };

  const renderTimetableTabs = ({ compact = false } = {}) => (
    <Tab
      size={compact ? "small" : "large"}
      fluid={compact}
      value={currentView}
      onChange={(nextView) => changeView(nextView, { closeSidebar: false })}
      items={TIMETABLE_TABS.map((tab) => ({
        value: tab.id,
        label: tab.label,
        title: tab.description,
        testId: `dashboard-timetable-tab-${tab.id}`,
        className: "dashboard-timetable-tab-item",
      }))}
      className={`dashboard-workspace-tab-row dashboard-timetable-tab-row ${compact ? "is-compact" : ""}`}
      data-testid="dashboard-timetable-tabs"
    />
  );

  const renderTimetableTopFilterBar = ({ compact = false } = {}) =>
    timetableTopFilterConfig ? (
      <TimetableTopFilterBar
        compact={compact}
        {...timetableTopFilterConfig}
      />
    ) : null;

  const renderPeriodDropdown = () => (
    <div className="period-dropdown-shell">
      <button
        type="button"
        className="custom-dropdown-btn"
        aria-haspopup="listbox"
        aria-expanded={isPeriodDropdownOpen}
        aria-controls="period-dropdown-menu"
        onClick={() => setIsPeriodDropdownOpen((current) => !current)}
      >
        <span className="period-dropdown-current">{selectedPeriod}</span>
        <ChevronDown
          size={16}
          className={`period-dropdown-caret ${isPeriodDropdownOpen ? "is-open" : ""}`}
          aria-hidden="true"
          focusable="false"
        />
      </button>
      {isPeriodDropdownOpen && (
        <>
          <button
            type="button"
            className="shell-overlay"
            aria-label="???욋뵛 ??ルㅎ臾????뗢뵛"
            onClick={() => setIsPeriodDropdownOpen(false)}
          />
          <div
            id="period-dropdown-menu"
            className="custom-dropdown-menu animate-in period-dropdown-menu"
          >
            <div className="dropdown-scroll-area">
              {periods.map((period) => (
                <button
                  key={period}
                  type="button"
                  className={`custom-dropdown-item ${selectedPeriod === period ? "active" : ""}`}
                  aria-pressed={selectedPeriod === period}
                  aria-label={`???욋뵛 ${period}`}
                  onClick={() => {
                    setSelectedPeriod(period);
                    localStorage.setItem("selectedPeriod", period);
                    setIsPeriodDropdownOpen(false);
                  }}
                >
                  <div className="period-dropdown-item-head">
                    <span>{period}</span>
                    {period !== ALL_OPTION && periodMeta[period]?.status ? (
                      <span className="period-dropdown-status">
                        {periodMeta[period].status}
                      </span>
                    ) : null}
                  </div>
                  {period !== ALL_OPTION && periodMeta[period] && (
                    <div className="period-dropdown-detail">
                      {[
                        periodMeta[period].academicYear,
                        periodMeta[period].startDate || "-",
                        periodMeta[period].endDate || "-",
                      ]
                        .filter(Boolean)
                        .join(" 鸚?")
                        .replace(
                          / 鸚?([0-9]{4}-[0-9]{2}-[0-9]{2}) 鸚?([0-9]{4}-[0-9]{2}-[0-9]{2})$/,
                          " 鸚?$1 ~ $2",
                        )}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );

  if (loading) {
    return (
      <PageLoader
        title="TIPS 대시보드를 준비하는 중입니다"
        message="로그인 정보와 접근 권한을 확인하는 동안 잠시만 기다려 주세요."
      />
    );
  }

  const publicView = (
    <div className="public-app-shell" data-design-system="toss-refresh">
      {statusBanner && (
        <div className="public-mode-status-banner">
          <StatusBanner
            compact
            eyebrow="\uACF5\uAC1C \uBAA8\uB4DC"
            title={statusBanner.title}
            message={statusBanner.message}
            variant={statusBanner.variant}
          />
        </div>
      )}
      <Suspense
        fallback={
          <PageLoader
            title="공개 수업 화면을 불러오는 중입니다"
            message="최신 공개 수업 목록과 시간표를 차례대로 준비하고 있습니다."
          />
        }
      >
        <PublicClassListView
          classes={data.classes}
          textbooks={data.textbooks}
          progressLogs={data.progressLogs}
          isLoading={isDataBootstrapping}
          onLogin={() => setShowLogin(true)}
          showBackToDashboard={Boolean(user)}
          onBackToDashboard={() => setPublicModeAndSync(false)}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      </Suspense>
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
      <ChangePasswordModal open={Boolean(user && mustChangePassword)} />
    </div>
  );

  if (!user || !canAccessDashboard || isPublicMode) {
    return publicView;
  }

  if (isDataBootstrapping) {
    return (
      <PageLoader
        title="데이터를 불러오는 중입니다"
        message="Supabase에서 수업, 학생, 교재 데이터를 동기화하고 있습니다."
      />
    );
  }

  return (
    <div
      className={`app-layout ${dashboardShellLayoutClass} ${forceDesktopLayout ? "app-layout-force-desktop" : ""} ${isMobile ? "app-layout-mobile" : ""} ${isTablet ? "app-layout-tablet" : ""} ${showMinimalSidebar ? "sidebar-hidden" : ""}`}
      data-design-system="toss-refresh"
      data-testid="app-shell-root"
    >
      {hasDesktopSidebar ? (
        <aside className="sidebar" data-testid="dashboard-sidebar">
          <div className="sidebar-header">
            <div className="sidebar-header-shell">
              <div className="sidebar-logo sidebar-logo-shell">
                <button
                  type="button"
                  className="sidebar-brand-button"
                  data-testid="dashboard-sidebar-home"
                  onClick={goHome}
                >
                  <img
                    src="/logo_tips.png"
                    alt="TIPS"
                    className="sidebar-brand-mark sidebar-logo-mark"
                  />
                  <div className="sidebar-logo-text">
                    <p className="sidebar-brand-eyebrow">{displayUserName}</p>
                    <h1 className="sidebar-brand-title">TIPS Dashboard</h1>
                  </div>
                </button>
              </div>

              {statusBanner ? (
                <StatusBanner
                  compact
                  eyebrow="상태 알림"
                  title={statusBanner.title}
                  message={statusBanner.message}
                  variant={statusBanner.variant}
                />
              ) : null}
            </div>
          </div>

          <nav className="sidebar-nav" data-testid="dashboard-sidebar-nav">
            <div className="sidebar-nav-section">워크스페이스</div>
            {sidebarWorkspaceViews.map((view) => (
              <button
                key={view.id}
                type="button"
                data-testid={`mobile-nav-${view.id}`}
                className={`sidebar-nav-item ${activeBottomNavTab === view.id ? "active" : ""}`}
                aria-current={activeBottomNavTab === view.id ? "page" : undefined}
                aria-label={view.label}
                data-tooltip={showMinimalSidebar ? view.label : undefined}
                onMouseEnter={(event) => openSidebarTooltip(event, view.label)}
                onMouseLeave={closeSidebarTooltip}
                onClick={() => navigateMobileTab(view.id)}
              >
                <span className="sidebar-link-icon" aria-hidden="true">
                  <FilledNavIcon
                    name={view.id}
                    fallbackIcon={view.icon}
                    size={20}
                  />
                </span>
                <span>{view.label}</span>
              </button>
            ))}

            {sidebarManagerViews.length > 0 ? (
              <>
                <div className="sidebar-nav-section">관리</div>
                {sidebarManagerViews.map((view) => (
                  <button
                    key={view.id}
                    type="button"
                    data-testid={`mobile-nav-${view.id}`}
                    className={`sidebar-nav-item ${activeBottomNavTab === view.id ? "active" : ""}`}
                    aria-current={
                      activeBottomNavTab === view.id ? "page" : undefined
                    }
                    aria-label={view.label}
                    data-tooltip={showMinimalSidebar ? view.label : undefined}
                    onMouseEnter={(event) =>
                      openSidebarTooltip(event, view.label)
                    }
                    onMouseLeave={closeSidebarTooltip}
                    onClick={() => navigateMobileTab(view.id)}
                  >
                    <span className="sidebar-link-icon" aria-hidden="true">
                      <FilledNavIcon
                        name={view.id}
                        fallbackIcon={view.icon}
                        size={20}
                      />
                    </span>
                    <span>{view.label}</span>
                  </button>
                ))}
              </>
            ) : null}
          </nav>

          <div className="sidebar-footer sidebar-footer-shell">
            <button
              type="button"
              className="sidebar-nav-item sidebar-footer-action"
              data-testid="app-bottom-nav-theme"
              onClick={toggleTheme}
              title={
                theme === "light"
                  ? "다크 모드로 변경"
                  : "라이트 모드로 변경"
              }
              aria-label={
                theme === "light"
                  ? "다크 모드로 변경"
                  : "라이트 모드로 변경"
              }
            >
              <span className="sidebar-link-icon" aria-hidden="true">
                {theme === "light" ? (
                  <Moon size={19} strokeWidth={2.1} />
                ) : (
                  <Sun size={19} strokeWidth={2.1} />
                )}
              </span>
              <span>{theme === "light" ? "다크 모드" : "라이트 모드"}</span>
            </button>
            <button
              type="button"
              className="sidebar-nav-item sidebar-footer-action"
              data-testid="app-bottom-nav-public"
              onClick={() => setPublicModeAndSync(true)}
              title="공개 페이지 열기"
              aria-label="공개 페이지 열기"
            >
              <span className="sidebar-link-icon" aria-hidden="true">
                <Eye size={19} strokeWidth={2.1} />
              </span>
              <span>공개 페이지</span>
            </button>
            <button
              type="button"
              className="sidebar-nav-item sidebar-footer-action sidebar-footer-action-danger"
              data-testid="app-bottom-nav-logout"
              onClick={logout}
              title="로그아웃"
              aria-label="로그아웃"
            >
              <span
                className="sidebar-link-icon sidebar-link-icon-danger"
                aria-hidden="true"
              >
                <LogOut size={19} strokeWidth={2.1} />
              </span>
              <span>로그아웃</span>
            </button>
          </div>
        </aside>
      ) : null}

      <main
        className={`main-content ${isMobile ? "main-content-mobile" : ""} ${isTablet ? "main-content-tablet" : ""} ${currentView === "academic-calendar" ? "main-content-academic-calendar" : ""}`}
      >
        {statusBanner && !isMobile && (
          <div className="shell-status-banner shell-status-banner-desktop">
            <StatusBanner
              compact
              eyebrow="상태 알림"
              title={statusBanner.title}
              message={statusBanner.message}
              variant={statusBanner.variant}
            />
          </div>
        )}

        {statusBanner && isMobile && (
          <div className="shell-status-banner shell-status-banner-mobile">
            <StatusBanner
              compact
              eyebrow="\uC0C1\uD0DC \uC54C\uB9BC"
              title={statusBanner.title}
              message={statusBanner.message}
              variant={statusBanner.variant}
            />
          </div>
        )}

        <Suspense
          fallback={
            <PageLoader
              title="화면을 준비하는 중입니다"
              message="필요한 모듈과 데이터를 순서대로 불러오고 있습니다."
            />
          }
        >
          <div>
            {false ? (
              <div
                className="app-mobile-academic-switcher workspace-tabs workspace-tabs-compact"
                data-testid="mobile-academic-switcher"
              >
                <button
                  type="button"
                  className={`h-segment-btn workspace-tab-btn ${currentView === "academic-calendar" ? "active" : ""}`}
                  aria-pressed={currentView === "academic-calendar"}
                  data-testid="mobile-academic-tab-calendar"
                  onClick={() =>
                    changeView("academic-calendar", { closeSidebar: false })
                  }
                >
                  <CalendarDays size={16} className="workspace-tab-icon" />
                  <span>\uCEA8\uB9B0\uB354</span>
                </button>
                <button
                  type="button"
                  className={`h-segment-btn workspace-tab-btn ${currentView === "curriculum-roadmap" ? "active" : ""}`}
                  aria-pressed={currentView === "curriculum-roadmap"}
                  data-testid="mobile-academic-tab-roadmap"
                  onClick={() => openCurriculumRoadmap()}
                >
                  <BookOpen size={16} className="workspace-tab-icon" />
                  <span>\uC5F0\uAC04 \uC77C\uC815\uD45C</span>
                </button>
              </div>
            ) : null}

            {TIMETABLE_VIEW_IDS.includes(currentView) && (
              <section
                className="app-shell-panel dashboard-workspace-block dashboard-workspace-block-timetable"
                data-testid="shell-timetable-section"
              >
                <div
                  className={`dashboard-headless-toolbar dashboard-headless-toolbar-timetable ${isCompact ? "is-compact" : ""}`}
                  data-testid="timetable-headless-toolbar"
                >
                  {renderTimetableTabs({ compact: isCompact })}
                  {isCompact && isUnifiedTimetableView ? (
                    <div className="dashboard-headless-toolbar__actions">
                      <button
                        type="button"
                        className="action-chip"
                        data-testid="timetable-filter-button"
                        onClick={() => setIsTimetableFilterSheetOpen(true)}
                      >
                        <Settings2 size={16} />
                        ?熬곥굤??                      </button>
                    </div>
                  ) : null}
                  {!isCompact && isUnifiedTimetableView
                    ? renderTimetableTopFilterBar()
                    : null}
                </div>
              </section>
            )}
            {currentView === "stats" && (
              <StatsDashboard
                classes={data.classes || []}
                data={data}
                dataService={activeDataService}
                onViewStudentSchedule={openStudentSchedule}
              />
            )}
            {currentView === "classroom-weekly" && (
              <ClassroomWeeklyView
                classes={filteredClasses}
                allClasses={weeklyAxisClasses}
                data={data}
                dataService={activeDataService}
                onViewStudentSchedule={openStudentSchedule}
                defaultStatus={timetableDefaultStatus}
                defaultPeriod={timetableDefaultPeriod}
                termKey={timetableDefaultPeriod || "workspace"}
                termStatus={timetableDefaultStatus}
                terms={managedTerms}
                embedded
                floatingFilters={false}
                selectedClassroomNames={timetableFilters.classroom}
                desktopGridColumns={timetableGridColumns}
                exportRequest={timetableExportRequest}
                onExportHandled={() => setTimetableExportRequest(null)}
              />
            )}
            {currentView === "teacher-weekly" && (
              <TeacherWeeklyView
                classes={filteredClasses}
                allClasses={weeklyAxisClasses}
                data={data}
                dataService={activeDataService}
                onViewStudentSchedule={openStudentSchedule}
                defaultStatus={timetableDefaultStatus}
                defaultPeriod={timetableDefaultPeriod}
                termKey={timetableDefaultPeriod || "workspace"}
                termStatus={timetableDefaultStatus}
                terms={managedTerms}
                embedded
                floatingFilters={false}
                selectedTeacherNames={timetableFilters.teacher}
                desktopGridColumns={timetableGridColumns}
                exportRequest={timetableExportRequest}
                onExportHandled={() => setTimetableExportRequest(null)}
              />
            )}
            {currentView === "daily-classroom" && (
              <DailyClassroomView
                classes={filteredClasses}
                allClasses={weeklyAxisClasses}
                data={data}
                dataService={activeDataService}
                defaultStatus={timetableDefaultStatus}
                defaultPeriod={timetableDefaultPeriod}
                termKey={timetableDefaultPeriod || "workspace"}
                termStatus={timetableDefaultStatus}
                terms={managedTerms}
                embedded
                floatingFilters={false}
                selectedClassroomNames={classroomOptions}
                selectedDayKeys={timetableFilters.day}
                desktopGridColumns={timetableGridColumns}
                exportRequest={timetableExportRequest}
                onExportHandled={() => setTimetableExportRequest(null)}
              />
            )}
            {currentView === "daily-teacher" && (
              <DailyTeacherView
                classes={filteredClasses}
                allClasses={weeklyAxisClasses}
                data={data}
                dataService={activeDataService}
                defaultStatus={timetableDefaultStatus}
                defaultPeriod={timetableDefaultPeriod}
                termKey={timetableDefaultPeriod || "workspace"}
                termStatus={timetableDefaultStatus}
                terms={managedTerms}
                embedded
                floatingFilters={false}
                selectedTeacherNames={teacherOptions}
                selectedDayKeys={timetableFilters.day}
                desktopGridColumns={timetableGridColumns}
                exportRequest={timetableExportRequest}
                onExportHandled={() => setTimetableExportRequest(null)}
              />
            )}
            {currentView === "academic-calendar" && (
              <AcademicCalendarView
                data={data}
                dataService={activeDataService}
                onOpenRoadmap={openCurriculumRoadmap}
                navigationIntent={academicCalendarIntent}
              />
            )}
            {currentView === "class-schedule" && (
              <ClassScheduleWorkspaceBoundary
                resetKey={`${currentView}:${data.lastUpdated || ""}:${(data.classes || []).length}`}
              >
                <ClassScheduleWorkspace
                  data={data}
                  dataService={activeDataService}
                  managedTerms={managedTerms}
                  currentTermLabel={currentTermName}
                  onOpenClassManager={() =>
                    changeView("classes-manager", { closeSidebar: false })
                  }
                  onOpenPublicPage={() => setPublicModeAndSync(true)}
                  onSyncNow={() => { }}
                />
              </ClassScheduleWorkspaceBoundary>
            )}
            {currentView === "curriculum-roadmap" && (
              <CurriculumProgressWorkspace
                data={data}
                dataService={activeDataService}
              />
            )}
            {MANAGER_VIEW_TAB_MAP[currentView] && (
              <DataManager
                key={currentView}
                data={data}
                dataService={activeDataService}
                onOpenCurriculum={() => openCurriculumRoadmap()}
                onOpenTermManager={() => setIsTermManagerOpen(true)}
                fixedTab={MANAGER_VIEW_TAB_MAP[currentView]}
                hideTabRow
              />
            )}
          </div>
        </Suspense>
      </main>

      <TermManagerModal
        open={isTermManagerOpen}
        terms={managedTerms}
        classes={data.classes || []}
        dataService={activeDataService}
        currentTermPreference={currentTermPreference}
        onClose={() => setIsTermManagerOpen(false)}
        onSaved={(savedTerms = [], nextCurrentTerm = null) => {
          setLocalTerms(savedTerms || []);
          persistCurrentTermPreference(nextCurrentTerm);
          setIsTermManagerOpen(false);
        }}
      />

      <BottomSheet
        open={Boolean(
          isCompact && isUnifiedTimetableView && isTimetableFilterSheetOpen,
        )}
        onClose={() => setIsTimetableFilterSheetOpen(false)}
        title="\uC2DC\uAC04\uD45C \uD544\uD130"
        subtitle="???욋뵛, ??ル‘?, ??λ닑???リ옇????????븐뻼???????브퀗?????????곕????덈펲."
        testId="timetable-filter-sheet"
      >
        <div className="timetable-filter-sheet-stack">
          {renderTimetableTopFilterBar({ compact: true })}
        </div>
      </BottomSheet>

      {user && !isPublicMode && useBottomNavShell ? (
        <nav
          className="public-bottom-nav mobile-bottom-nav dashboard-shell-bottom-nav dashboard-shell-bottom-nav-unified"
          data-testid="app-bottom-nav"
          style={{ "--dashboard-bottom-nav-item-count": bottomNavItems.length }}
        >
          {!isMobile ? (
            <div
              className="dashboard-shell-bottom-nav-leading"
              data-testid="dashboard-bottom-nav-leading"
            >
              <button
                type="button"
                className="public-topbar-icon-button dashboard-shell-utility-slot dashboard-shell-utility-slot-danger"
                data-testid="app-bottom-nav-logout"
                onClick={logout}
                title="\uB85C\uADF8\uC544\uC6C3"
                aria-label="\uB85C\uADF8\uC544\uC6C3"
              >
                <LogOut size={18} />
              </button>
            </div>
          ) : null}

          <div className="dashboard-shell-bottom-nav-grid">
            {bottomNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`mobile-nav-${item.id}`}
                  className={`public-bottom-nav-button mobile-bottom-nav-item dashboard-shell-bottom-nav-button ${activeBottomNavTab === item.id ? "is-active active" : ""}`}
                  aria-current={
                    activeBottomNavTab === item.id ? "page" : undefined
                  }
                  aria-label={item.label}
                  onClick={() => navigateMobileTab(item.id)}
                >
                  <FilledNavIcon
                    name={item.id}
                    fallbackIcon={Icon}
                    size={20}
                  />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {!isMobile ? (
            <div
              className="dashboard-shell-bottom-nav-actions"
              data-testid="dashboard-bottom-nav-actions"
            >
              <button
                type="button"
                className="public-topbar-icon-button dashboard-shell-utility-slot"
                data-testid="app-bottom-nav-theme"
                onClick={toggleTheme}
                title={
                  theme === "light"
                    ? "\uB2E4\uD06C \uBAA8\uB4DC\uB85C \uBCC0\uACBD"
                    : "\uB77C\uC774\uD2B8 \uBAA8\uB4DC\uB85C \uBCC0\uACBD"
                }
                aria-label={
                  theme === "light"
                    ? "\uB2E4\uD06C \uBAA8\uB4DC\uB85C \uBCC0\uACBD"
                    : "\uB77C\uC774\uD2B8 \uBAA8\uB4DC\uB85C \uBCC0\uACBD"
                }
              >
                {theme === "light" ? <Moon size={19} strokeWidth={2.1} /> : <Sun size={19} strokeWidth={2.1} />}
              </button>
              <button
                type="button"
                className="public-topbar-icon-button public-topbar-logo-button dashboard-shell-utility-slot"
                data-testid="app-bottom-nav-public"
                onClick={() => setPublicModeAndSync(true)}
                title="\uACF5\uAC1C \uD398\uC774\uC9C0 \uC5F4\uAE30"
                aria-label="\uACF5\uAC1C \uD398\uC774\uC9C0 \uC5F4\uAE30"
              >
                <img src="/logo_tips.png" alt="TIPS" />
              </button>
            </div>
          ) : null}
        </nav>
      ) : null}

      {user && !isPublicMode && isMobile ? (
        <div
          className="dashboard-shell-floating-actions"
          data-testid="dashboard-floating-actions"
        >
          <button
            type="button"
            className="public-topbar-icon-button dashboard-shell-utility-slot"
            data-testid="app-bottom-nav-theme"
            onClick={toggleTheme}
            title={
              theme === "light" ? "\uB2E4\uD06C \uBAA8\uB4DC\uB85C \uBCC0\uACBD" : "\uB77C\uC774\uD2B8 \uBAA8\uB4DC\uB85C \uBCC0\uACBD"
            }
            aria-label={
              theme === "light" ? "\uB2E4\uD06C \uBAA8\uB4DC\uB85C \uBCC0\uACBD" : "\uB77C\uC774\uD2B8 \uBAA8\uB4DC\uB85C \uBCC0\uACBD"
            }
          >
            {theme === "light" ? <Moon size={19} strokeWidth={2.1} /> : <Sun size={19} strokeWidth={2.1} />}
          </button>
          <button
            type="button"
            className="public-topbar-icon-button public-topbar-logo-button dashboard-shell-utility-slot"
            data-testid="app-bottom-nav-public"
            onClick={() => setPublicModeAndSync(true)}
            title="\uACF5\uAC1C \uD398\uC774\uC9C0 \uC5F4\uAE30"
            aria-label="\uACF5\uAC1C \uD398\uC774\uC9C0 \uC5F4\uAE30"
          >
            <img src="/logo_tips.png" alt="TIPS" />
          </button>
        </div>
      ) : null}

      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
      <ChangePasswordModal open={Boolean(user && mustChangePassword)} />
    </div>
  );
}
