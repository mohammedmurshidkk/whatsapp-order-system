/**
 * i18n (Internationalization) module for WhatsApp Ordering System
 *
 * Provides translation support with Malayalam as the default language.
 * Users can switch to English by saying "English please" or similar.
 */

import { en } from './translations/en';
import { ml } from './translations/ml';

export type SupportedLanguage = 'en' | 'ml';
export const DEFAULT_LANGUAGE: SupportedLanguage = 'ml';

const translations = {
  en: en as typeof en, // Cast to ensure same structure
  ml,
};

/**
 * Get a translation string by key with parameter substitution
 *
 * @param key - Dot-notation key (e.g., 'cart.added', 'order.confirmed')
 * @param lang - Language code ('en' or 'ml'), defaults to Malayalam
 * @param params - Optional parameters to substitute (e.g., { item: 'Chocolate Cake' })
 * @returns Translated string with parameters substituted
 *
 * @example
 * t('cart.added', 'ml', { item: 'Black Forest' })
 * // Returns: "Black Forest കാർട്ടിൽ ചേർത്തു! 🛒"
 *
 * t('cart.added', 'en', { item: 'Black Forest' })
 * // Returns: "Added Black Forest to your cart! 🛒"
 *
 * Fallback behavior:
 * 1. If key not found in requested language -> try DEFAULT_LANGUAGE (ml)
 * 2. If key not found in default -> return the key itself (for debugging)
 */
export function t(
  key: string,
  lang: SupportedLanguage = DEFAULT_LANGUAGE,
  params?: Record<string, string | number>
): string {
  const keys = key.split('.');

  // Try requested language first
  let value: unknown = translations[lang];
  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      value = undefined;
      break;
    }
  }

  // Fallback to default language if not found
  if (value === undefined && lang !== DEFAULT_LANGUAGE) {
    value = translations[DEFAULT_LANGUAGE];
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = (value as Record<string, unknown>)[k];
      } else {
        value = undefined;
        break;
      }
    }
  }

  // Return key if nothing found (debugging aid)
  if (typeof value !== 'string') {
    console.warn(`[i18n] Missing translation: ${key} (${lang})`);
    return key;
  }

  // Substitute parameters: {{paramName}} -> value
  if (params) {
    return value.replace(/\{\{(\w+)\}\}/g, (match, paramKey) => {
      const paramValue = params[paramKey];
      return paramValue !== undefined ? paramValue.toString() : match;
    });
  }

  return value;
}

/**
 * Detect if user is requesting a language switch
 *
 * @param message - User's message text
 * @returns 'en' if requesting English, 'ml' if requesting Malayalam, null otherwise
 *
 * @example
 * detectLanguageRequest("English please") // Returns: 'en'
 * detectLanguageRequest("respond in malayalam") // Returns: 'ml'
 * detectLanguageRequest("I want cake") // Returns: null
 */
export function detectLanguageRequest(message: string): SupportedLanguage | null {
  const lowerMessage = message.toLowerCase().trim();

  // English request patterns
  const englishPatterns = [
    /\benglish\s*please\b/,
    /\bin\s*english\b/,
    /\brespond\s*in\s*english\b/,
    /\breply\s*in\s*english\b/,
    /\bspeak\s*english\b/,
    /\bswitch\s*to\s*english\b/,
    /\buse\s*english\b/,
    /^english$/,
  ];

  // Malayalam request patterns
  const malayalamPatterns = [
    /\bmalayalam\b/,
    /\bമലയാളം\b/,
    /\bin\s*malayalam\b/,
    /\brespond\s*in\s*malayalam\b/,
    /\bswitch\s*to\s*malayalam\b/,
    /\buse\s*malayalam\b/,
  ];

  for (const pattern of englishPatterns) {
    if (pattern.test(lowerMessage)) {
      return 'en';
    }
  }

  for (const pattern of malayalamPatterns) {
    if (pattern.test(lowerMessage)) {
      return 'ml';
    }
  }

  return null;
}

/**
 * Get language name in that language (for display)
 */
export function getLanguageName(lang: SupportedLanguage): string {
  const names: Record<SupportedLanguage, string> = {
    en: 'English',
    ml: 'മലയാളം',
  };
  return names[lang];
}

// Re-export types
export type { TranslationKeys } from './translations/ml';
