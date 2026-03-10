/* eslint-disable no-console */

'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from 'react';

// ----- Types -----

interface FocusableEntry {
  row: number;
  col: number;
  element: HTMLElement;
}

interface TvFocusContextValue {
  register: (row: number, col: number, element: HTMLElement) => void;
  unregister: (element: HTMLElement) => void;
}

const TvFocusContext = createContext<TvFocusContextValue | null>(null);

// ----- Provider -----

export function TvFocusProvider({ children }: { children: React.ReactNode }) {
  const entriesRef = useRef<FocusableEntry[]>([]);
  const colMemoryRef = useRef<Map<number, number>>(new Map());

  const register = useCallback(
    (row: number, col: number, element: HTMLElement) => {
      // Avoid duplicates
      const existing = entriesRef.current.find((e) => e.element === element);
      if (existing) {
        existing.row = row;
        existing.col = col;
        return;
      }
      entriesRef.current.push({ row, col, element });
    },
    []
  );

  const unregister = useCallback((element: HTMLElement) => {
    entriesRef.current = entriesRef.current.filter(
      (e) => e.element !== element
    );
  }, []);

  // Spatial navigation handler
  useEffect(() => {
    function getActiveEntry(): FocusableEntry | undefined {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return undefined;
      return entriesRef.current.find((e) => e.element === active);
    }

    function getEntriesInRow(row: number): FocusableEntry[] {
      return entriesRef.current
        .filter((e) => e.row === row)
        .sort((a, b) => a.col - b.col);
    }

    function getAllRows(): number[] {
      const rows = new Set(entriesRef.current.map((e) => e.row));
      return Array.from(rows).sort((a, b) => a - b);
    }

    function handleKeyDown(e: KeyboardEvent) {
      const current = getActiveEntry();
      if (!current) return;

      let target: FocusableEntry | undefined;

      switch (e.key) {
        case 'ArrowRight': {
          const rowEntries = getEntriesInRow(current.row);
          target = rowEntries.find((en) => en.col > current.col);
          break;
        }
        case 'ArrowLeft': {
          const rowEntries = getEntriesInRow(current.row);
          target = [...rowEntries].reverse().find((en) => en.col < current.col);
          break;
        }
        case 'ArrowDown': {
          colMemoryRef.current.set(current.row, current.col);
          const rows = getAllRows();
          const currentIdx = rows.indexOf(current.row);
          if (currentIdx < rows.length - 1) {
            const nextRow = rows[currentIdx + 1];
            const remembered = colMemoryRef.current.get(nextRow);
            const nextEntries = getEntriesInRow(nextRow);
            const targetCol = remembered ?? current.col;
            // Find closest column
            target = nextEntries.reduce<FocusableEntry | undefined>(
              (closest, en) => {
                if (!closest) return en;
                return Math.abs(en.col - targetCol) <
                  Math.abs(closest.col - targetCol)
                  ? en
                  : closest;
              },
              undefined
            );
          }
          break;
        }
        case 'ArrowUp': {
          colMemoryRef.current.set(current.row, current.col);
          const rows = getAllRows();
          const currentIdx = rows.indexOf(current.row);
          if (currentIdx > 0) {
            const prevRow = rows[currentIdx - 1];
            const remembered = colMemoryRef.current.get(prevRow);
            const prevEntries = getEntriesInRow(prevRow);
            const targetCol = remembered ?? current.col;
            target = prevEntries.reduce<FocusableEntry | undefined>(
              (closest, en) => {
                if (!closest) return en;
                return Math.abs(en.col - targetCol) <
                  Math.abs(closest.col - targetCol)
                  ? en
                  : closest;
              },
              undefined
            );
          }
          break;
        }
        default:
          return; // Don't preventDefault for other keys
      }

      if (target) {
        e.preventDefault();
        target.element.focus({ preventScroll: false });
        // Scroll into view if in a scrollable row
        target.element.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'nearest',
        });
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <TvFocusContext.Provider value={{ register, unregister }}>
      {children}
    </TvFocusContext.Provider>
  );
}

// ----- Hook -----

export function useTvFocusable(
  row: number,
  col: number
): React.RefCallback<HTMLElement> {
  const ctx = useContext(TvFocusContext);
  const prevRef = useRef<HTMLElement | null>(null);

  return useCallback(
    (node: HTMLElement | null) => {
      if (!ctx) return;
      // Cleanup previous
      if (prevRef.current) {
        ctx.unregister(prevRef.current);
      }
      if (node) {
        // Make focusable
        if (!node.getAttribute('tabindex')) {
          node.setAttribute('tabindex', '0');
        }
        ctx.register(row, col, node);
      }
      prevRef.current = node;
    },
    [ctx, row, col]
  );
}
