import fs from "node:fs";
import path from "node:path";

function trimEnvValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const parsed = {};
  const content = fs.readFileSync(filePath, "utf8");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = unquote(line.slice(separatorIndex + 1).trim());
    if (!key) {
      continue;
    }

    parsed[key] = value;
  }

  return parsed;
}

function loadTipsEnvFiles(appDir) {
  const fileOrder = [
    path.join(appDir, ".env"),
    path.join(appDir, ".env.local"),
  ];

  return fileOrder.reduce((accumulator, filePath) => {
    return { ...accumulator, ...parseEnvFile(filePath) };
  }, {});
}

export function resolveTipsPublicEnv(
  env = process.env,
  { appDir = process.cwd() } = {},
) {
  const fileEnv = loadTipsEnvFiles(appDir);
  const mergedEnv = { ...fileEnv, ...env };

  return {
    NEXT_PUBLIC_SUPABASE_URL: trimEnvValue(
      mergedEnv.NEXT_PUBLIC_SUPABASE_URL || mergedEnv.VITE_SUPABASE_URL,
    ),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: trimEnvValue(
      mergedEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY || mergedEnv.VITE_SUPABASE_ANON_KEY,
    ),
  };
}
