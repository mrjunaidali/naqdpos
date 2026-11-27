import { describe, expect, it } from 'vitest';
import { emailLanguage, EmailLanguageSchema } from './emailLanguage.ts';

describe('emailLanguage', () => {
  it.each(['ur', 'UR', 'ur-PK', 'ur_PK', ' ur '])('%j → Urdu', (value) => {
    expect(emailLanguage(value)).toBe('ur');
  });

  it.each(['en', 'en-US', 'urd', 'fr', '', null, undefined])('%j → English', (value) => {
    expect(emailLanguage(value)).toBe('en');
  });

  it('the schema accepts only en and ur', () => {
    expect(EmailLanguageSchema.safeParse('ur').success).toBe(true);
    expect(EmailLanguageSchema.safeParse('fr').success).toBe(false);
  });
});
