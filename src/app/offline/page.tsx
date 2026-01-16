/* eslint-disable no-console */

'use client';

import React, { useState } from 'react';

import DownloadTaskList from '@/components/DownloadTaskList';
import LocalResourceList from '@/components/LocalResourceList';
import PageLayout from '@/components/PageLayout';

export default function OfflinePage() {
  const [tab, setTab] = useState<'tasks' | 'library'>('tasks');

  return (
    <PageLayout activePath='/offline'>
      <div className='px-4 sm:px-10 py-4 sm:py-8'>
        <div className='flex items-center justify-between mb-6'>
          <h1 className='text-2xl font-bold text-gray-900 dark:text-gray-100'>
            离线
          </h1>
        </div>

        <div className='mb-6 flex gap-2'>
          <button
            onClick={() => setTab('tasks')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'tasks'
                ? 'bg-green-500 text-white'
                : 'bg-gray-200/70 dark:bg-white/10 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/20'
            }`}
          >
            下载中
          </button>
          <button
            onClick={() => setTab('library')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'library'
                ? 'bg-green-500 text-white'
                : 'bg-gray-200/70 dark:bg-white/10 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/20'
            }`}
          >
            已下载
          </button>
        </div>

        {tab === 'tasks' ? <DownloadTaskList /> : <LocalResourceList />}
      </div>
    </PageLayout>
  );
}

