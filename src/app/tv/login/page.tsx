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

  // Plain JS value storage — immune to React closure/state issues
  const passwordValueRef = useRef('');
  const usernameValueRef = useRef('');

  // DOM element refs
  const passwordElRef = useRef<HTMLInputElement | null>(null);
  const usernameElRef = useRef<HTMLInputElement | null>(null);

  const setUsernameRef = useCallback(
    (el: HTMLInputElement | null) => {
      usernameElRef.current = el;
      if (typeof focusUsernameRef === 'function') focusUsernameRef(el);
    },
    [focusUsernameRef]
  );

  const setPasswordRef = useCallback(
    (el: HTMLInputElement | null) => {
      passwordElRef.current = el;
      if (typeof focusPasswordRef === 'function') focusPasswordRef(el);
    },
    [focusPasswordRef]
  );

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storageType = (window as any).RUNTIME_CONFIG?.STORAGE_TYPE;
      setShouldAskUsername(storageType && storageType !== 'localstorage');
    }
  }, []);

  // Track input values via native DOM 'input' event listeners.
  // This captures IME composition, paste, autocomplete — everything.
  // React's onChange may not fire reliably in Android TV WebView.
  useEffect(() => {
    const pwEl = passwordElRef.current;
    const unEl = usernameElRef.current;

    const onPwInput = () => {
      passwordValueRef.current = pwEl?.value ?? '';
    };
    const onUnInput = () => {
      usernameValueRef.current = unEl?.value ?? '';
    };

    pwEl?.addEventListener('input', onPwInput);
    unEl?.addEventListener('input', onUnInput);

    // Also capture compositionend for CJK IME
    pwEl?.addEventListener('compositionend', onPwInput);
    unEl?.addEventListener('compositionend', onUnInput);

    return () => {
      pwEl?.removeEventListener('input', onPwInput);
      unEl?.removeEventListener('input', onUnInput);
      pwEl?.removeEventListener('compositionend', onPwInput);
      unEl?.removeEventListener('compositionend', onUnInput);
    };
  }, [shouldAskUsername]);

  const doLogin = useCallback(async () => {
    // Read from multiple sources for maximum reliability
    const pw =
      passwordValueRef.current.trim() ||
      passwordElRef.current?.value?.trim() ||
      (
        document.querySelector(
          'input[type="password"]'
        ) as HTMLInputElement | null
      )?.value?.trim() ||
      '';

    const un =
      usernameValueRef.current.trim() ||
      usernameElRef.current?.value?.trim() ||
      '';

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

  // Native keydown listener on password input — Enter triggers login.
  // NOT using React onKeyDown because React event delegation may fail
  // in Android TV WebView.
  useEffect(() => {
    const pwEl = passwordElRef.current;
    if (!pwEl) return;

    const handler = (e: Event) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        doLogin();
      }
    };

    // Use capture phase to run before TvFocusProvider's handler
    pwEl.addEventListener('keydown', handler, true);
    return () => pwEl.removeEventListener('keydown', handler, true);
  }, [doLogin]);

  // Native click listener on button as backup — ensures doLogin runs
  // even if React's onClick delegation fails in the WebView.
  useEffect(() => {
    const btn = document.getElementById('tv-login-btn');
    if (!btn) return;

    const handler = (e: Event) => {
      e.preventDefault();
      doLogin();
    };

    btn.addEventListener('click', handler);
    return () => btn.removeEventListener('click', handler);
  }, [doLogin]);

  return (
    <div className='flex min-h-screen items-center justify-center'>
      <div className='w-full max-w-lg rounded-2xl bg-gray-900 p-10'>
        <h1 className='mb-8 text-center text-3xl font-bold text-green-500'>
          MoonTV
        </h1>
        {/* No <form> element — avoids any risk of native form submission
            causing a page reload in Android TV WebView */}
        <div className='space-y-6'>
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
          {error && (
            <p className='text-red-400 text-lg text-center'>{error}</p>
          )}
          <button
            id='tv-login-btn'
            ref={focusSubmitRef}
            type='button'
            disabled={loading}
            className='tv-focusable w-full rounded-lg bg-green-600 py-4 text-xl font-semibold text-white disabled:opacity-50'
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </div>
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
