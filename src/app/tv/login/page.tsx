/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

import { useTvFocusable } from '@/components/tv/TvFocusProvider';

// BUILD_TS is used to verify the correct version is loaded in the WebView
const BUILD_TS = '20260310-v8';

// Direct DOM debug writer — completely bypasses React state.
// Works even if React's state/rendering has issues in the WebView.
function debugWrite(msg: string) {
  try {
    const el = document.getElementById('tv-debug-log');
    if (!el) return;
    const line = document.createElement('div');
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    el.appendChild(line);
    // Keep only last 15 entries
    while (el.children.length > 15) {
      if (el.firstChild) el.removeChild(el.firstChild);
    }
    el.scrollTop = el.scrollHeight;
  } catch {
    // ignore
  }
}

function TvLoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shouldAskUsername, setShouldAskUsername] = useState(false);

  const focusUsernameRef = useTvFocusable(1, 0);
  const focusPasswordRef = useTvFocusable(2, 0);
  const focusSubmitRef = useTvFocusable(3, 0);

  // Plain JS value storage
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
    debugWrite(`=== MoonTV Login ${BUILD_TS} ===`);
    if (typeof window !== 'undefined') {
      const storageType = (window as any).RUNTIME_CONFIG?.STORAGE_TYPE;
      setShouldAskUsername(storageType && storageType !== 'localstorage');
      debugWrite(`init: storage=${storageType || 'localstorage'}`);
      debugWrite(`ua: ${navigator.userAgent.slice(0, 60)}`);
    }
  }, []);

  // Track input values via native DOM event listeners
  useEffect(() => {
    const pwEl = passwordElRef.current;
    const unEl = usernameElRef.current;

    debugWrite(`refs: pw=${!!pwEl}, un=${!!unEl}`);

    const onPwInput = () => {
      const val = pwEl?.value ?? '';
      passwordValueRef.current = val;
      debugWrite(`pw-input: len=${val.length}`);
    };
    const onUnInput = () => {
      usernameValueRef.current = unEl?.value ?? '';
    };

    const pwEvents = ['input', 'compositionend', 'change', 'keyup'];
    const unEvents = ['input', 'compositionend', 'change', 'keyup'];

    pwEvents.forEach((evt) => pwEl?.addEventListener(evt, onPwInput));
    unEvents.forEach((evt) => unEl?.addEventListener(evt, onUnInput));

    return () => {
      pwEvents.forEach((evt) => pwEl?.removeEventListener(evt, onPwInput));
      unEvents.forEach((evt) => unEl?.removeEventListener(evt, onUnInput));
    };
  }, [shouldAskUsername]);

  const doLogin = useCallback(async () => {
    const src1 = passwordValueRef.current.trim();
    const src2 = passwordElRef.current?.value?.trim() || '';
    const src3 =
      (
        document.querySelector(
          'input[type="password"]'
        ) as HTMLInputElement | null
      )?.value?.trim() || '';

    const pw = src1 || src2 || src3;

    debugWrite(
      `doLogin: src1=${src1.length}, src2=${src2.length}, src3=${src3.length}`
    );

    const un =
      usernameValueRef.current.trim() ||
      usernameElRef.current?.value?.trim() ||
      '';

    if (!pw) {
      setError('请输入密码');
      debugWrite('doLogin: pw empty, abort');
      return;
    }
    if (shouldAskUsername && !un) {
      setError('请输入用户名');
      return;
    }

    setError(null);
    setLoading(true);
    debugWrite(`doLogin: fetching pw=${pw.length}chars`);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: pw,
          ...(shouldAskUsername ? { username: un } : {}),
        }),
      });

      debugWrite(`doLogin: response ${res.status}`);

      if (res.ok) {
        const redirect = searchParams.get('redirect') || '/tv';
        router.replace(redirect);
      } else if (res.status === 401) {
        setError('密码错误');
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? '服务器错误');
      }
    } catch (err) {
      debugWrite(`doLogin: error ${err}`);
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [shouldAskUsername, searchParams, router]);

  // Native keydown listener on password input
  useEffect(() => {
    const pwEl = passwordElRef.current;
    if (!pwEl) return;

    const handler = (e: Event) => {
      const ke = e as KeyboardEvent;
      debugWrite(`pw-keydown: key=${ke.key} code=${ke.code}`);
      if (ke.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        doLogin();
      }
    };

    pwEl.addEventListener('keydown', handler, true);
    return () => pwEl.removeEventListener('keydown', handler, true);
  }, [doLogin]);

  // Native click listener on button
  useEffect(() => {
    const btn = document.getElementById('tv-login-btn');
    debugWrite(`btn: ${btn ? 'found' : 'NOT FOUND'}`);

    if (!btn) return;

    const handler = (e: Event) => {
      e.preventDefault();
      debugWrite('btn: clicked!');
      doLogin();
    };

    btn.addEventListener('click', handler);
    return () => btn.removeEventListener('click', handler);
  }, [doLogin]);

  // Global keydown — log ALL key events
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName || '?';
      debugWrite(`key: ${e.key}(${e.code}) target=${tag}`);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  // Global click — log ALL click events
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const tag = (e.target as HTMLElement)?.tagName || '?';
      const id = (e.target as HTMLElement)?.id || '';
      debugWrite(`click: target=${tag}${id ? '#' + id : ''}`);
    };
    window.addEventListener('click', handler, true);
    return () => window.removeEventListener('click', handler, true);
  }, []);

  return (
    <div className='flex min-h-screen items-center justify-center'>
      <div className='w-full max-w-lg rounded-2xl bg-gray-900 p-10'>
        <h1 className='mb-8 text-center text-3xl font-bold text-green-500'>
          MoonTV
        </h1>
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
          <p
            id='tv-login-error'
            className='text-red-400 text-lg text-center'
            style={{ display: 'none' }}
          />
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

        {/* Debug panel — direct DOM manipulation, no React state */}
        <div className='mt-6 rounded-lg bg-black/80 p-3 max-h-48 overflow-y-auto'>
          <div className='text-gray-500 font-mono text-xs mb-1'>
            -- debug {BUILD_TS} --
          </div>
          <div
            id='tv-debug-log'
            className='font-mono text-xs text-green-400 space-y-0.5'
          />
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
