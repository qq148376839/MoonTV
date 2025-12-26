'use client';

import { createContext, ReactNode, useContext } from 'react';

interface SiteContextValue {
  siteName: string;
  announcement: string;
}

const SiteContext = createContext<SiteContextValue | undefined>(undefined);

interface SiteProviderProps {
  siteName: string;
  announcement: string;
  children: ReactNode;
}

export function SiteProvider({
  siteName,
  announcement,
  children,
}: SiteProviderProps) {
  return (
    <SiteContext.Provider value={{ siteName, announcement }}>
      {children}
    </SiteContext.Provider>
  );
}

export function useSite(): SiteContextValue {
  const context = useContext(SiteContext);
  if (context === undefined) {
    throw new Error('useSite must be used within a SiteProvider');
  }
  return context;
}
