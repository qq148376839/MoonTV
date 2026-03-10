/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

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

  // Keep refs to actual input elements for native event binding
  const usernameInputRef = useRef<HTMLInputElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);

  // Merge focusable ref + input ref
  const setUsernameRef = useCallback(
    (el: HTMLInputElement | null) => {
      usernameInputRef.current = el;
      if (typeof usernameRef === 'function') {
        usernameRef(el);
      } else if (usernameRef) {
        (usernameRef as React.MutableRefObject<HTMLInputElement | null>).current =
          el;
      }
    },
    [usernameRef]
  );

  const setPasswordRef = useCallback(
    (el: HTMLInputElement | null) => {
      passwordInputRef.current = el;
      if (typeof passwordRef === 'function') {
        passwordRef(el);
      } else if (passwordRef) {
        (passwordRef as React.MutableRefObject<HTMLInputElement | null>).current =
          el;
      }
    },
    [passwordRef]
  );

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storageType = (window as any).RUNTIME_CONFIG?.STORAGE_TYPE;
      setShouldAskUsername(storageType && storageType !== 'localstorage');
    }
  }, []);

  // Use native input event listeners to handle Android TV WebView keyboard
  // React onChange may not fire reliably with all virtual keyboards
  useEffect(() => {
    const pwInput = passwordInputRef.current;
    if (!pwInput) return;
    const handler = () => setPassword(pwInput.value);
    pwInput.addEventListener('input', handler);
    return () => pwInput.removeEventListener('input', handler);
  }, []);

  useEffect(() => {
    const unInput = usernameInputRef.current;
    if (!unInput) return;
    const handler = () => setUsername(unInput.value);
    unInput.addEventListener('input', handler);
    return () => unInput.removeEventListener('input', handler);
  }, [shouldAskUsername]);

  const doLogin = async () => {
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

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Re-read values from DOM in case React state is stale
    if (passwordInputRef.current) {
      setPassword(passwordInputRef.current.value);
    }
    if (usernameInputRef.current) {
      setUsername(usernameInputRef.current.value);
    }
    // Use DOM values directly for the login call
    const pw = passwordInputRef.current?.value || password;
    const un = usernameInputRef.current?.value || username;
    if (!pw || (shouldAskUsername && !un)) return;

    setError(null);
    try {
      setLoading(true);
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
  };

  // Check if button should be disabled - also poll DOM values
  const isDisabled = loading;

  return (
    <div className='flex min-h-screen items-center justify-center'>
      <div className='w-full max-w-lg rounded-2xl bg-gray-900 p-10'>
        <h1 className='mb-8 text-center text-3xl font-bold text-green-500'>
          MoonTV
        </h1>
        <form onSubmit={handleSubmit} className='space-y-6'>
          {shouldAskUsername && (
            <input
              ref={setUsernameRef}
              type='text'
              className='tv-login-input'
              placeholder='输入用户名'
              defaultValue=''
              autoComplete='username'
            />
          )}
          <input
            ref={setPasswordRef}
            type='password'
            className='tv-login-input'
            placeholder='输入访问密码'
            defaultValue=''
            autoComplete='current-password'
            autoFocus
          />
          {error && <p className='text-red-400 text-lg text-center'>{error}</p>}
          <button
            ref={submitRef}
            type='submit'
            disabled={isDisabled}
            className='tv-focusable w-full rounded-lg bg-green-600 py-4 text-xl font-semibold text-white disabled:opacity-50'
            onClick={(e) => {
              // Also handle direct click/Enter on button
              if (!isDisabled) {
                e.preventDefault();
                doLogin();
              }
            }}
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
