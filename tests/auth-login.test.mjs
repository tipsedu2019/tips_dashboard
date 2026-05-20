import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function readSource(pathname) {
  return readFile(new URL(pathname, root), "utf8");
}

test("auth pages use the official logo instead of the cart mark", async () => {
  const [brandSource, ...pageSources] = await Promise.all([
    readSource("src/components/auth/auth-brand-link.tsx"),
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

  for (const source of pageSources) {
    assert.match(source, /<AuthBrandLink \/>/);
    assert.doesNotMatch(source, /@\/components\/logo/);
    assert.doesNotMatch(source, /<\s*Logo\b/);
  }
});

test("sign-in form accepts a login id instead of requiring an email address", async () => {
  const source = await readSource("src/app/(auth)/sign-in/components/login-form-1.tsx");

  assert.match(source, /loginId:\s*z\.string\(\)\.trim\(\)\.min\(1, "아이디를 입력해 주세요\."\)/);
  assert.match(source, /name="loginId"/);
  assert.match(source, /<FormLabel>아이디<\/FormLabel>/);
  assert.match(source, /type="text"/);
  assert.match(source, /placeholder="01087547830"/);
  assert.match(source, /autoComplete="username"/);
  assert.match(source, /await login\(values\.loginId, values\.password\)/);
  assert.match(source, /href="\/sign-up"/);
  assert.doesNotMatch(source, /z\.string\(\)\.email/);
  assert.doesNotMatch(source, /type="email"/);
  assert.doesNotMatch(source, /your-id@tipsedu\.co\.kr/);
});

test("bare phone ids are normalized to full tipsedu email addresses", async () => {
  const [authUtilsSource, authProviderSource] = await Promise.all([
    readSource("src/lib/auth-utils.ts"),
    readSource("src/providers/auth-provider.tsx"),
  ]);

  assert.match(authUtilsSource, /DEFAULT_LOGIN_EMAIL_DOMAIN = "tipsedu\.co\.kr"/);
  assert.match(authUtilsSource, /return digits/);
  assert.match(authUtilsSource, /return `\$\{normalizeLoginLocalPart\(normalized\)\}@\$\{defaultDomain\}`/);
  assert.doesNotMatch(authUtilsSource, /digits\.slice\(-8\)/);
  assert.match(authProviderSource, /login:\s*async \(identifier: string, password: string\)/);
  assert.match(authProviderSource, /normalizeEmail\(identifier\)/);
  assert.match(authProviderSource, /signInWithPassword\(\{\s*email: normalizedEmail,\s*password,/);
});

test("self sign-up uses a receivable email and Supabase signUp", async () => {
  const source = await readSource("src/app/(auth)/sign-up/components/signup-form-1.tsx");

  assert.match(source, /getAuthErrorMessage/);
  assert.match(source, /BLOCKED_EMAIL_DOMAIN = "tipsedu\.co\.kr"/);
  assert.match(source, /name:\s*z\.string\(\)\.trim\(\)\.min\(1, "이름을 입력해 주세요\."\)/);
  assert.match(source, /email:\s*z[\s\S]*email\("수신 가능한 이메일 주소를 입력해 주세요\."\)/);
  assert.match(source, /tipsedu\.co\.kr 주소는 메일을 받을 수 없어 가입에 사용할 수 없습니다\./);
  assert.match(source, /password:\s*z\.string\(\)\.min\(8, "비밀번호는 8자 이상 입력해 주세요\."\)/);
  assert.match(source, /supabase\.auth\.signUp/);
  assert.match(source, /emailRedirectTo:\s*`\$\{window\.location\.origin\}\/sign-in`/);
  assert.match(source, /full_name:\s*name/);
  assert.match(source, /placeholder="name@gmail\.com"/);
  assert.doesNotMatch(source, /console\.log\("Signup attempt:/);
  assert.doesNotMatch(source, /Sign up with Google/);
});

test("forgot-password uses the receivable email reset flow", async () => {
  const source = await readSource("src/app/(auth)/forgot-password/components/forgot-password-form-1.tsx");

  assert.match(source, /getAuthErrorMessage/);
  assert.match(source, /BLOCKED_EMAIL_DOMAIN = "tipsedu\.co\.kr"/);
  assert.match(source, /resetPasswordForEmail\(normalizedEmail/);
  assert.match(source, /redirectTo:\s*`\$\{window\.location\.origin\}\/reset-password`/);
  assert.match(source, /tipsedu\.co\.kr 주소는 메일을 받을 수 없습니다/);
  assert.match(source, /<Label htmlFor="email">Google 이메일<\/Label>/);
  assert.match(source, /placeholder="name@gmail\.com"/);
  assert.match(source, /href="\/sign-up"/);
  assert.doesNotMatch(source, /your-id@tipsedu\.co\.kr/);
});

test("reset-password lets a recovery session set a new password", async () => {
  const [pageSource, formSource] = await Promise.all([
    readSource("src/app/(auth)/reset-password/page.tsx"),
    readSource("src/app/(auth)/reset-password/components/reset-password-form.tsx"),
  ]);

  assert.match(pageSource, /<ResetPasswordForm \/>/);
  assert.match(formSource, /supabase\.auth\.updateUser\(\{\s*password: values\.password,\s*\}\)/);
  assert.match(formSource, /supabase\.auth\.signOut\(\)/);
  assert.match(formSource, /router\.replace\("\/sign-in"\)/);
  assert.match(formSource, /새 비밀번호 설정/);
  assert.match(formSource, /비밀번호 변경/);
});

test("auth email sending rate limit errors are translated for operators", async () => {
  const source = await readSource("src/lib/auth-error-messages.ts");

  assert.match(source, /email rate limit/);
  assert.match(source, /rate limit/);
  assert.match(source, /메일 발송 한도를 초과했습니다/);
  assert.match(source, /이미 가입된 이메일입니다/);
});
