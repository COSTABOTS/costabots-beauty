export type PairingMethod = 'code' | 'qr';

export function normalizeInternationalPhone(value: unknown) {
  const raw = String(value ?? '').trim();
  if (/^\+00/.test(raw)) return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  // E.164 allows up to 15 digits. We deliberately do not infer a country code.
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return digits;
}

export function pairingCodeFromProvider(value: unknown, allowConnectCode = false) {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const nested = record.pairingCode && typeof record.pairingCode === 'object' && !Array.isArray(record.pairingCode)
    ? record.pairingCode as Record<string, unknown>
    : {};
  const candidates = [
    record.pairingCode,
    record.pairing_code,
    nested.pairingCode,
    nested.pairing_code,
    nested.code,
    ...(allowConnectCode ? [record.code] : []),
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const code = candidate.trim();
    if (/^[A-Za-z0-9-]{4,32}$/.test(code)) return code;
  }
  // Deliberately never use `base64`: Evolution uses it for QR image data.
  return null;
}

export function canRequestPairingCode(authorized: boolean, connectionStatus: string) {
  return authorized && connectionStatus !== 'connected';
}

export function shouldStopPairingPolling(connectionStatus: string) {
  return connectionStatus === 'connected';
}
