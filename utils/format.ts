/**
 * Extrae un número de teléfono de un campo vCard.
 * Por ejemplo: "TEL;TYPE=CELL:+1234567890" → "+1234567890"
 */
export function extractPhoneNumberFromVCard(vcard: string): string | undefined {
  const match = vcard.match(/TEL.*?:[^+\d]*(\+?\d+)/);
  return match ? match[1] : undefined;
}
