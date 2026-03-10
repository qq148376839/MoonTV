/* eslint-disable no-console */

import { pinyin } from 'pinyin-pro';

/**
 * Match dictionary titles by pinyin abbreviation (first letters).
 *
 * Example: input "ls" matches "雷神", "老师", "历史" etc.
 *
 * @param input  User input (latin characters)
 * @param dictionary  Array of Chinese title strings
 * @param limit  Max results to return (default 8)
 */
export function matchByPinyin(
  input: string,
  dictionary: string[],
  limit = 8
): string[] {
  if (!input || input.length === 0) return [];

  const query = input.toLowerCase().replace(/\s/g, '');
  if (!query) return [];

  const results: string[] = [];

  for (const title of dictionary) {
    if (results.length >= limit) break;

    // Get first-letter abbreviation of the title
    const abbr = pinyin(title, {
      pattern: 'first',
      toneType: 'none',
      type: 'array',
    })
      .join('')
      .toLowerCase();

    // Check if abbreviation starts with the query
    if (abbr.startsWith(query)) {
      results.push(title);
      continue;
    }

    // Also check full pinyin contains for partial matching
    const full = pinyin(title, {
      toneType: 'none',
      type: 'string',
    })
      .replace(/\s/g, '')
      .toLowerCase();

    if (full.startsWith(query)) {
      results.push(title);
    }
  }

  return results;
}
