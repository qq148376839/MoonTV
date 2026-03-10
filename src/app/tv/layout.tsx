'use client';

import { useTheme } from 'next-themes';
import { useEffect } from 'react';

import './tv.css';

import { TvFocusProvider } from '@/components/tv/TvFocusProvider';
import TvNavRail from '@/components/tv/TvNavRail';

export default function TvLayout({ children }: { children: React.ReactNode }) {
  const { setTheme } = useTheme();

  // Force dark theme for TV UI
  useEffect(() => {
    setTheme('dark');
  }, [setTheme]);

  return (
    <TvFocusProvider>
      <div className='min-h-screen bg-black text-gray-100'>
        <TvNavRail />
        <main className='tv-page'>{children}</main>
      </div>
    </TvFocusProvider>
  );
}
