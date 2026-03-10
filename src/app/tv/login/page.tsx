/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

import { useTvFocusable } from '@/components/tv/TvFocusProvider';

function TvLoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shouldAskUsername, setShouldAskUsername] = useState(false);

  const focusUsernameRef = useTvFocusable(1, 0);
  const focusPasswordRef = useTvFocusable(2, 0);
  const focusSubmitRef = useTvFocusable(3, 0);

  // Direct DOM refs for reading input values
  const usernameInputRef = useRef<HTMLInputElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const setUsernameRef = useCallback(
    (el: HTMLInputElement | null) => {
      usernameInputRef.current = el;
      if (typeof focusUsernameRef === 'function') focusUsernameRef(el);
    },
    [focusUsernameRef]
  );

  const setPasswordRef = useCallback(
    (el: HTMLInputElement | null) => {
      passwordInputRef.current = el;
      if (typeof focusPasswordRef === 'function') focusPasswordRef(el);
    },
    [focusPasswordRef]
  );

  const setSubmitRef = useCallback(
    (el: HTMLButtonElement | null) => {
      buttonRef.current = el;
      if (typeof focusSubmitRef === 'function') focusSubmitRef(el);
    },
    [focusSubmitRef]
  );

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storageType = (window as any).RUNTIME_CONFIG?.STORAGE_TYPE;
      setShouldAskUsername(storageType && storageType !== 'localstorage');
    }
  }, []);

  const doLogin = useCallback(async () => {
    const pw = passwordInputRef.current?.value?.trim() || '';
    const un = usernameInputRef.current?.value?.trim() || '';

    if (!pw) {
      setError('请输入密码');
      return;
    }
    if (shouldAskUsername && !un) {
      setError('请输入用户名');
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: pw,
          ...(shouldAskUsername ? { username: un } : {}),
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
  }, [shouldAskUsername, searchParams, router]);

  // Global keydown handler to catch Enter/DpadCenter on the login button
  // Android TV WebView may send Enter or DpadCenter that don't trigger onClick
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter' && document.activeElement === buttonRef.current) {
        e.preventDefault();
        e.stopPropagation();
        doLogin();
      }
    }
    // Use capture phase to run before TvFocusProvider
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [doLogin]);

  return (
    <div className='flex min-h-screen items-center justify-center'>
      <div className='w-full max-w-lg rounded-2xl bg-gray-900 p-10'>
        <h1 className='mb-8 text-center text-3xl font-bold text-green-500'>
          MoonTV
        </h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            doLogin();
          }}
          className='space-y-6'
        >
          {shouldAskUsername && (
            <input
              ref={setUsernameRef}
              type='text'
              className='tv-login-input'
              placeholder='输入用户名'
              autoComplete='username'
            />
          )}
          <input
            ref={setPasswordRef}
            type='password'
            className='tv-login-input'
            placeholder='输入访问密码'
            autoComplete='current-password'
            autoFocus
          />
          {error && <p className='text-red-400 text-lg text-center'>{error}</p>}
          <button
            ref={setSubmitRef}
            type='submit'
            disabled={loading}
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
