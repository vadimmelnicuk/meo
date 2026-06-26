declare module 'cspell-lib' {
  export interface CSpellUserSettings {
    [key: string]: unknown;
  }

  export interface ValidationIssue {
    text: string;
    offset: number;
    length?: number;
    message?: string;
    suggestions?: string[];
  }

  export interface SpellCheckDocumentResult {
    checked: boolean;
    issues: ValidationIssue[];
  }

  export function getDefaultSettings(): CSpellUserSettings;
  export function mergeSettings(...settings: CSpellUserSettings[]): CSpellUserSettings;
  export function searchForConfig(searchFrom: string | URL | undefined): Promise<CSpellUserSettings | undefined>;
  export function spellCheckDocument(
    document: { uri: string; text: string; languageId?: string; locale?: string },
    options: { generateSuggestions?: boolean; noConfigSearch?: boolean },
    settings: CSpellUserSettings
  ): Promise<SpellCheckDocumentResult>;
}
