/** Нормализация телефона РФ → +7XXXXXXXXXX */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  let d = digits;
  if (d.startsWith("8") && d.length === 11) d = `7${d.slice(1)}`;
  if (d.startsWith("7") && d.length === 11) return `+${d}`;
  if (d.length === 10) return `+7${d}`;
  return null;
}

export function formatPhoneDisplay(phone: string): string {
  const d = phone.replace(/\D/g, "");
  const n = d.startsWith("7") && d.length === 11 ? d.slice(1) : d;
  if (n.length !== 10) return phone;
  return `+7 (${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6, 8)}-${n.slice(8)}`;
}
