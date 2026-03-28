import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { DEFAULT_LOGIN_EMAIL_DOMAIN } from "../src/lib/authUtils.js";
import {
  buildManagedLoginTransition,
  findDuplicateTransitionTargets,
} from "./lib/shortLoginMigration.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");
const MANAGED_ROLES = ["admin", "staff", "teacher"];

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

async function listManagedProfiles(supabase) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, login_id, role, must_change_password")
    .in("role", MANAGED_ROLES)
    .order("role")
    .order("name");

  if (error) {
    throw error;
  }

  return data || [];
}

function buildPlannedTransitions(profiles, users, domain) {
  const usersById = new Map(users.map((user) => [user.id, user]));
  const transitions = [];
  const skipped = [];

  for (const profile of profiles) {
    const user = usersById.get(profile.id);
    if (!user?.id) {
      skipped.push({
        id: profile.id,
        role: profile.role,
        name: profile.name || "",
        reason: "missing_auth_user",
      });
      continue;
    }

    const transition = buildManagedLoginTransition(
      {
        loginId: profile.login_id || user.user_metadata?.login_id,
        email: user.email,
      },
      { domain },
    );

    if (!transition) {
      skipped.push({
        id: profile.id,
        role: profile.role,
        name: profile.name || user.user_metadata?.name || "",
        reason: "explicit_exception_or_already_short",
      });
      continue;
    }

    transitions.push({
      ...transition,
      id: user.id,
      name: profile.name || user.user_metadata?.name || "",
      role: profile.role,
      mustChangePassword: Boolean(
        profile.must_change_password ??
          user.user_metadata?.must_change_password ??
          user.user_metadata?.mustChangePassword ??
          false,
      ),
      user,
    });
  }

  return { transitions, skipped };
}

function printPlan(transitions, skipped) {
  console.log(`Planned login updates: ${transitions.length}`);
  for (const transition of transitions) {
    console.log(
      `${transition.role.padEnd(7)} ${transition.name} <${transition.currentEmail}> -> <${transition.nextEmail}>`,
    );
  }

  console.log(`Skipped: ${skipped.length}`);
  for (const item of skipped) {
    console.log(`${item.role?.padEnd?.(7) || "unknown"} ${item.name} (${item.reason})`);
  }
}

async function applyTransition(supabase, transition) {
  const authPayload = {
    email: transition.nextEmail,
    email_confirm: true,
    user_metadata: {
      ...(transition.user.user_metadata || {}),
      name: transition.name,
      login_id: transition.nextLoginId,
      role: transition.role,
      must_change_password: transition.mustChangePassword,
    },
    app_metadata: {
      ...(transition.user.app_metadata || {}),
      role: transition.role,
    },
  };

  const { error: authError } = await supabase.auth.admin.updateUserById(
    transition.id,
    authPayload,
  );

  if (authError) {
    throw authError;
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      login_id: transition.nextLoginId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", transition.id);

  if (profileError) {
    throw profileError;
  }
}

async function main() {
  importEnvFile(path.join(root, ".env"));
  importEnvFile(path.join(root, ".env.local"));
  importEnvFile(path.join(root, ".env.supabase.local"));

  const args = getArgumentMap();
  const apply = Boolean(args.get("--apply"));
  const domain = String(args.get("--domain") || DEFAULT_LOGIN_EMAIL_DOMAIN).trim();

  const supabase = buildSupabaseAdminClient();
  const [profiles, users] = await Promise.all([
    listManagedProfiles(supabase),
    listAllUsers(supabase),
  ]);

  const { transitions, skipped } = buildPlannedTransitions(profiles, users, domain);
  const duplicates = findDuplicateTransitionTargets(transitions);

  if (duplicates.length > 0) {
    throw new Error(`Duplicate short-login targets detected: ${duplicates.join(", ")}`);
  }

  printPlan(transitions, skipped);

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to update Auth emails and profiles.login_id.");
    return;
  }

  for (const transition of transitions) {
    await applyTransition(supabase, transition);
    console.log(`UPDATED ${transition.currentEmail} -> ${transition.nextEmail}`);
  }

  console.log("Finished migrating managed logins to short phone ids.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
