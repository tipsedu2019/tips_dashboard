import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import {
  ACCOUNT_EMAIL_DOMAIN,
  DEFAULT_INITIAL_PASSWORD,
  loadStaffAccountsFromCsvPath,
  summarizeStaffAccounts,
} from "./lib/staffAccountImport.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");

function importEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 1) {
      continue;
    }

    const name = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!process.env[name]) {
      process.env[name] = value;
    }
  }
}

function getArgumentMap(argv = process.argv.slice(2)) {
  const args = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const nextValue = argv[index + 1];
    if (!nextValue || nextValue.startsWith("--")) {
      args.set(token, true);
      continue;
    }

    args.set(token, nextValue);
    index += 1;
  }

  return args;
}

function buildSupabaseAdminClient() {
  const url = String(
    process.env.SUPABASE_URL ||
      process.env.VITE_SUPABASE_URL ||
      "",
  ).trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!url) {
    throw new Error("Set SUPABASE_URL or VITE_SUPABASE_URL before running this script.");
  }
  if (!serviceRoleKey) {
    throw new Error("Set SUPABASE_SERVICE_ROLE_KEY before running this script.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function listAllUsers(supabase) {
  const users = [];
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    });

    if (error) {
      throw error;
    }

    const pageUsers = data?.users || [];
    users.push(...pageUsers);

    if (pageUsers.length < 200) {
      return users;
    }

    page += 1;
  }
}

async function upsertAuthUser(supabase, existingUser, account) {
  const authPayload = {
    email: account.email,
    password: account.password,
    email_confirm: true,
    user_metadata: {
      name: account.name,
      login_id: account.loginId,
      role: account.role,
      must_change_password: account.mustChangePassword,
    },
    app_metadata: {
      role: account.role,
    },
  };

  if (existingUser?.id) {
    const { data, error } = await supabase.auth.admin.updateUserById(
      existingUser.id,
      authPayload,
    );

    if (error) {
      throw error;
    }

    return {
      action: "updated",
      user: data?.user || existingUser,
    };
  }

  const { data, error } = await supabase.auth.admin.createUser(authPayload);
  if (error) {
    throw error;
  }

  return {
    action: "created",
    user: data.user,
  };
}

async function upsertProfile(supabase, userId, account) {
  const payload = {
    id: userId,
    name: account.name,
    login_id: account.loginId,
    role: account.role,
    must_change_password: account.mustChangePassword,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("profiles").upsert(payload, {
    onConflict: "id",
  });

  if (!error) {
    return;
  }

  const message = String(error.message || "");
  const canFallback =
    message.includes("name") ||
    message.includes("login_id") ||
    message.includes("must_change_password");

  if (!canFallback) {
    throw error;
  }

  const fallbackPayload = {
    id: userId,
    role: account.role,
    updated_at: new Date().toISOString(),
  };

  const { error: fallbackError } = await supabase.from("profiles").upsert(
    fallbackPayload,
    {
      onConflict: "id",
    },
  );

  if (fallbackError) {
    throw fallbackError;
  }
}

function printSummary(accounts) {
  const summary = summarizeStaffAccounts(accounts);
  console.log(`Loaded ${summary.total} staff accounts from CSV.`);
  console.log(
    `Roles: admin ${summary.byRole.admin}, staff ${summary.byRole.staff}, teacher ${summary.byRole.teacher}`,
  );
}

function printAccounts(accounts) {
  for (const account of accounts) {
    console.log(`${account.role.padEnd(7)} ${account.name} <${account.email}>`);
  }
}

async function main() {
  importEnvFile(path.join(root, ".env"));
  importEnvFile(path.join(root, ".env.local"));
  importEnvFile(path.join(root, ".env.supabase.local"));

  const args = getArgumentMap();
  const csvPathArg = args.get("--csv");
  const dryRun = Boolean(args.get("--dry-run"));
  const domain = String(args.get("--domain") || ACCOUNT_EMAIL_DOMAIN).trim();
  const password = String(args.get("--password") || DEFAULT_INITIAL_PASSWORD);

  if (!csvPathArg || typeof csvPathArg !== "string") {
    throw new Error("Usage: node scripts/create-staff-accounts.mjs --csv <path> [--dry-run]");
  }

  const csvPath = path.resolve(root, csvPathArg);
  const accounts = loadStaffAccountsFromCsvPath(csvPath, { domain, password });

  printSummary(accounts);
  printAccounts(accounts);

  if (dryRun) {
    console.log("Dry run only. No Supabase changes were made.");
    return;
  }

  const supabase = buildSupabaseAdminClient();
  const existingUsers = await listAllUsers(supabase);
  const existingByEmail = new Map(
    existingUsers
      .map((user) => [String(user.email || "").trim().toLowerCase(), user])
      .filter(([email]) => email),
  );

  for (const account of accounts) {
    const existingUser = existingByEmail.get(account.email.toLowerCase());
    const { action, user } = await upsertAuthUser(supabase, existingUser, account);
    if (!user?.id) {
      throw new Error(`Missing auth user id after ${action}: ${account.email}`);
    }

    await upsertProfile(supabase, user.id, account);
    existingByEmail.set(account.email.toLowerCase(), user);
    console.log(`${action.toUpperCase()} ${account.email}`);
  }

  console.log("Finished syncing staff accounts.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
