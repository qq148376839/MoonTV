import { Suspense } from 'react';

import OfflineResourcePageClient from './OfflineResourcePageClient';

export default function OfflineResourcePage() {
  // Next.js: useSearchParams() must be used within a Suspense boundary to avoid CSR-bailout build errors.
  return (
    <Suspense
      fallback={<div className='px-4 sm:px-10 py-4 sm:py-8'>Loading...</div>}
    >
      <OfflineResourcePageClient />
    </Suspense>
  );
}
