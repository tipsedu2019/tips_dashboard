import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

import ts from "typescript";

const root = new URL("../", import.meta.url);

async function readPickerSource() {
  return readFile(new URL("src/components/ui/date-time-picker.tsx", root), "utf8");
}

function loadPickerHelpers(source, helperNames = [
  "TIME_OPTIONS",
  "FULL_DAY_TIME_OPTIONS",
  "normalizeTimeInput",
  "splitLocalDateTime",
  "mergeLocalDateTime",
  "getTimePickerOptions",
]) {
  const helperStart = source.indexOf("const TIME_OPTION_START_MINUTES");
  const helperEnd = source.indexOf("type DatePickerControlProps");

  assert.ok(helperStart >= 0, "time option helpers should exist");
  assert.ok(helperEnd > helperStart, "picker helper section should precede the component props");

  const helperSource = `${source.slice(helperStart, helperEnd)}\nmodule.exports = { ${helperNames.join(", ")} };`;
  const compiled = ts.transpileModule(helperSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const sandboxModule = { exports: {} };

  vm.runInNewContext(compiled, { module: sandboxModule, exports: sandboxModule.exports });
  return sandboxModule.exports;
}

test("date-time drafts preserve the complete counterpart and never synthesize a missing half", async () => {
  const source = await readPickerSource();
  const {
    splitLocalDateTime,
    mergeLocalDateTime,
  } = loadPickerHelpers(source);
  const initial = splitLocalDateTime("2026-07-11T01:27");

  assert.deepEqual({ ...initial }, { date: "2026-07-11", time: "01:27" });
  assert.equal(mergeLocalDateTime("2026-07-12", initial.time), "2026-07-12T01:27");
  assert.equal(mergeLocalDateTime(initial.date, "23:59"), "2026-07-11T23:59");
  assert.equal(mergeLocalDateTime("2026-07-12", ""), "");
  assert.equal(mergeLocalDateTime("", "01:27"), "");
});

test("time validity spans the full day while standalone candidates keep their existing window", async () => {
  const source = await readPickerSource();
  const {
    TIME_OPTIONS,
    FULL_DAY_TIME_OPTIONS,
    normalizeTimeInput,
    getTimePickerOptions,
  } = loadPickerHelpers(source);

  assert.equal(normalizeTimeInput("01:27"), "01:27");
  assert.equal(normalizeTimeInput("2359"), "23:59");
  assert.equal(normalizeTimeInput("24:00"), "");
  assert.equal(normalizeTimeInput("09:60"), "");

  assert.equal(TIME_OPTIONS[0], "09:00");
  assert.equal(TIME_OPTIONS.at(-1), "23:30");
  assert.equal(FULL_DAY_TIME_OPTIONS.length, 24 * 6);
  assert.equal(FULL_DAY_TIME_OPTIONS[0], "00:00");
  assert.equal(FULL_DAY_TIME_OPTIONS.at(-1), "23:50");

  const optionsWithLegacyTime = Array.from(getTimePickerOptions(FULL_DAY_TIME_OPTIONS, "01:27"));
  assert.ok(optionsWithLegacyTime.includes("01:27"));
  assert.equal(optionsWithLegacyTime.filter((value) => value === "01:27").length, 1);
  assert.deepEqual(optionsWithLegacyTime, [...optionsWithLegacyTime].sort());
});

test("combined picker keeps partial drafts internal, syncs external resets, and exposes clear", async () => {
  const source = await readPickerSource();
  const componentStart = source.indexOf("export function DateTimePickerControl");
  const componentSource = source.slice(componentStart);

  assert.ok(componentStart >= 0, "DateTimePickerControl should be exported");
  assert.match(componentSource, /const \[dateDraft, setDateDraft\] = React\.useState/);
  assert.match(componentSource, /const \[timeDraft, setTimeDraft\] = React\.useState/);
  assert.match(
    componentSource,
    /React\.useEffect\(\(\) => \{[\s\S]*splitLocalDateTime\(value\)[\s\S]*setDateDraft[\s\S]*setTimeDraft[\s\S]*\}, \[value\]\)/,
  );
  assert.match(
    componentSource,
    /function commitIfComplete[\s\S]*mergeLocalDateTime\(nextDate, nextTime\)[\s\S]*if \(nextValue\) onChange\(nextValue\)/,
  );
  assert.match(
    componentSource,
    /function handleClear[\s\S]*setDateDraft\(""\)[\s\S]*setTimeDraft\(""\)[\s\S]*onChange\(""\)/,
  );
  assert.match(componentSource, /aria-label="날짜와 시각 지우기"/);
  assert.match(source, /type DateTimePickerControlProps = \{[\s\S]*?timeOptions\?: string\[\]/);
  assert.match(componentSource, /timeOptions = FULL_DAY_TIME_OPTIONS/);
  assert.match(componentSource, /options=\{timeOptions\}/);
  assert.match(componentSource, /className=\{cn\("grid min-w-0 gap-2/);
});

test("date and time controls keep selected-time scrolling inside the listbox", async () => {
  const source = await readPickerSource();
  const datePickerSource = source.slice(
    source.indexOf("type DatePickerControlProps"),
    source.indexOf("type TimePickerControlProps"),
  );
  const timePickerSource = source.slice(
    source.indexOf("type TimePickerControlProps"),
    source.indexOf("type DateTimePickerControlProps"),
  );

  assert.match(datePickerSource, /disablePortal\?: boolean/);
  assert.match(datePickerSource, /<PopoverContent[\s\S]*disablePortal=\{disablePortal\}/);
  assert.match(timePickerSource, /options\?: string\[\]/);
  assert.match(timePickerSource, /disablePortal\?: boolean/);
  assert.match(timePickerSource, /getTimePickerOptions\(options, normalizedValue\)/);
  assert.match(timePickerSource, /selectedOptionRef/);
  assert.match(timePickerSource, /timeListRef/);
  assert.match(timePickerSource, /scrollTimeOptionWithinList\(timeListRef\.current, selectedOptionRef\.current, "center"\)/);
  assert.match(timePickerSource, /scrollTimeOptionWithinList\(timeListRef\.current, nextOption, "nearest"\)/);
  assert.match(
    timePickerSource,
    /React\.useEffect\(\(\) => \{[\s\S]*?scrollTimeOptionWithinList[\s\S]*?\}, \[open\]\)/,
    "opening may center the active option once, but only within the listbox",
  );
  assert.doesNotMatch(timePickerSource, /\}, \[activeTime, open\]\)/);
  assert.doesNotMatch(timePickerSource, /scrollIntoView/);
  assert.match(timePickerSource, /<PopoverContent[\s\S]*disablePortal=\{disablePortal\}/);
});

test("combined date-time controls preserve the readable time label when a clear action is present", async () => {
  const source = await readPickerSource();
  const timePickerSource = source.slice(
    source.indexOf("type TimePickerControlProps"),
    source.indexOf("type DateTimePickerControlProps"),
  );
  const combinedPickerSource = source.slice(source.indexOf("type DateTimePickerControlProps"));

  assert.match(timePickerSource, /showIcon\?: boolean/);
  assert.match(timePickerSource, /showIcon = true/);
  assert.match(timePickerSource, /\{showIcon \? <Clock aria-hidden="true" \/> : null\}/);
  assert.match(combinedPickerSource, /showIcon=\{!hasDraft\}/);
});

test("combined picker exposes opt-in required semantics through described-by text", async () => {
  const source = await readPickerSource();
  const datePickerSource = source.slice(
    source.indexOf("type DatePickerControlProps"),
    source.indexOf("type TimePickerControlProps"),
  );
  const timePickerSource = source.slice(
    source.indexOf("type TimePickerControlProps"),
    source.indexOf("type DateTimePickerControlProps"),
  );
  const combinedPickerSource = source.slice(source.indexOf("type DateTimePickerControlProps"));

  assert.match(datePickerSource, /ariaDescribedBy\?: string/);
  assert.match(datePickerSource, /aria-describedby=\{ariaDescribedBy\}/);
  assert.match(timePickerSource, /ariaDescribedBy\?: string/);
  assert.match(timePickerSource, /aria-describedby=\{ariaDescribedBy\}/);
  assert.match(combinedPickerSource, /required\?: boolean/);
  assert.match(combinedPickerSource, /required = false/);
  assert.match(combinedPickerSource, /const requiredDescriptionId = React\.useId\(\)/);
  assert.match(combinedPickerSource, /ariaDescribedBy=\{required \? requiredDescriptionId : undefined\}/);
  assert.match(combinedPickerSource, /id=\{requiredDescriptionId\} className="sr-only">필수 입력<\/span>/);
  assert.doesNotMatch(combinedPickerSource, /aria-required/);
});

test("picker triggers announce current values and time options use one keyboard entry point", async () => {
  const source = await readPickerSource();
  const {
    getPickerAccessibleLabel,
    getNextTimeOptionIndex,
  } = loadPickerHelpers(source, ["getPickerAccessibleLabel", "getNextTimeOptionIndex"]);
  const datePickerSource = source.slice(
    source.indexOf("type DatePickerControlProps"),
    source.indexOf("type TimePickerControlProps"),
  );
  const timePickerSource = source.slice(
    source.indexOf("type TimePickerControlProps"),
    source.indexOf("type DateTimePickerControlProps"),
  );

  assert.equal(getPickerAccessibleLabel("문의일 날짜", "2026. 07. 11."), "문의일 날짜: 2026. 07. 11.");
  assert.equal(getPickerAccessibleLabel("문의일 날짜", ""), "문의일 날짜");
  assert.equal(getNextTimeOptionIndex("ArrowDown", 0, 3), 1);
  assert.equal(getNextTimeOptionIndex("ArrowDown", 2, 3), 0);
  assert.equal(getNextTimeOptionIndex("ArrowUp", 0, 3), 2);
  assert.equal(getNextTimeOptionIndex("Home", 2, 3), 0);
  assert.equal(getNextTimeOptionIndex("End", 0, 3), 2);
  assert.equal(getNextTimeOptionIndex("Enter", 1, 3), -1);

  assert.match(datePickerSource, /aria-label=\{getPickerAccessibleLabel\(ariaLabel, selectedDateLabel\)\}/);
  assert.match(timePickerSource, /aria-label=\{getPickerAccessibleLabel\(ariaLabel, selectedTimeLabel\)\}/);
  assert.match(timePickerSource, /role="listbox"/);
  assert.match(timePickerSource, /role="option"/);
  assert.match(timePickerSource, /aria-selected=\{selected\}/);
  assert.match(timePickerSource, /tabIndex=\{time === activeTime \? 0 : -1\}/);
  assert.match(timePickerSource, /handleTimeOptionKeyDown/);
  assert.match(timePickerSource, /onKeyDown=\{\(event\) => handleTimeOptionKeyDown\(event, index\)\}/);
  assert.match(timePickerSource, /selectedOptionRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(timePickerSource, /scrollTimeOptionWithinList\(timeListRef\.current, selectedOptionRef\.current, "center"\)/);
  assert.doesNotMatch(timePickerSource, /scrollIntoView/);
  assert.match(timePickerSource, /<PopoverTrigger asChild>/);
  assert.match(timePickerSource, /onChange\(time\)[\s\S]*setOpen\(false\)/);
  assert.doesNotMatch(timePickerSource, /onCloseAutoFocus/);
});
