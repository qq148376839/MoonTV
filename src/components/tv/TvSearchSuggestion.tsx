/* eslint-disable no-console */

'use client';

import { useEffect, useRef, useState } from 'react';

import { matchByPinyin } from '@/lib/tv-pinyin';

import { useTvFocusable } from './TvFocusProvider';

interface TvSearchSuggestionProps {
  /** Current input value */
  input: string;
  /** Called when user selects a suggestion */
  onSelect: (title: string) => void;
  /** Focus grid row start (suggestions occupy this row) */
  row: number;
  /** Search history for dictionary augmentation */
  searchHistory?: string[];
  /** Douban titles for dictionary augmentation */
  doubanTitles?: string[];
}

// Static dictionary loaded once from /dict/tv-titles.json
let staticDict: string[] | null = null;
let dictLoading = false;
const dictWaiters: Array<(d: string[]) => void> = [];

function loadStaticDict(): Promise<string[]> {
  if (staticDict) return Promise.resolve(staticDict);
  if (dictLoading) {
    return new Promise<string[]>((resolve) => {
      dictWaiters.push(resolve);
    });
  }
  dictLoading = true;
  return fetch('/dict/tv-titles.json')
    .then((res) => res.json())
    .then((data: { movies: string[]; tv: string[] }) => {
      staticDict = [...data.movies, ...data.tv];
      const resolved = staticDict;
      dictWaiters.forEach((w) => w(resolved));
      dictWaiters.length = 0;
      return resolved;
    })
    .catch((err) => {
      console.warn('[TvSearch] Failed to load static dictionary:', err);
      staticDict = [];
      const resolved = staticDict;
      dictWaiters.forEach((w) => w(resolved));
      dictWaiters.length = 0;
      return resolved;
    });
}

export default function TvSearchSuggestion({
  input,
  onSelect,
  row,
  searchHistory = [],
  doubanTitles = [],
}: TvSearchSuggestionProps) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const dictRef = useRef<string[]>([]);

  // Load and merge dictionaries
  useEffect(() => {
    loadStaticDict().then((base) => {
      // Merge: static + douban + history, deduplicate
      const seen = new Set<string>();
      const merged: string[] = [];
      for (const list of [base, doubanTitles, searchHistory]) {
        for (const item of list) {
          if (item && !seen.has(item)) {
            seen.add(item);
            merged.push(item);
          }
        }
      }
      dictRef.current = merged;
    });
  }, [doubanTitles, searchHistory]);

  // Match on input change
  useEffect(() => {
    if (!input || input.length === 0) {
      setSuggestions([]);
      return;
    }
    // Only match if input looks like pinyin (latin characters)
    if (!/^[a-zA-Z]+$/.test(input.replace(/\s/g, ''))) {
      setSuggestions([]);
      return;
    }
    const matched = matchByPinyin(input, dictRef.current, 8);
    setSuggestions(matched);
  }, [input]);

  if (suggestions.length === 0) return null;

  return (
    <div className='mt-2 rounded-lg bg-gray-900 border border-gray-700 overflow-hidden'>
      {suggestions.map((title, idx) => (
        <SuggestionItem
          key={title}
          title={title}
          row={row}
          col={idx}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function SuggestionItem({
  title,
  row,
  col,
  onSelect,
}: {
  title: string;
  row: number;
  col: number;
  onSelect: (title: string) => void;
}) {
  const ref = useTvFocusable(row, col);

  return (
    <button
      ref={ref}
      className='tv-suggestion-item w-full text-left'
      onClick={() => onSelect(title)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSelect(title);
      }}
    >
      {title}
    </button>
  );
}
