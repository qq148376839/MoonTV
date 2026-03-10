/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { useTvFocusable } from '@/components/tv/TvFocusProvider';

function TvLoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shouldAskUsername, setShouldAskUsername] = useState(false);

  const usernameRef = useTvFocusable(1, 0);
  const passwordRef = useTvFocusable(2, 0);
  const submitRef = useTvFocusable(3, 0);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storageType = (window as any).RUNTIME_CONFIG?.STORAGE_TYPE;
      setShouldAskUsername(storageType && storageType !== 'localstorage');
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    if (!password || (shouldAskUsername && !username)) return;

    try {
      setLoading(true);
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          ...(shouldAskUsername ? { username } : {}),
        }),
      });

      if (res.ok) {
        const redirect = searchParams.get('redirect') || '/tv';
        router.replace(redirect);
      } else if (res.status === 401) {
        setError('密码错误');
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? '服务器错误');
      }
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='flex min-h-screen items-center justify-center'>
      <div className='w-full max-w-lg rounded-2xl bg-gray-900 p-10'>
        <h1 className='mb-8 text-center text-3xl font-bold text-green-500'>
          MoonTV
        </h1>
        <form onSubmit={handleSubmit} className='space-y-6'>
          {shouldAskUsername && (
            <input
              ref={usernameRef}
              type='text'
              className='tv-login-input'
              placeholder='输入用户名'
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete='username'
            />
          )}
          <input
            ref={passwordRef}
            type='password'
            className='tv-login-input'
            placeholder='输入访问密码'
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete='current-password'
            autoFocus
          />
          {error && <p className='text-red-400 text-lg text-center'>{error}</p>}
          <button
            ref={submitRef}
            type='submit'
            disabled={!password || loading || (shouldAskUsername && !username)}
            className='tv-focusable w-full rounded-lg bg-green-600 py-4 text-xl font-semibold text-white disabled:opacity-50'
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function TvLoginPage() {
  return (
    <Suspense>
      <TvLoginClient />
    </Suspense>
  );
}
