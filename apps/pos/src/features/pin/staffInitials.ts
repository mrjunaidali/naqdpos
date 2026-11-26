/** "Mian Sami" → "MS": the chip on a phone, where the header has no room for the name. */
export function staffInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => [...word][0]!.toUpperCase())
    .join('');
}
