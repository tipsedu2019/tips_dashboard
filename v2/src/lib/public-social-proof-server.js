import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(moduleDir, "../../public");

export const embeddedReviewsBundlePath = path.join(
  publicDir,
  "embedded",
  "reviews",
  "assets",
  "index-BPsEWDat.js",
);

export const embeddedResultsCsvPath = path.join(
  publicDir,
  "embedded",
  "scores",
  "data.csv",
);

function text(value) {
  return String(value || "").trim();
}

async function readTextFile(filePath) {
  return fs.readFile(filePath, "utf8");
}

function extractArrayLiteral(source, variableName) {
  const declarations = [
    `const ${variableName}=`,
    `let ${variableName}=`,
    `var ${variableName}=`,
    `${variableName}=`,
  ];
  const declaration = declarations.find((candidate) => source.includes(candidate));

  if (!declaration) {
    throw new Error(`Could not find array declaration for ${variableName}`);
  }

  const start = source.indexOf("[", source.indexOf(declaration));
  if (start < 0) {
    throw new Error(`Could not find array start for ${variableName}`);
  }

  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === "\\") {
        escaped = true;
        continue;
      }

      if (character === quote) {
        quote = "";
      }
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }

    if (character === "[") {
      depth += 1;
      continue;
    }

    if (character === "]") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  throw new Error(`Could not resolve array literal for ${variableName}`);
}

function evaluateArrayLiteral(literal) {
  return vm.runInNewContext(`(${literal})`, {}, { timeout: 1000 });
}

function normalizeReview(row, index) {
  return {
    id: text(row.id) || `review-${index + 1}`,
    role: text(row.type) || "학생",
    name: text(row.name) || "익명",
    content: text(row.content),
  };
}

function summarizeReviews(reviews = [], highlights = []) {
  return {
    reviewCount: reviews.length,
    studentCount: reviews.filter((review) => review.role.includes("학생")).length,
    parentCount: reviews.filter((review) => review.role.includes("학부모")).length,
    highlightCount: highlights.length,
  };
}

function parseCsvRow(line = "") {
  const values = [];
  let current = "";
  let quote = "";

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (quote) {
      if (character === quote && nextCharacter === quote) {
        current += quote;
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = "";
        continue;
      }

      current += character;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (character === ",") {
      values.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  values.push(current);
  return values.map((value) => value.trim());
}

function normalizeResult(row = {}, index = 0) {
  const year = Number(text(row["년도"]));
  const score = Number(text(row["점수"]));

  return {
    id: `${text(row["년도"])}-${text(row["시험"])}-${text(row["이름"])}-${index}`,
    year: Number.isFinite(year) ? year : 0,
    exam: text(row["시험"]),
    school: text(row["학교"]),
    grade: text(row["학년"] || row["학년 "]),
    name: text(row["이름"]) || "익명",
    subject: text(row["과목"]),
    teacher: text(row["선생님"]),
    score: Number.isFinite(score) ? score : 0,
    gradeBand: text(row["등급"]),
    rank: text(row["석차"]),
    detail: text(row["과목상세"]),
  };
}

function summarizeResults(results = []) {
  const subjectSet = new Set(results.map((row) => row.subject).filter(Boolean));
  const yearSet = new Set(results.map((row) => row.year).filter(Boolean));

  return {
    caseCount: results.length,
    perfectScoreCount: results.filter((row) => row.score >= 100).length,
    gradeBandCount: results.filter((row) => Boolean(row.gradeBand)).length,
    subjectCount: subjectSet.size,
    yearCount: yearSet.size,
  };
}

export async function loadPublicReviewsPagePayload(readText = readTextFile) {
  const bundleSource = await readText(embeddedReviewsBundlePath);
  const reviewsLiteral = extractArrayLiteral(bundleSource, "XT");
  const highlightsLiteral = extractArrayLiteral(bundleSource, "ny");
  const reviews = evaluateArrayLiteral(reviewsLiteral).map(normalizeReview);
  const highlights = Array.from(evaluateArrayLiteral(highlightsLiteral), (item) => text(item)).filter(Boolean);

  return {
    reviews,
    highlights,
    featuredReviews: reviews.slice(0, 12),
    summary: summarizeReviews(reviews, highlights),
  };
}

export async function loadPublicResultsPagePayload(readText = readTextFile) {
  const csv = await readText(embeddedResultsCsvPath);
  const [headerLine, ...rows] = csv.split(/\r?\n/).filter((line) => text(line));
  const headers = parseCsvRow(headerLine);
  const results = rows
    .map(parseCsvRow)
    .map((cells) =>
      headers.reduce((result, header, index) => {
        result[header] = cells[index] || "";
        return result;
      }, {}),
    )
    .map(normalizeResult)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (right.year !== left.year) {
        return right.year - left.year;
      }
      return left.name.localeCompare(right.name, "ko");
    });

  const subjectBreakdown = [...results.reduce((result, row) => {
    const key = row.subject || "기타";
    result.set(key, (result.get(key) || 0) + 1);
    return result;
  }, new Map()).entries()].sort((left, right) => right[1] - left[1]);

  const yearBreakdown = [...results.reduce((result, row) => {
    const key = row.year || 0;
    result.set(key, (result.get(key) || 0) + 1);
    return result;
  }, new Map()).entries()].sort((left, right) => right[0] - left[0]);

  return {
    results,
    topResults: results.slice(0, 24),
    subjectBreakdown,
    yearBreakdown,
    summary: summarizeResults(results),
  };
}
