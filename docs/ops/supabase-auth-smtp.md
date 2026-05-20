# Supabase Auth SMTP 설정

프로젝트 ref: `slnjqlzzhewblvttiidk`
Supabase URL: `https://slnjqlzzhewblvttiidk.supabase.co`

## 왜 필요한가

Supabase 기본 메일 발송기는 테스트용이라 가입/비밀번호 찾기 메일이 시간당 2건 수준에서 막힌다. 운영에서는 반드시 Custom SMTP를 연결해야 한다.

## 추천 구성

- SMTP 서비스: Resend
- 발송자 이름: `TIPS Dashboard`
- 발송 주소: `no-reply@tipsedu.co.kr` 또는 `no-reply@auth.tipsedu.co.kr`
- 포트: `587`
- 보안: STARTTLS/TLS

## Resend에서 준비할 것

1. Resend 가입
2. Domain 추가: `tipsedu.co.kr` 또는 `auth.tipsedu.co.kr`
3. Resend가 안내하는 DNS 레코드 추가
   - SPF/TXT
   - DKIM/TXT
   - 필요 시 DMARC/TXT
4. Domain Verified 상태 확인
5. SMTP credentials 발급

Resend SMTP 값 예시:

```text
SMTP Host: smtp.resend.com
SMTP Port: 587
SMTP User: resend
SMTP Password: Resend에서 발급한 API key 또는 SMTP password
Sender name: TIPS Dashboard
Sender email: no-reply@tipsedu.co.kr
```

## Supabase에 입력

Supabase Dashboard > Project `slnjqlzzhewblvttiidk` > Authentication > Settings > SMTP Settings

```text
Enable Custom SMTP: On
Sender email: no-reply@tipsedu.co.kr
Sender name: TIPS Dashboard
SMTP Host: smtp.resend.com
SMTP Port: 587
SMTP User: resend
SMTP Password: [Resend SMTP password]
```

저장 후 Authentication > Rate Limits에서 이메일 발송 한도를 운영에 맞게 조정한다.

## 확인

1. `/sign-up`에서 실제 수신 가능한 Gmail로 가입
2. 가입 확인 메일 수신 확인
3. `/forgot-password`에서 같은 Gmail로 재설정 메일 수신 확인
4. 메일 링크를 열어 `/reset-password`에서 새 비밀번호 저장 확인

## 주의

- `tipsedu.co.kr`이 실제 수신 메일 계정이 아니라면 가입/비밀번호 찾기 주소로 쓰지 않는다.
- SMTP 비밀번호/API key는 코드, Git, 채팅에 저장하지 않는다.
- 발송 도메인의 DNS 인증이 완료되지 않으면 메일이 스팸함으로 가거나 발송 실패할 수 있다.
