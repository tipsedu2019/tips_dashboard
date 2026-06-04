"use client";

import { supabase } from "@/lib/supabase";

type AcademicAutomationPayload = Record<string, unknown>;

function text(value: unknown) {
  return String(value || "").trim();
}

function dateKey(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }

  const raw = text(value);
  const match = raw.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function firstText(...values: unknown[]) {
  return values.map(text).find(Boolean) || "";
}

function buildAcademicAutomationEvent(
  eventData: AcademicAutomationPayload = {},
  savedPayload: AcademicAutomationPayload = {},
) {
  const sourceId = firstText(savedPayload.id, eventData.id);
  if (!sourceId) return null;

  const title = firstText(savedPayload.title, eventData.title);
  const start = firstText(
    dateKey(savedPayload.start),
    dateKey(savedPayload.start_date),
    dateKey(savedPayload.date),
    dateKey(eventData.start),
    dateKey(eventData.date),
  );
  const end = firstText(
    dateKey(savedPayload.end),
    dateKey(savedPayload.end_date),
    dateKey(eventData.end),
    dateKey(eventData.endDate),
    start,
  );
  const eventType = firstText(savedPayload.type, eventData.typeLabel, eventData.type);
  const schoolName = firstText(savedPayload.school, eventData.schoolName, eventData.school);
  const schoolId = firstText(savedPayload.school_id, eventData.schoolId);
  const grade = firstText(savedPayload.grade, eventData.grade, "all");
  const category = firstText(savedPayload.category, eventData.category);
  const note = firstText(savedPayload.note, eventData.note, eventData.description);

  return {
    sourceId,
    academicEvent: {
      id: sourceId,
      title,
      type: eventType,
      start,
      end,
      schoolName,
      schoolId,
      grade,
      category,
      note,
      status: start ? "confirmed" : "changed",
    },
  };
}

async function postOneAcademicAutomationTrigger({
  trigger,
  accessToken,
  sourceId,
  academicEvent,
}: {
  trigger: string;
  accessToken: string;
  sourceId: string;
  academicEvent: AcademicAutomationPayload;
}) {
  await fetch("/api/ops-task-automations/trigger", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      trigger,
      sourceType: "academic_calendar",
      sourceId,
      task: {
        id: sourceId,
        type: "general",
        title: text(academicEvent.title) || "Academic calendar event",
        status: text(academicEvent.status) || "changed",
      },
      academicEvent,
    }),
  });
}

export async function postAcademicCalendarAutomationEvent({
  eventData = {},
  savedPayload = {},
}: {
  eventData?: AcademicAutomationPayload;
  savedPayload?: AcademicAutomationPayload;
} = {}) {
  if (!supabase) return false;

  const event = buildAcademicAutomationEvent(eventData, savedPayload);
  if (!event) return false;

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) return false;

  try {
    await postOneAcademicAutomationTrigger({
      trigger: "academic_calendar.changed",
      accessToken,
      sourceId: event.sourceId,
      academicEvent: event.academicEvent,
    });

    if (text(event.academicEvent.start)) {
      await postOneAcademicAutomationTrigger({
        trigger: "academic_calendar.date_confirmed",
        accessToken,
        sourceId: event.sourceId,
        academicEvent: event.academicEvent,
      });
    }

    return true;
  } catch {
    return false;
  }
}
