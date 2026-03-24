import { stripClassPrefix } from "../data/sampleData.js";

function getRawClassNameValue(classLike) {
  if (typeof classLike === "string") {
    return classLike;
  }

  return (
    classLike?.displayClassName ||
    classLike?.className ||
    classLike?.name ||
    ""
  );
}

export function getEditableClassNameSeed(classLike) {
  return stripClassPrefix(getRawClassNameValue(classLike));
}

export function compareClassDisplayNames(leftClassLike, rightClassLike) {
  return getEditableClassNameSeed(leftClassLike).localeCompare(
    getEditableClassNameSeed(rightClassLike),
    "ko",
    {
      numeric: true,
      sensitivity: "base",
    },
  );
}
