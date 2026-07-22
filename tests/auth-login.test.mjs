import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function readSource(pathname) {
  return readFile(new URL(pathname, root), "utf8");
}

async function fileExists(pathname) {
  try {
    await access(new URL(pathname, root));
    return true;
  } catch {
    return false;
  }
}

test("auth pages use the official logo instead of the cart mark", async () => {
  const [brandSource, logoSource, errorScreenSource, ...pageSources] =
    await Promise.all([
      readSource("src/components/auth/auth-brand-link.tsx"),
      readSource("src/components/logo.tsx"),
      readSource("src/app/(auth)/errors/components/auth-error-screen.tsx"),
      readSource("src/app/(auth)/sign-in/page.tsx"),
      readSource("src/app/(auth)/forgot-password/page.tsx"),
      readSource("src/app/(auth)/sign-up/page.tsx"),
      readSource("src/app/(auth)/reset-password/page.tsx"),
    ]);

  assert.match(brandSource, /from "next\/image"/);
  assert.match(brandSource, /src="\/logo_tips\.png"/);
  assert.match(brandSource, /alt="TIPS 로고"/);
  assert.doesNotMatch(brandSource, /@\/components\/logo/);
  assert.doesNotMatch(brandSource, /<\s*Logo\b/);
  assert.match(logoSource, /from "next\/image"/);
  assert.match(logoSource, /src="\/logo_tips\.png"/);
  assert.match(logoSource, /alt = "TIPS 로고"/);
  assert.doesNotMatch(logoSource, /<\s*svg\b/);
  assert.doesNotMatch(logoSource, /M26 24\.75/);
  assert.match(errorScreenSource, /AuthBrandLink/);
  assert.doesNotMatch(errorScreenSource, /@\/components\/logo/);
  assert.doesNotMatch(errorScreenSource, /<\s*Logo\b/);

  for (const source of pageSources) {
    assert.match(source, /<AuthBrandLink \/>/);
    assert.doesNotMatch(source, /@\/components\/logo/);
    assert.doesNotMatch(source, /<\s*Logo\b/);
  }
});

test("legacy auth variant routes redirect without keeping template components", async () => {
  const redirects = [
    ["src/app/(auth)/sign-in-2/page.tsx", "/sign-in"],
    ["src/app/(auth)/sign-in-3/page.tsx", "/sign-in"],
    ["src/app/(auth)/sign-up-2/page.tsx", "/sign-up"],
    ["src/app/(auth)/sign-up-3/page.tsx", "/sign-up"],
    ["src/app/(auth)/forgot-password-2/page.tsx", "/forgot-password"],
    ["src/app/(auth)/forgot-password-3/page.tsx", "/forgot-password"],
  ];
  const removedTemplateComponents = [
    "src/app/(auth)/sign-in-2/components/login-form-2.tsx",
    "src/app/(auth)/sign-in-3/components/login-form-3.tsx",
    "src/app/(auth)/sign-up-2/components/signup-form-2.tsx",
    "src/app/(auth)/sign-up-3/components/signup-form-3.tsx",
    "src/app/(auth)/forgot-password-2/components/forgot-password-form-2.tsx",
    "src/app/(auth)/forgot-password-3/components/forgot-password-form-3.tsx",
  ];

  for (const [pathname, target] of redirects) {
    const source = await readSource(pathname);
    assert.match(source, /from "next\/navigation"/);
    assert.match(source, new RegExp(`redirect\\("${target}"\\)`));
    assert.doesNotMatch(source, /components\//);
  }

  for (const pathname of removedTemplateComponents) {
    assert.equal(await fileExists(pathname), false, `${pathname} should be removed`);
  }
});

test("sign-in form accepts a Google email or the Gmail id only", async () => {
  const source = await readSource(
    "src/app/(auth)/sign-in/components/login-form-1.tsx",
  );

  assert.match(
    source,
    /loginId:\s*z\.string\(\)\.trim\(\)\.min\(1, "Google 이메일 또는 아이디를 입력해 주세요\."\)/,
  );
  assert.match(source, /name="loginId"/);
  assert.match(source, /data-testid="sign-in-login-id"/);
  assert.match(source, /data-testid="sign-in-password"/);
  assert.match(source, /<FormLabel>Google 이메일 또는 아이디<\/FormLabel>/);
  assert.match(source, /type="text"/);
  assert.match(source, /inputMode="email"/);
  assert.match(source, /placeholder="name 또는 name@gmail.com"/);
  assert.match(source, /autoComplete="username"/);
  assert.match(source, /await login\(values\.loginId, values\.password\)/);
  assert.match(source, /const redirectTarget = searchParams\.get\("next"\) \|\| "\/admin\/dashboard"/);
  assert.match(source, /if \(!loading && user\) \{/);
  assert.match(source, /router\.replace\(redirectTarget\)/);
  assert.match(source, /getAuthErrorMessage/);
  assert.match(source, /setSubmitError\(getAuthErrorMessage\(error,/);
  assert.match(source, /<CardTitle className="text-xl">TIPS 로그인<\/CardTitle>/);
  assert.match(source, /href="\/sign-up"/);
  assert.match(source, /<Link href="\/sign-up">회원가입<\/Link>/);
  assert.doesNotMatch(source, /<FormLabel>아이디<\/FormLabel>/);
  assert.doesNotMatch(source, /type="email"/);
  assert.doesNotMatch(source, /placeholder="01087547830"/);
  assert.doesNotMatch(source, /your-id@tipsedu\.co\.kr/);
  assert.doesNotMatch(source, /계정 만들기/);
});

test("bare Gmail ids are normalized to full Gmail email addresses", async () => {
  const [authUtilsSource, authProviderSource] = await Promise.all([
    readSource("src/lib/auth-utils.ts"),
    readSource("src/providers/auth-provider.tsx"),
  ]);

  assert.match(
    authUtilsSource,
    /DEFAULT_LOGIN_EMAIL_DOMAIN = "gmail\.com"/,
  );
  assert.match(authUtilsSource, /return digits/);
  assert.match(
    authUtilsSource,
    /return `\$\{normalizeLoginLocalPart\(normalized\)\}@\$\{defaultDomain\}`/,
  );
  assert.doesNotMatch(authUtilsSource, /digits\.slice\(-8\)/);
  assert.match(
    authProviderSource,
    /login:\s*async \(identifier: string, password: string\)/,
  );
  assert.match(authProviderSource, /normalizeEmail\(identifier\)/);
  assert.match(
    authProviderSource,
    /signInWithPassword\(\{\s*email: normalizedEmail,\s*password,/,
  );
  assert.match(authProviderSource, /getAuthErrorMessage/);
  assert.match(authProviderSource, /로그인 상태를 확인하지 못했습니다/);
  assert.match(authProviderSource, /로그아웃에 실패했습니다/);
  assert.match(authProviderSource, /profileByIdentity/);
  assert.match(
    authProviderSource,
    /or\(`email\.eq\.\$\{normalizedEmail\},login_id\.eq\.\$\{normalizedLoginId\}`\)/,
  );
});

test("stale refresh token sessions recover to a clean sign-in state", async () => {
  const source = await readSource("src/providers/auth-provider.tsx");

  assert.match(source, /function isStaleRefreshTokenError/);
  assert.match(source, /invalid refresh token/);
  assert.match(source, /refresh token not found/);
  assert.match(source, /refresh token already used/);
  assert.match(source, /await client\.auth\.signOut\(\{ scope: "local" \}\)/);
  assert.match(source, /resetAnonymousSession\(resolution\)/);
  assert.doesNotMatch(source, /Invalid Refresh Token/);
});

test("auth initialization survives React strict-effect replay without duplicate session locks", async () => {
  const source = await readSource("src/providers/auth-provider.tsx");

  assert.match(source, /let initialAuthSessionPromise/);
  assert.match(source, /function loadInitialAuthSession/);
  assert.match(source, /initialAuthSessionPromise \|\|= client\.auth\.getSession\(\)/);
  assert.match(source, /loadInitialAuthSession\(client\)/);
  assert.match(source, /type ResolvedDashboardProfile/);
  assert.match(source, /await inflight\.promise/);
  assert.match(source, /applyResolvedProfile\(resolvedProfile\)/);
  assert.match(source, /createAuthResolutionCoordinator/);
  assert.match(source, /authResolutionRef\.current\.canReuseResolvedProfile\(sessionKey\)/);
  assert.match(source, /authResolutionRef\.current\.markResolvedProfile\(resolvedProfile\)/);
  assert.match(source, /const authSubscriptionTimer = setTimeout/);
  assert.match(source, /clearTimeout\(authSubscriptionTimer\)/);
  assert.match(
    source,
    /const provisionalUser = createFallbackUser\(\s*nextSession\.user,\s*"viewer",?\s*\)[\s\S]*setUser\(provisionalUser\)[\s\S]*setLoading\(false\)[\s\S]*resolveDashboardProfile/,
  );
  assert.match(
    source,
    /onAuthStateChange\([\s\S]*setTimeout\(\(\) => \{[\s\S]*void applyResolvedUser\(nextSession, resolution, event\)/,
  );
  assert.match(source, /event === "USER_UPDATED"/);
});

test("auth resolution tokens reject stale snapshots and signed-in work after sign-out", async () => {
  const { createAuthResolutionCoordinator } = await import(
    "../src/lib/auth-resolution-coordinator.js"
  );
  const coordinator = createAuthResolutionCoordinator();
  const initialSnapshot = coordinator.captureSnapshot();
  const signedIn = coordinator.begin("user-1:100");

  assert.equal(coordinator.isSnapshotCurrent(initialSnapshot), false);
  assert.equal(coordinator.isCurrent(signedIn), true);

  const signedOut = coordinator.begin("anonymous");
  assert.equal(coordinator.isCurrent(signedIn), false);
  assert.equal(coordinator.isCurrent(signedOut), true);
});

test("auth profile reuse cannot leave session A displaying provisional user B", async () => {
  const { createAuthResolutionCoordinator } = await import(
    "../src/lib/auth-resolution-coordinator.js"
  );
  const coordinator = createAuthResolutionCoordinator();

  const firstA = coordinator.begin("user-a:1");
  assert.equal(coordinator.markResolvedProfile(firstA), true);
  assert.equal(coordinator.canReuseResolvedProfile("user-a:1"), true);

  const pendingB = coordinator.begin("user-b:1");
  assert.equal(coordinator.canReuseResolvedProfile("user-a:1"), false);
  assert.equal(coordinator.canReuseResolvedProfile("user-b:1"), false);

  const returnedA = coordinator.begin("user-a:1");
  assert.equal(coordinator.canReuseResolvedProfile("user-a:1"), false);
  assert.equal(coordinator.markResolvedProfile(pendingB), false);
  assert.equal(coordinator.markResolvedProfile(returnedA), true);
  assert.equal(coordinator.canReuseResolvedProfile("user-a:1"), true);
});

test("self sign-up uses a receivable email and Supabase signUp", async () => {
  const source = await readSource(
    "src/app/(auth)/sign-up/components/signup-form-1.tsx",
  );

  assert.match(source, /getAuthErrorMessage/);
  assert.match(source, /getAuthRedirectUrl/);
  assert.match(source, /BLOCKED_EMAIL_DOMAIN = "tipsedu\.co\.kr"/);
  assert.match(
    source,
    /TEACHER_TEAM_OPTIONS = \["영어팀", "수학팀", "과학팀", "관리팀", "조교팀"\] as const/,
  );
  assert.match(
    source,
    /name:\s*z\.string\(\)\.trim\(\)\.min\(1, "이름을 입력해 주세요\."\)/,
  );
  assert.match(source, /teacherTeam:\s*z\.enum\(TEACHER_TEAM_OPTIONS/);
  assert.match(
    source,
    /email:\s*z[\s\S]*email\("수신 가능한 이메일 주소를 입력해 주세요\."\)/,
  );
  assert.match(
    source,
    /tipsedu\.co\.kr 주소는 메일을 받을 수 없어 가입에 사용할 수 없습니다\./,
  );
  assert.match(
    source,
    /password:\s*z\.string\(\)\.min\(8, "비밀번호는 8자 이상 입력해 주세요\."\)/,
  );
  assert.match(source, /supabase\.auth\.signUp/);
  assert.match(source, /emailRedirectTo:\s*getAuthRedirectUrl\("\/sign-in"\)/);
  assert.match(source, /supabase\.auth\.signOut\(\)/);
  assert.match(source, /router\.replace\("\/sign-in\?registered=1"\)/);
  assert.doesNotMatch(source, /router\.replace\("\/admin\/dashboard"\)/);
  assert.doesNotMatch(source, /window\.location\.origin/);
  assert.match(source, /full_name:\s*name/);
  assert.match(source, /teacher_team:\s*values\.teacherTeam/);
  assert.match(source, /team:\s*values\.teacherTeam/);
  assert.match(source, /name="teacherTeam"/);
  assert.match(source, /data-testid="sign-up-teacher-team"/);
  assert.match(source, /<FormLabel>팀<\/FormLabel>/);
  assert.match(source, /placeholder="name@gmail\.com"/);
  assert.match(source, /<CardTitle className="text-xl">회원가입<\/CardTitle>/);
  assert.doesNotMatch(source, /console\.log\("Signup attempt:/);
  assert.doesNotMatch(source, /Sign up with Google/);
  assert.doesNotMatch(source, /<CardTitle className="text-xl">계정 만들기<\/CardTitle>/);
});

test("registered sign-in explains the next step and viewer accounts can open the dashboard", async () => {
  const [loginSource, authUtilsSource, adminLayoutSource] = await Promise.all([
    readSource("src/app/(auth)/sign-in/components/login-form-1.tsx"),
    readSource("src/lib/auth-utils.ts"),
    readSource("src/app/admin/layout.tsx"),
  ]);

  assert.match(loginSource, /searchParams\.get\("registered"\) === "1"/);
  assert.match(
    loginSource,
    /가입이 완료되었습니다\. 이메일 확인 후 로그인하세요\./,
  );
  assert.match(authUtilsSource, /canAccessDashboard:\s*true/);
  assert.match(
    authUtilsSource,
    /canManageAll = normalizedRole === "admin" \|\| normalizedRole === "staff"/,
  );
  assert.match(adminLayoutSource, /role === "viewer"/);
  assert.match(adminLayoutSource, /data-testid="viewer-permission-notice"/);
  assert.match(adminLayoutSource, /관리팀에게 권한 조정을 요청하세요\./);
});

test("assistant role cannot navigate search or directly access makeup while full roles retain it", async () => {
  const [authUtilsSource, authGuardSource, navigationSource, sidebarSource, commandSearchSource] =
    await Promise.all([
      readSource("src/lib/auth-utils.ts"),
      readSource("src/components/auth/auth-guard.tsx"),
      readSource("src/lib/navigation.ts"),
      readSource("src/components/app-sidebar.tsx"),
      readSource("src/components/command-search.tsx"),
    ]);
  const assistantAllowedPathsSource = authGuardSource.slice(
    authGuardSource.indexOf("const ASSISTANT_ALLOWED_ADMIN_PATHS"),
    authGuardSource.indexOf("function normalizeAdminPath"),
  );
  const assistantOverviewSource = navigationSource.slice(
    navigationSource.indexOf("const assistantOverviewItems"),
    navigationSource.indexOf("const fullOverviewItems"),
  );
  const fullOverviewSource = navigationSource.slice(
    navigationSource.indexOf("const fullOverviewItems"),
    navigationSource.indexOf("const overview"),
  );

  assert.match(authUtilsSource, /normalizedRole === "assistant"/);
  assert.match(authUtilsSource, /canUseAssistantOperations/);
  assert.match(authUtilsSource, /defaultAdminPath: canUseAssistantOperations \? "\/admin\/tasks" : "\/admin\/dashboard"/);
  assert.match(authGuardSource, /ASSISTANT_ALLOWED_ADMIN_PATHS/);
  assert.match(assistantAllowedPathsSource, /"\/admin\/tasks"/);
  assert.match(assistantAllowedPathsSource, /"\/admin\/word-retests"/);
  assert.match(assistantAllowedPathsSource, /"\/admin\/academic-calendar"/);
  assert.match(assistantAllowedPathsSource, /"\/admin\/timetable"/);
  assert.doesNotMatch(assistantAllowedPathsSource, /"\/admin\/makeup-requests"/);
  assert.match(assistantOverviewSource, /url: "\/admin\/word-retests"/);
  assert.doesNotMatch(assistantOverviewSource, /url: "\/admin\/makeup-requests"/);
  assert.match(fullOverviewSource, /url: "\/admin\/makeup-requests"/);
  assert.match(authGuardSource, /const canAccessCurrentRoute = !canUseAssistantOperations \|\| canAssistantAccessPath\(pathname\)/);
  assert.match(authGuardSource, /router\.replace\(defaultAdminPath\)/);
  assert.match(sidebarSource, /canUseAssistantOperations/);
  assert.match(commandSearchSource, /canUseAssistantOperations/);
  assert.match(commandSearchSource, /buildAdminNavGroups\(\{ canManageAll, canEditCurriculumPlanning, canUseAssistantOperations \}\)/);
});

test("forgot-password uses the receivable email reset flow", async () => {
  const source = await readSource(
    "src/app/(auth)/forgot-password/components/forgot-password-form-1.tsx",
  );

  assert.match(source, /getAuthErrorMessage/);
  assert.match(source, /getAuthRedirectUrl/);
  assert.match(source, /BLOCKED_EMAIL_DOMAIN = "tipsedu\.co\.kr"/);
  assert.match(source, /resetPasswordForEmail\(normalizedEmail/);
  assert.match(
    source,
    /redirectTo:\s*getAuthRedirectUrl\("\/reset-password"\)/,
  );
  assert.doesNotMatch(source, /window\.location\.origin/);
  assert.match(source, /tipsedu\.co\.kr 주소는 메일을 받을 수 없습니다/);
  assert.match(source, /<Label htmlFor="email">Google 이메일<\/Label>/);
  assert.match(source, /placeholder="name@gmail\.com"/);
  assert.match(source, /href="\/sign-up"/);
  assert.match(source, /<Link href="\/sign-up">회원가입<\/Link>/);
  assert.doesNotMatch(source, /your-id@tipsedu\.co\.kr/);
  assert.doesNotMatch(source, /계정 만들기/);
});

test("reset-password lets a recovery session set a new password", async () => {
  const [pageSource, formSource] = await Promise.all([
    readSource("src/app/(auth)/reset-password/page.tsx"),
    readSource(
      "src/app/(auth)/reset-password/components/reset-password-form.tsx",
    ),
  ]);

  assert.match(pageSource, /<ResetPasswordForm \/>/);
  assert.match(
    formSource,
    /supabase\.auth\.updateUser\(\{\s*password: values\.password,\s*\}\)/,
  );
  assert.match(formSource, /supabase\.auth\.signOut\(\)/);
  assert.match(formSource, /router\.replace\("\/sign-in"\)/);
  assert.match(formSource, /새 비밀번호 설정/);
  assert.match(formSource, /비밀번호 변경/);
});

test("auth email redirects use the production origin when running locally", async () => {
  const source = await readSource("src/lib/auth-redirect-url.ts");

  assert.match(
    source,
    /DEFAULT_AUTH_REDIRECT_ORIGIN = "https:\/\/tipsedu\.co\.kr"/,
  );
  assert.match(
    source,
    /LOCAL_AUTH_HOSTNAMES = new Set\(\["localhost", "127\.0\.0\.1", "::1"\]\)/,
  );
  assert.match(source, /NEXT_PUBLIC_AUTH_REDIRECT_ORIGIN/);
  assert.match(source, /LOCAL_AUTH_HOSTNAMES\.has\(hostname\)/);
});

test("auth email sending rate limit errors are translated for operators", async () => {
  const source = await readSource("src/lib/auth-error-messages.ts");

  assert.match(source, /email rate limit/);
  assert.match(source, /rate limit/);
  assert.match(source, /invalid login credentials/);
  assert.match(source, /아이디 또는 비밀번호가 올바르지 않습니다/);
  assert.match(source, /email not confirmed/);
  assert.match(source, /이메일 확인 후 로그인하세요/);
  assert.match(source, /메일 발송 한도를 초과했습니다/);
  assert.match(source, /이미 가입된 이메일입니다/);
});
