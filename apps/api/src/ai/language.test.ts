import { describe, expect, it } from 'vitest';
import { inLanguagePrompt, languageInstruction } from './language';

describe('AI language line', () => {
  it('leaves English prompts as they are and names the language otherwise', () => {
    expect(languageInstruction('en')).toBeNull();
    expect(inLanguagePrompt('You draft emails.', 'en')).toBe('You draft emails.');
    for (const [code, name] of [['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['ar', 'Arabic']] as const) {
      const prompt = inLanguagePrompt('You draft emails.', code);
      expect(prompt.startsWith('You draft emails.\n\nLanguage: ')).toBe(true);
      expect(prompt).toContain(`in ${name}.`);
    }
  });
});
