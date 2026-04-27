"use client";

export const DEFAULT_PERIOD_STORAGE_KEY = "tips-dashboard-default-period";

export type DefaultPeriodPreference = {
  id?: string;
  name?: string;
};

function text(value: unknown) {
  return String(value || "").trim();
}

export function readDefaultPeriodPreference(): DefaultPeriodPreference {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(DEFAULT_PERIOD_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as DefaultPeriodPreference;
    return {
      id: text(parsed?.id),
      name: text(parsed?.name),
    };
  } catch {
    return {};
  }
}

export function writeDefaultPeriodPreference(preference: DefaultPeriodPreference) {
  if (typeof window === "undefined") {
    return;
  }

  const nextPreference = {
    id: text(preference.id),
    name: text(preference.name),
  };

  try {
    window.localStorage.setItem(DEFAULT_PERIOD_STORAGE_KEY, JSON.stringify(nextPreference));
  } catch {
    // Keep the UI responsive even when browser storage is unavailable.
  }
}

export function pickDefaultPeriodValue<T extends { value: string; label: string; aliases?: string[] }>(
  options: T[],
) {
  if (options.length === 0) {
    return "";
  }

  const preference = readDefaultPeriodPreference();
  return (
    options.find((option) => {
      const aliases = Array.isArray(option.aliases) ? option.aliases.map(text) : [];
      return (
        option.value === preference.id ||
        option.label === preference.name ||
        aliases.includes(text(preference.id)) ||
        aliases.includes(text(preference.name))
      );
    })?.value ||
    options[0].value
  );
}
