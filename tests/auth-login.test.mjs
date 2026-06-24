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

test("sign-in form asks for a Google email like the reset and signup flows", async () => {
  const source = await readSource(
    "src/app/(auth)/sign-in/components/login-form-1.tsx",
  );

  assert.match(
    source,
    /loginId:\s*z\.string\(\)\.trim\(\)\.min\(1, "Google 이메일을 입력해 주세요\."\)/,
  );
  assert.match(source, /name="loginId"/);
  assert.match(source, /data-testid="sign-in-login-id"/);
  assert.match(source, /data-testid="sign-in-password"/);
  assert.match(source, /<FormLabel>Google 이메일<\/FormLabel>/);
  assert.match(source, /type="email"/);
  assert.match(source, /inputMode="email"/);
  assert.match(source, /placeholder="name@gmail.com"/);
  assert.match(source, /autoComplete="email"/);
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
  assert.doesNotMatch(source, /placeholder="01087547830"/);
  assert.doesNotMatch(source, /your-id@tipsedu\.co\.kr/);
  assert.doesNotMatch(source, /계정 만들기/);
});

test("bare phone ids are normalized to full tipsedu email addresses", async () => {
  const [authUtilsSource, authProviderSource] = await Promise.all([
    readSource("src/lib/auth-utils.ts"),
    readSource("src/providers/auth-provider.tsx"),
  ]);

  assert.match(
    authUtilsSource,
    /DEFAULT_LOGIN_EMAIL_DOMAIN = "tipsedu\.co\.kr"/,
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
  assert.match(source, /resetAnonymousSession\(\)/);
  assert.doesNotMatch(source, /Invalid Refresh Token/);
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
    /name:\s*z\.string\(\)\.trim\(\)\.min\(1, "이름을 입력해 주세요\."\)/,
  );
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
  assert.match(source, /placeholder="name@gmail\.com"/);
  assert.match(source, /<CardTitle className="text-xl">회원가입<\/CardTitle>/);
  assert.doesNotMatch(source, /console\.log\("Signup attempt:/);
  assert.doesNotMatch(source, /Sign up with Google/);
  assert.doesNotMatch(source, /<CardTitle className="text-xl">계정 만들기<\/CardTitle>/);
});

test("registered sign-in explains the next step and viewer accounts can open the dashboard", async () => {
  const [loginSource, authUtilsSource] = await Promise.all([
    readSource("src/app/(auth)/sign-in/components/login-form-1.tsx"),
    readSource("src/lib/auth-utils.ts"),
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
});

test("assistant role can enter the shell but not management or curriculum planning", async () => {
  const [authUtilsSource, authGuardSource, sidebarSource, commandSearchSource] =
    await Promise.all([
      readSource("src/lib/auth-utils.ts"),
      readSource("src/components/auth/auth-guard.tsx"),
      readSource("src/components/app-sidebar.tsx"),
      readSource("src/components/command-search.tsx"),
    ]);

  assert.match(authUtilsSource, /normalizedRole === "assistant"/);
  assert.match(authUtilsSource, /canUseAssistantOperations/);
  assert.match(authUtilsSource, /defaultAdminPath: canUseAssistantOperations \? "\/admin\/tasks" : "\/admin\/dashboard"/);
  assert.match(authGuardSource, /ASSISTANT_ALLOWED_ADMIN_PATHS/);
  assert.match(authGuardSource, /"\/admin\/tasks"/);
  assert.match(authGuardSource, /"\/admin\/word-retests"/);
  assert.match(authGuardSource, /"\/admin\/academic-calendar"/);
  assert.match(authGuardSource, /"\/admin\/timetable"/);
  assert.match(authGuardSource, /router\.replace\(defaultAdminPath\)/);
  assert.match(sidebarSource, /canUseAssistantOperations/);
  assert.match(commandSearchSource, /canUseAssistantOperations/);
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
