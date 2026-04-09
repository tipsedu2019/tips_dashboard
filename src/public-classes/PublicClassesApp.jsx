import { useEffect, useState } from "react";

import { ToastProvider } from "../contexts/ToastContext";
import PublicClassLandingView from "../components/PublicClassLandingView";

const PUBLIC_CLASSES_DATA_PATH = "/data/public-classes.json";
const THEME_STORAGE_KEY = "tips-public-theme";

function getInitialPublicTab() {
  if (typeof document !== "undefined") {
    const declaredTab = document.documentElement.dataset.publicTab;
    if (declaredTab) {
      return declaredTab;
    }
  }

  if (typeof window !== "undefined") {
    const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
    if (pathname === "/") {
      return "home";
    }
    if (pathname === "/reviews") {
      return "reviews";
    }
    if (pathname === "/results") {
      return "scores";
    }
  }

  return "classes";
}

function getInitialTheme() {
  if (typeof window === "undefined") {
    return "light";
  }

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") {
    return stored;
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches
    ? "dark"
    : "light";
}

function applyTheme(theme) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.setAttribute("data-theme", theme);
}

function PublicClassesShell() {
  const [theme, setTheme] = useState(getInitialTheme);
  const [initialPublicTab] = useState(getInitialPublicTab);
  const [state, setState] = useState({
    isLoading: true,
    classes: [],
    textbooks: [],
    progressLogs: [],
  });

  useEffect(() => {
    applyTheme(theme);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  }, [theme]);

  useEffect(() => {
    let cancelled = false;

    async function loadPublicClasses() {
      try {
        const response = await fetch(PUBLIC_CLASSES_DATA_PATH, {
          headers: {
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to load public classes: ${response.status}`);
        }

        const payload = await response.json();
        if (cancelled) {
          return;
        }

        setState({
          isLoading: false,
          classes: Array.isArray(payload?.classes) ? payload.classes : [],
          textbooks: Array.isArray(payload?.textbooks) ? payload.textbooks : [],
          progressLogs: Array.isArray(payload?.progressLogs)
            ? payload.progressLogs
            : [],
        });
      } catch (error) {
        console.error("[public-classes] failed to load data", error);
        if (cancelled) {
          return;
        }
        setState({
          isLoading: false,
          classes: [],
          textbooks: [],
          progressLogs: [],
        });
      }
    }

    loadPublicClasses();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PublicClassLandingView
      classes={state.classes}
      textbooks={state.textbooks}
      progressLogs={state.progressLogs}
      isLoading={state.isLoading}
      initialPublicTab={initialPublicTab}
      onLogin={() => {
        if (typeof window !== "undefined") {
          window.location.assign("/admin/");
        }
      }}
      theme={theme}
      onToggleTheme={() =>
        setTheme((current) => (current === "dark" ? "light" : "dark"))
      }
    />
  );
}

export default function PublicClassesApp() {
  return (
    <ToastProvider>
      <PublicClassesShell />
    </ToastProvider>
  );
}
