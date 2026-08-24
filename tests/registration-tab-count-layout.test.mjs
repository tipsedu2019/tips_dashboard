import test from "node:test"
import assert from "node:assert/strict"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import {
  REGISTRATION_TAB_COUNT_SLOT_CLASS_NAME,
  RegistrationTabCountSlot,
} from "../src/features/tasks/registration-tab-count-slot.ts"

function renderedClassName(markup) {
  return markup.match(/class="([^"]+)"/)?.[1] || ""
}

test("registration tab count keeps one fixed-width slot before and after stats load", () => {
  const beforeStats = renderToStaticMarkup(createElement(RegistrationTabCountSlot, { count: 0 }))
  const afterStats = renderToStaticMarkup(createElement(RegistrationTabCountSlot, { count: 12 }))
  const overflowCount = renderToStaticMarkup(createElement(RegistrationTabCountSlot, { count: 1000 }))

  assert.match(beforeStats, /data-registration-tab-count-slot="true"/)
  assert.match(afterStats, /data-registration-tab-count-slot="true"/)
  assert.equal(renderedClassName(beforeStats), REGISTRATION_TAB_COUNT_SLOT_CLASS_NAME)
  assert.equal(renderedClassName(afterStats), REGISTRATION_TAB_COUNT_SLOT_CLASS_NAME)
  assert.equal(renderedClassName(overflowCount), REGISTRATION_TAB_COUNT_SLOT_CLASS_NAME)
  assert.match(REGISTRATION_TAB_COUNT_SLOT_CLASS_NAME, /\bw-8\b/)
  assert.match(REGISTRATION_TAB_COUNT_SLOT_CLASS_NAME, /\boverflow-hidden\b/)
  assert.doesNotMatch(beforeStats, />0<\/span>/)
  assert.match(afterStats, />12<\/span>/)
  assert.match(overflowCount, />99\+<\/span>/)
  assert.doesNotMatch(overflowCount, />1000<\/span>/)
  assert.match(overflowCount, /aria-hidden="true"/)
})
