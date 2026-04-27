import test from "node:test";
import assert from "node:assert/strict";

import {
  loadPublicReviewsPagePayload,
  loadPublicResultsPagePayload,
} from "../v2/src/lib/public-social-proof-server.js";

test("v2 reviews loader parses embedded bundle reviews and highlights", async () => {
  const payload = await loadPublicReviewsPagePayload(
    async () =>
      `const ny=["성적 향상","적극 추천"];const XT=[{type:"학생",name:"홍길동",content:"성적이 많이 올랐어요."},{type:"학부모님",name:"김OO",content:"선생님이 꼼꼼합니다."}];const JT=()=>{};`,
  );

  assert.equal(payload.summary.reviewCount, 2);
  assert.equal(payload.summary.studentCount, 1);
  assert.equal(payload.summary.parentCount, 1);
  assert.deepEqual(payload.highlights, ["성적 향상", "적극 추천"]);
  assert.equal(payload.reviews[0].role, "학생");
  assert.equal(payload.reviews[1].name, "김OO");
});

test("v2 results loader parses embedded csv and summarizes score cases", async () => {
  const payload = await loadPublicResultsPagePayload(
    async () =>
      [
        "년도,시험,학교,학년,이름,과목,선생님,점수,등급,석차,과목상세",
        "2025,2학기 기말,대기고,고1,홍길동,영어,정선생,100,1등급,,",
        "2025,2학기 기말,대기고,고1,김영희,수학,팁스,96,,,",
      ].join("\n"),
  );

  assert.equal(payload.summary.caseCount, 2);
  assert.equal(payload.summary.perfectScoreCount, 1);
  assert.equal(payload.summary.gradeBandCount, 1);
  assert.equal(payload.summary.subjectCount, 2);
  assert.equal(payload.topResults[0].name, "홍길동");
  assert.equal(payload.topResults[0].score, 100);
});

test("v2 public social proof loaders can read the current embedded assets", async () => {
  const [reviewsPayload, resultsPayload] = await Promise.all([
    loadPublicReviewsPagePayload(),
    loadPublicResultsPagePayload(),
  ]);

  assert.ok(reviewsPayload.reviews.length > 50);
  assert.ok(reviewsPayload.highlights.length > 5);
  assert.ok(resultsPayload.results.length > 100);
  assert.ok(resultsPayload.summary.perfectScoreCount > 0);
});
