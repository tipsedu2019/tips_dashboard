export default function handler(_request, response) {
  response.status(410).setHeader("Content-Type", "text/html; charset=utf-8");
  response.send(`<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="robots" content="noindex, nofollow, noarchive" />
    <title>삭제된 페이지</title>
  </head>
  <body>
    <main>
      <h1>삭제된 페이지입니다.</h1>
      <p>이 주소는 더 이상 운영하지 않습니다.</p>
    </main>
  </body>
</html>`);
}
