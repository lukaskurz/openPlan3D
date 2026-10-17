import { en } from '$lib/i18n/locales/en';
import type { TranslationKey } from '$lib/i18n';
import { prefersTouch } from '$lib/utils/inputDevice';

/**
 * The touch wording of a hint when this is a touch screen and the hint has one (`<key>.touch`),
 * so no hint asks for a click or a key on an iPad.
 */
export function hintKey(key: string, touch = prefersTouch()): TranslationKey {
  const touchKey = `${key}.touch`;
  return (touch && Object.hasOwn(en, touchKey) ? touchKey : key) as TranslationKey;
}
