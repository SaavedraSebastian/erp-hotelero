export function maskDocument(value: string | null | undefined, canViewFullPII: boolean): string {
  if (!value) return '';
  if (canViewFullPII) return value;
  const trimmed = value.trim();
  if (trimmed.length <= 2) return '••';
  return `${'*'.repeat(Math.max(4, trimmed.length - 2))}${trimmed.slice(-2)}`;
}

export function maskEmail(value: string | null | undefined, canViewFullPII: boolean): string | null {
  if (!value) return null;
  if (canViewFullPII) return value;
  const [local, domain] = value.trim().split('@');
  if (!domain) return '***';
  const visible = local.slice(0, 1) || '*';
  return `${visible}***@${domain}`;
}

export function maskPhone(value: string | null | undefined, canViewFullPII: boolean): string | null {
  if (!value) return null;
  if (canViewFullPII) return value;
  const trimmed = value.trim();
  if (trimmed.length <= 3) return '***';
  return `${'*'.repeat(Math.max(4, trimmed.length - 3))}${trimmed.slice(-3)}`;
}
