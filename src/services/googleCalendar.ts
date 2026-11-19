import { DEFAULT_TIMEZONE } from '../data/initialData';

export interface GoogleCalendarSummary {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: string;
}

export interface BusyPeriod {
  start: string;
  end: string;
}

/**
 * Formats date (YYYY-MM-DD) + time (HH:MM) + duration into ISO 8601 strings in Africa/Brazzaville (+01:00).
 */
export function buildDateTimeRange(
  dateStr: string,
  timeStr: string,
  durationMinutes: number
): { startISO: string; endISO: string; startMs: number; endMs: number } {
  const startLocal = `${dateStr}T${timeStr}:00+01:00`;
  const startMs = new Date(startLocal).getTime();
  const endMs = startMs + durationMinutes * 60 * 1000;

  // Format endMs back into Africa/Brazzaville (+01:00) ISO string
  const endAdjusted = new Date(endMs + 60 * 60 * 1000);
  const yyyy = endAdjusted.getUTCFullYear();
  const mm = String(endAdjusted.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(endAdjusted.getUTCDate()).padStart(2, '0');
  const hh = String(endAdjusted.getUTCHours()).padStart(2, '0');
  const min = String(endAdjusted.getUTCMinutes()).padStart(2, '0');
  const endISO = `${yyyy}-${mm}-${dd}T${hh}:${min}:00+01:00`;

  return {
    startISO: startLocal,
    endISO,
    startMs,
    endMs,
  };
}

export async function fetchGoogleCalendarList(
  accessToken: string
): Promise<GoogleCalendarSummary[]> {
  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList',
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Erreur Google Agenda (liste des calendriers): ${res.status} ${errText}`);
  }
  const data = await res.json();
  return (data.items || []).map((item: any) => ({
    id: item.id,
    summary: item.summary || item.id,
    primary: Boolean(item.primary),
    accessRole: item.accessRole,
  }));
}

export async function checkCalendarFreeBusy(
  accessToken: string,
  calendarId: string,
  timeMinISO: string,
  timeMaxISO: string
): Promise<BusyPeriod[]> {
  const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeMin: timeMinISO,
      timeMax: timeMaxISO,
      timeZone: DEFAULT_TIMEZONE,
      items: [{ id: calendarId || 'primary' }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Impossible de vérifier les disponibilités Google Agenda: ${res.status} ${errText}`);
  }

  const data = await res.json();
  const calKey = calendarId || 'primary';
  const calInfo = data.calendars?.[calKey];
  if (calInfo?.errors?.length) {
    throw new Error(`Erreur de disponibilité sur l'agenda ${calKey}: ${calInfo.errors[0].reason}`);
  }
  return calInfo?.busy || [];
}

export interface CalendarEventPayload {
  summary: string;
  description: string;
  location: string;
  startISO: string;
  endISO: string;
  attendeeEmails: string[];
}

export async function createGoogleCalendarEvent(
  accessToken: string,
  calendarId: string,
  payload: CalendarEventPayload
): Promise<{ eventId: string; htmlLink: string }> {
  const targetCal = encodeURIComponent(calendarId || 'primary');
  const attendees = payload.attendeeEmails
    .filter((email) => email && email.includes('@'))
    .map((email) => ({ email }));

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${targetCal}/events?sendUpdates=all`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: payload.summary,
        description: payload.description,
        location: payload.location,
        start: {
          dateTime: payload.startISO,
          timeZone: DEFAULT_TIMEZONE,
        },
        end: {
          dateTime: payload.endISO,
          timeZone: DEFAULT_TIMEZONE,
        },
        attendees: attendees.length > 0 ? attendees : undefined,
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 60 },
            { method: 'popup', minutes: 15 },
          ],
        },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Échec de création de l'événement Google Agenda: ${res.status} ${errText}`);
  }

  const created = await res.json();
  return {
    eventId: created.id,
    htmlLink: created.htmlLink || '',
  };
}

export async function updateGoogleCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  payload: Partial<CalendarEventPayload>
): Promise<{ eventId: string; htmlLink: string }> {
  const targetCal = encodeURIComponent(calendarId || 'primary');
  const targetEvt = encodeURIComponent(eventId);
  const body: Record<string, unknown> = {};
  if (payload.summary) body.summary = payload.summary;
  if (payload.description) body.description = payload.description;
  if (payload.location) body.location = payload.location;
  if (payload.startISO) {
    body.start = { dateTime: payload.startISO, timeZone: DEFAULT_TIMEZONE };
  }
  if (payload.endISO) {
    body.end = { dateTime: payload.endISO, timeZone: DEFAULT_TIMEZONE };
  }

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${targetCal}/events/${targetEvt}?sendUpdates=all`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Échec de mise à jour Google Agenda: ${res.status} ${errText}`);
  }
  const updated = await res.json();
  return {
    eventId: updated.id,
    htmlLink: updated.htmlLink || '',
  };
}

export async function deleteGoogleCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  const targetCal = encodeURIComponent(calendarId || 'primary');
  const targetEvt = encodeURIComponent(eventId);
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${targetCal}/events/${targetEvt}?sendUpdates=all`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const errText = await res.text();
    throw new Error(`Échec de suppression Google Agenda: ${res.status} ${errText}`);
  }
}
