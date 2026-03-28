import { DEFAULT_LOGIN_EMAIL_DOMAIN, normalizeLoginLocalPart } from "../../src/lib/authUtils.js";

const LOGIN_EXCEPTION_SET = new Set(["tipsedu"]);

function cleanText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function getEmailLocalPart(email) {
  const normalizedEmail = cleanText(email);
  if (!normalizedEmail.includes("@")) {
    return normalizedEmail;
  }

  return normalizedEmail.split("@")[0];
}

function isPhoneLikeLogin(value) {
  const normalized = cleanText(value);
  const digits = normalized.replace(/\D/g, "");
  return /^[\d\s()+-]+$/.test(normalized) && digits.length >= 8;
}

export function buildManagedLoginTransition(
  { loginId, email } = {},
  { domain = DEFAULT_LOGIN_EMAIL_DOMAIN } = {},
) {
  const currentLoginId = cleanText(loginId) || getEmailLocalPart(email);
  const currentEmail = cleanText(email);

  if (!currentLoginId || LOGIN_EXCEPTION_SET.has(currentLoginId)) {
    return null;
  }

  if (!isPhoneLikeLogin(currentLoginId)) {
    return null;
  }

  const nextLoginId = normalizeLoginLocalPart(currentLoginId);
  const nextEmail = `${nextLoginId}@${cleanText(domain)}`;

  if (currentLoginId === nextLoginId && currentEmail === nextEmail) {
    return null;
  }

  return {
    currentLoginId,
    currentEmail,
    nextLoginId,
    nextEmail,
  };
}

export function findDuplicateTransitionTargets(transitions = []) {
  const counts = new Map();

  for (const transition of transitions) {
    const nextEmail = cleanText(transition?.nextEmail);
    if (!nextEmail) {
      continue;
    }

    counts.set(nextEmail, (counts.get(nextEmail) || 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([nextEmail]) => nextEmail)
    .sort();
}
