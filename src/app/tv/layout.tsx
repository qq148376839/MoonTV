'use client';

import Script from 'next/script';
import { useTheme } from 'next-themes';
import { Component, useEffect } from 'react';

import './tv.css';

import { TvFocusProvider } from '@/components/tv/TvFocusProvider';
import TvNavRail from '@/components/tv/TvNavRail';

// React Error Boundary to catch rendering crashes
class TvErrorBoundary extends Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 40,
            color: '#ff6666',
            fontFamily: 'monospace',
            fontSize: 14,
          }}
        >
          <h2 style={{ color: '#ff4444', fontSize: 20 }}>
            React Error Caught
          </h2>
          <pre style={{ whiteSpace: 'pre-wrap', marginTop: 10 }}>
            {this.state.error.message}
          </pre>
          <pre
            style={{ whiteSpace: 'pre-wrap', marginTop: 10, color: '#999' }}
          >
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// Inline script that runs INDEPENDENTLY of React.
// Sets up error handlers and a vanilla JS fallback login.
const TV_INIT_SCRIPT = `
(function() {
  // Debug writer
  function dbg(msg, color) {
    var el = document.getElementById('tv-debug-log');
    if (!el) return;
    var d = document.createElement('div');
    d.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
    if (color) d.style.color = color;
    el.appendChild(d);
    while (el.children.length > 20) el.removeChild(el.firstChild);
    el.scrollTop = el.scrollHeight;
  }

  // Catch ALL JavaScript errors
  window.onerror = function(msg, src, line, col) {
    dbg('JS_ERROR: ' + msg + ' @' + (src||'').split('/').pop() + ':' + line + ':' + col, '#ff6666');
    return false;
  };
  window.addEventListener('unhandledrejection', function(e) {
    dbg('PROMISE_ERR: ' + (e.reason && e.reason.message || e.reason || e), '#ff6666');
  });

  dbg('vanilla-js: loaded');

  // Vanilla JS fallback login — works even if React is completely broken.
  // Waits for DOM, then attaches native event listeners.
  function setupFallbackLogin() {
    var pwInput = document.querySelector('input[type="password"]');
    var btn = document.getElementById('tv-login-btn');

    dbg('fallback: pw=' + !!pwInput + ' btn=' + !!btn);

    if (!pwInput || !btn) {
      // Retry in case DOM isn't ready yet
      setTimeout(setupFallbackLogin, 500);
      return;
    }

    // Track password value via input events
    var pwValue = '';
    ['input', 'change', 'keyup', 'compositionend'].forEach(function(evt) {
      pwInput.addEventListener(evt, function() {
        pwValue = pwInput.value || '';
        dbg('fallback-pw: len=' + pwValue.length);
      });
    });

    // Login function
    function doFallbackLogin() {
      var pw = pwValue || pwInput.value || '';
      dbg('fallback-login: pw_len=' + pw.length);

      if (!pw) {
        dbg('fallback-login: empty password', '#ffaa00');
        return;
      }

      dbg('fallback-login: fetching...');
      btn.textContent = '登录中...';
      btn.disabled = true;

      fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw })
      })
      .then(function(res) {
        dbg('fallback-login: status=' + res.status);
        if (res.ok) {
          dbg('fallback-login: SUCCESS, redirecting...', '#66ff66');
          window.location.href = '/tv';
        } else if (res.status === 401) {
          dbg('fallback-login: wrong password', '#ffaa00');
          btn.textContent = '登录';
          btn.disabled = false;
          // Show error
          var errEl = document.getElementById('tv-login-error');
          if (errEl) {
            errEl.textContent = '密码错误';
            errEl.style.display = 'block';
          }
        } else {
          dbg('fallback-login: server error ' + res.status, '#ff6666');
          btn.textContent = '登录';
          btn.disabled = false;
        }
      })
      .catch(function(err) {
        dbg('fallback-login: fetch error: ' + err, '#ff6666');
        btn.textContent = '登录';
        btn.disabled = false;
      });
    }

    // Button click
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      dbg('fallback: btn clicked');
      doFallbackLogin();
    });

    // Enter key in password input
    pwInput.addEventListener('keydown', function(e) {
      dbg('fallback: keydown ' + e.key);
      if (e.key === 'Enter') {
        e.preventDefault();
        doFallbackLogin();
      }
    });

    // Also listen for Enter on the button (DPAD_CENTER)
    btn.addEventListener('keydown', function(e) {
      dbg('fallback: btn keydown ' + e.key);
      if (e.key === 'Enter') {
        e.preventDefault();
        doFallbackLogin();
      }
    });

    dbg('fallback: login handlers ready', '#66ff66');
  }

  // Start setup after a short delay to let DOM render
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(setupFallbackLogin, 100);
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(setupFallbackLogin, 100);
    });
  }
})();
`;

export default function TvLayout({ children }: { children: React.ReactNode }) {
  const { setTheme } = useTheme();

  // Force dark theme for TV UI
  useEffect(() => {
    setTheme('dark');
  }, [setTheme]);

  return (
    <TvErrorBoundary>
      <TvFocusProvider>
        <div className='min-h-screen bg-black text-gray-100'>
          <TvNavRail />
          <main className='tv-page'>{children}</main>
        </div>
      </TvFocusProvider>

      {/* Vanilla JS fallback — runs independently of React */}
      <Script id='tv-init' strategy='afterInteractive'>
        {TV_INIT_SCRIPT}
      </Script>
    </TvErrorBoundary>
  );
}
