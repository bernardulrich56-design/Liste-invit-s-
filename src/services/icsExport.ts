import { HostConfig } from '../types';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toIcsUtcTimestamp(dateStr: string, timeStr: string, addMinutes = 0): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  // Congo Brazzaville WAT (UTC+1) -> convert local WAT to UTC by subtracting 1h
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1, (hh || 9) - 1, (mm || 0) + addMinutes, 0));
  return (
    `${dt.getUTCFullYear()}${pad2(dt.getUTCMonth() + 1)}${pad2(dt.getUTCDate())}` +
    `T${pad2(dt.getUTCHours())}${pad2(dt.getUTCMinutes())}00Z`
  );
}

function escapeIcsText(val: string): string {
  return (val || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

export function downloadAppointmentICS(params: {
  trackingCode: string;
  title: string;
  date: string;
  time: string;
  durationMinutes: number;
  format: 'présentiel' | 'en ligne';
  hostNames: string;
  description?: string;
}): void {
  const {
    trackingCode,
    title,
    date,
    time,
    durationMinutes,
    format,
    hostNames,
    description,
  } = params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return;
  }

  const dtStart = toIcsUtcTimestamp(date, time, 0);
  const dtEnd = toIcsUtcTimestamp(date, time, durationMinutes || 30);
  const nowUtc = new Date();
  const dtStamp =
    `${nowUtc.getUTCFullYear()}${pad2(nowUtc.getUTCMonth() + 1)}${pad2(nowUtc.getUTCDate())}` +
    `T${pad2(nowUtc.getUTCHours())}${pad2(nowUtc.getUTCMinutes())}${pad2(nowUtc.getUTCSeconds())}Z`;

  const location =
    format === 'présentiel'
      ? 'Institut français du Congo — Bilili BD Festival 2026, Brazzaville'
      : 'Rendez-vous en ligne (Visioconférence) — Bilili BD Festival 2026';

  const fullDesc = [
    `Code de suivi : ${trackingCode}`,
    `Interlocuteur(s) : ${hostNames}`,
    `Format : ${format}`,
    `Durée : ${durationMinutes} minutes`,
    description ? `\n${description}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Bilili BD Festival 2026//Institut francais du Congo//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${trackingCode}@bililibd2026.ifc`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeIcsText(title)}`,
    `DESCRIPTION:${escapeIcsText(fullDesc)}`,
    `LOCATION:${escapeIcsText(location)}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  const blob = new Blob([lines.join('\r\n')], {
    type: 'text/calendar;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bilili-rdv-${trackingCode.toLowerCase()}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function formatHostsList(hostIds: string[], hosts: HostConfig[]): string {
  return hostIds
    .map((id) => hosts.find((h) => h.hostId === id)?.name || id)
    .join(', ');
}
