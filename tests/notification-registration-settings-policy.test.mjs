import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  getRegistrationNotificationRulePolicy,
  REGISTRATION_NOTIFICATION_VISIT_EVENTS,
  REGISTRATION_NOTIFICATION_PROGRESS_EVENTS,
  REGISTRATION_NOTIFICATION_ARCHIVED_EVENTS,
} from '../src/features/notifications/notification-registration-settings-policy.ts'

const rule = (eventKey, channelKey = 'google_chat') => ({ workflowKey: 'registration', eventKey, channelKey })
test('registration settings expose nine current identities and keep the twelve previous rules read only', () => {
  assert.equal(REGISTRATION_NOTIFICATION_VISIT_EVENTS.length, 5)
  assert.equal(REGISTRATION_NOTIFICATION_PROGRESS_EVENTS.length, 4)
  const archivedRules = REGISTRATION_NOTIFICATION_ARCHIVED_EVENTS.flatMap((event) => event === 'registration.appointment_reminder_due'
    ? ['previous_day_at', 'same_day_at', 'offset_before'].map((variant) => ({ ...rule(event), ruleVariantKey: variant })) : [rule(event)])
  assert.equal(archivedRules.length, 12)
  for (const item of archivedRules) assert.deepEqual(getRegistrationNotificationRulePolicy(item), {
    group: 'archive', label: '이전 설정', mode: 'archived', editable: false,
  })
  assert.equal(getRegistrationNotificationRulePolicy(rule('registration.visit_canceled')).mode, 'manual')
  assert.equal(getRegistrationNotificationRulePolicy(rule('registration.visit_replaced')).mode, 'compatibility')
  assert.equal(getRegistrationNotificationRulePolicy(rule('registration.case_created')).group, 'progress')
  assert.equal(getRegistrationNotificationRulePolicy(rule('registration.case_closed', 'customer_message')), null)
})
test('SQL archive policy has exactly the same event identities as the UI and server policy', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260908042503_notification_settings_atomic_registration_policy.sql', import.meta.url), 'utf8')
  const predicate = sql.slice(sql.indexOf('create or replace function dashboard_private.notification_registration_setting_archived_v1'), sql.indexOf('\n$$;'))
  assert.deepEqual([...predicate.matchAll(/'(registration\.[a-z_]+)'/g)].map((match) => match[1]).sort(), [...REGISTRATION_NOTIFICATION_ARCHIVED_EVENTS].sort())
  assert.doesNotMatch(sql, /using errcode = '40001'/)
})
