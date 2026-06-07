/* eslint-disable no-console */

'use client';

import { useSearchParams } from 'next/navigation';
import React from 'react';

import { BackButton } from '@/components/BackButton';
import LocalResourceDetail from '@/components/LocalResourceDetail';
import PageLayout from '@/components/PageLayout';

export default function OfflineResourcePageClient() {
  const sp = useSearchParams();
  const source = sp.get('source') || '';
  const id = sp.get('id') || '';

  return (
    <PageLayout activePath='/offline'>
      <div className='px-4 sm:px-10 py-4 sm:py-8'>
        <div className='mb-4 flex items-center gap-2'>
          <BackButton />
          <h1 className='text-xl font-bold text-gray-900 dark:text-gray-100'>
            本地资源详情
          </h1>
        </div>

        {!source || !id ? (
          <div className='text-sm text-red-600 dark:text-red-400'>
            缺少必要参数：source / id
          </div>
        ) : (
          <LocalResourceDetail source={source} id={id} />
        )}
      </div>
    </PageLayout>
  );
}
