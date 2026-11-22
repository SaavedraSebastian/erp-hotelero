const LIMA_TIMEZONE = 'America/Lima';

export function getOperationalDateLima(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: LIMA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function getOperationalTimestampLima(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: LIMA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value;
      return acc;
    }, {});

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}-05:00`;
}
