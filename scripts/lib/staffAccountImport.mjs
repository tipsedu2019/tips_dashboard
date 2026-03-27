import fs from "node:fs";

import Papa from "papaparse";

export const ACCOUNT_EMAIL_DOMAIN = "tipsedu.co.kr";
export const DEFAULT_INITIAL_PASSWORD = "tips2019!!";

const MANAGED_ROLES = new Set(["admin", "staff", "teacher"]);

function cleanText(value) {
  return String(value ?? "").replace(/^\uFEFF/, "").trim();
}

export function normalizeManagedRole(value) {
  const role = cleanText(value).toLowerCase();
  if (!MANAGED_ROLES.has(role)) {
    throw new Error(`Unsupported role: ${value}`);
  }
  return role;
}

export function buildStaffAccountRecord(
  row,
  {
    domain = ACCOUNT_EMAIL_DOMAIN,
    password = DEFAULT_INITIAL_PASSWORD,
  } = {},
) {
  const name = cleanText(row?.이름 ?? row?.name);
  const loginId = cleanText(row?.아이디 ?? row?.loginId ?? row?.id);
  const role = normalizeManagedRole(row?.역할 ?? row?.role);

  if (!name) {
    throw new Error("Missing staff name");
  }
  if (!loginId) {
    throw new Error(`Missing login id for ${name}`);
  }

  return {
    name,
    loginId,
    email: `${loginId}@${domain}`,
    role,
    password,
    mustChangePassword: true,
  };
}

export function parseStaffCsvText(text, options = {}) {
  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => cleanText(header),
  });

  if (parsed.errors?.length) {
    const [firstError] = parsed.errors;
    throw new Error(firstError.message || "Failed to parse staff CSV");
  }

  return (parsed.data || [])
    .filter((row) => Object.values(row || {}).some((value) => cleanText(value)))
    .map((row) => buildStaffAccountRecord(row, options));
}

export function decodeStaffCsvBuffer(buffer) {
  const requiredHeaders = ["이름", "아이디", "역할"];
  const encodings = ["utf-8", "euc-kr"];

  for (const encoding of encodings) {
    try {
      const text = new TextDecoder(encoding).decode(buffer);
      if (requiredHeaders.every((header) => text.includes(header))) {
        return text;
      }
    } catch {
      // Try the next encoding.
    }
  }

  return new TextDecoder("utf-8").decode(buffer);
}

export function loadStaffAccountsFromCsvPath(csvPath, options = {}) {
  const buffer = fs.readFileSync(csvPath);
  const text = decodeStaffCsvBuffer(buffer);
  return parseStaffCsvText(text, options);
}

export function summarizeStaffAccounts(accounts = []) {
  const summary = {
    total: accounts.length,
    byRole: {
      admin: 0,
      staff: 0,
      teacher: 0,
    },
  };

  for (const account of accounts) {
    if (summary.byRole[account.role] !== undefined) {
      summary.byRole[account.role] += 1;
    }
  }

  return summary;
}
