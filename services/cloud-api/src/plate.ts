/** Буквы серии РФ (кириллица), допускающие латиницу-lookalike при вводе */
const RF_LETTERS = "АВЕКМНОРСТУХ";
const LATIN_TO_CYR: Record<string, string> = {
  A: "А",
  B: "В",
  E: "Е",
  K: "К",
  M: "М",
  H: "Н",
  O: "О",
  P: "Р",
  C: "С",
  T: "Т",
  Y: "У",
  X: "Х",
};

/** Канон: цифры + заглавные кириллические буквы серии, без пробелов (А170РТ90). */
export function normalizePlate(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[\s\-_.]/g, "")
    .replace(/[A-Z]/g, (ch) => LATIN_TO_CYR[ch] ?? ch);
}

/**
 * Валидация госномера легкового РФ:
 * буква + 3 цифры + 2 буквы + регион 2–3 цифры (пример А170РТ90).
 */
export function isValidRfPlate(normalized: string): boolean {
  const letter = `[${RF_LETTERS}]`;
  const re = new RegExp(`^${letter}\\d{3}${letter}{2}\\d{2,3}$`);
  return re.test(normalized);
}

/** Нормализация + валидация. null если пусто или невалидно. */
export function parseRfPlate(raw: string): string | null {
  const plate = normalizePlate(raw);
  if (!plate) return null;
  return isValidRfPlate(plate) ? plate : null;
}
