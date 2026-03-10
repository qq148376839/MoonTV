/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

import {
  addSearchHistory,
  getSearchHistory,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { getStreamSearchUrl } from '@/lib/search-config';
import { SearchResult } from '@/lib/types';

import { useTvFocusable } from '@/components/tv/TvFocusProvider';
import TvSearchSuggestion from '@/components/tv/TvSearchSuggestion';
import TvVideoCard from '@/components/tv/TvVideoCard';

const ROW_INPUT = 1;
const ROW_SUGGESTIONS = 2;
const ROW_HISTORY = 3;
const ROW_RESULTS_START = 4;

function TvSearchClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [doubanTitles, setDoubanTitles] = useState<string[]>([]);
  const sseRef = useRef<EventSource | null>(null);

  const inputRef = useTvFocusable(ROW_INPUT, 0);

  // Load search history
  useEffect(() => {
    getSearchHistory().then(setSearchHistory);
    const unsub = subscribeToDataUpdates(
      'searchHistoryUpdated',
      (h: string[]) => setSearchHistory(h)
    );
    return unsub;
  }, []);

  // Load douban titles from session cache
  useEffect(() => {
    try {
      const cached = sessionStorage.getItem('tv_douban_titles');
      if (cached) setDoubanTitles(JSON.parse(cached));
    } catch {
      // ignore
    }
  }, []);

  // React to URL search params
  useEffect(() => {
    const q = searchParams.get('q');
    if (q) {
      setQuery(q);
      executeSearch(q);
      addSearchHistory(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
    };
  }, []);

  const executeSearch = useCallback((q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;

    // Close existing SSE
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }

    setIsLoading(true);
    setResults([]);

    const url = getStreamSearchUrl(trimmed);
    const es = new EventSource(url);
    sseRef.current = es;

    const accumulated: SearchResult[] = [];
    const seen = new Set<string>();

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.done) {
          es.close();
          sseRef.current = null;
          setIsLoading(false);
          // Save results to sessionStorage for detail page
          try {
            sessionStorage.setItem(
              `search_results_${trimmed}`,
              JSON.stringify({
                query: trimmed,
                results: accumulated,
                timestamp: Date.now(),
              })
            );
          } catch {
            // ignore
          }
          return;
        }
        if (data.results && Array.isArray(data.results)) {
          const newItems = data.results.filter((r: SearchResult) => {
            const key = `${r.source}-${r.id}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          if (newItems.length > 0) {
            accumulated.push(...newItems);
            setResults([...accumulated]);
            if (accumulated.length > 0) setIsLoading(false);
          }
        }
      } catch (err) {
        console.error('[TV SSE] Parse error:', err);
      }
    };

    es.onerror = () => {
      es.close();
      sseRef.current = null;
      setIsLoading(false);
    };
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    router.push(`/tv/search?q=${encodeURIComponent(trimmed)}`);
  }

  function handleSuggestionSelect(title: string) {
    setQuery(title);
    router.push(`/tv/search?q=${encodeURIComponent(title)}`);
  }

  function handleHistorySelect(item: string) {
    setQuery(item);
    router.push(`/tv/search?q=${encodeURIComponent(item)}`);
  }

  // Group results into rows of 5
  const COLS_PER_ROW = 5;

  return (
    <div>
      {/* Search input */}
      <form onSubmit={handleSubmit} className='mb-6'>
        <input
          ref={inputRef}
          type='text'
          className='tv-search-input'
          placeholder='搜索电影、电视剧... (支持拼音首字母)'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </form>

      {/* Pinyin suggestions */}
      {!searchParams.get('q') && (
        <TvSearchSuggestion
          input={query}
          onSelect={handleSuggestionSelect}
          row={ROW_SUGGESTIONS}
          searchHistory={searchHistory}
          doubanTitles={doubanTitles}
        />
      )}

      {/* Search history */}
      {!searchParams.get('q') && searchHistory.length > 0 && (
        <div className='mt-6'>
          <h3 className='mb-3 text-lg font-semibold text-gray-400'>搜索历史</h3>
          <div className='flex flex-wrap gap-3'>
            {searchHistory.map((item, idx) => (
              <HistoryPill
                key={item}
                label={item}
                row={ROW_HISTORY}
                col={idx}
                onSelect={() => handleHistorySelect(item)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && results.length === 0 && (
        <div className='flex justify-center py-20'>
          <div className='tv-spinner' />
        </div>
      )}

      {/* Results grid */}
      {results.length > 0 && (
        <div className='mt-8'>
          <h3 className='mb-4 text-lg font-semibold text-gray-400'>
            搜索结果 ({results.length})
          </h3>
          <div className='grid grid-cols-5 gap-4'>
            {results.map((item, idx) => (
              <TvVideoCard
                key={`${item.source}-${item.id}`}
                poster={item.poster}
                title={item.title}
                source={item.source}
                id={item.id}
                year={item.year}
                episodes={item.episodes.length}
                row={ROW_RESULTS_START + Math.floor(idx / COLS_PER_ROW)}
                col={idx % COLS_PER_ROW}
                query={query.trim()}
                from='search'
              />
            ))}
          </div>
        </div>
      )}

      {/* No results */}
      {!isLoading && results.length === 0 && searchParams.get('q') && (
        <div className='text-center text-gray-500 py-20 text-xl'>
          未找到相关结果
        </div>
      )}
    </div>
  );
}

function HistoryPill({
  label,
  row,
  col,
  onSelect,
}: {
  label: string;
  row: number;
  col: number;
  onSelect: () => void;
}) {
  const ref = useTvFocusable(row, col);
  return (
    <button
      ref={ref}
      className='tv-history-pill'
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSelect();
      }}
    >
      {label}
    </button>
  );
}

export default function TvSearchPage() {
  return (
    <Suspense>
      <TvSearchClient />
    </Suspense>
  );
}
