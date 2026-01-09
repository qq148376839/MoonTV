/* eslint-env jest */
import '@testing-library/jest-dom/extend-expect';

// Allow router mocks.
// eslint-disable-next-line @typescript-eslint/no-var-requires
jest.mock('next/router', () => require('next-router-mock'));

// Polyfill for Request/Response in Node.js test environment
// Next.js Edge Runtime APIs
let useUndici = false;
if (typeof globalThis.Request === 'undefined') {
  // Use node-fetch or undici if available, otherwise use a simple mock
  try {
    // Try to use undici (Node.js 18+)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Request, Response, Headers } = require('undici');
    globalThis.Request = Request;
    globalThis.Response = Response;
    globalThis.Headers = Headers;
    useUndici = true;
  } catch {
    // Fallback: simple mock for basic testing
    globalThis.Request = class MockRequest {
      constructor(input, init = {}) {
        this.url = typeof input === 'string' ? input : input.url;
        this.method = init.method || 'GET';
        this.headers = new Map();
        if (init.headers) {
          Object.entries(init.headers).forEach(([key, value]) => {
            this.headers.set(key.toLowerCase(), value);
          });
        }
        this.body = init.body;
        this.signal = init.signal;
      }
    };

    // MockHeaders 类 - 不区分大小写的 headers
    class MockHeaders extends Map {
      get(name) {
        return super.get(name.toLowerCase());
      }
      set(name, value) {
        return super.set(name.toLowerCase(), value);
      }
      has(name) {
        return super.has(name.toLowerCase());
      }
      delete(name) {
        return super.delete(name.toLowerCase());
      }
    }

    // Response 类需要支持静态方法 json()
    class MockResponse {
      constructor(body, init = {}) {
        this.body = body;
        this.status = init.status || 200;
        this.statusText = init.statusText || 'OK';
        this.headers = new MockHeaders();
        if (init.headers) {
          Object.entries(init.headers).forEach(([key, value]) => {
            this.headers.set(key, value);
          });
        }
      }

      async json() {
        return typeof this.body === 'string' ? JSON.parse(this.body) : this.body;
      }

      async text() {
        return typeof this.body === 'string' ? this.body : JSON.stringify(this.body);
      }

      // 静态方法 json()
      static json(body, init = {}) {
        return new MockResponse(JSON.stringify(body), {
          ...init,
          headers: {
            'Content-Type': 'application/json',
            ...init.headers,
          },
        });
      }
    }

    globalThis.Response = MockResponse;

    globalThis.Headers = MockHeaders;
  }
}

// Polyfill for ReadableStream (used in SSE)
if (typeof globalThis.ReadableStream === 'undefined') {
  // Try to use undici's ReadableStream if available
  try {
    if (useUndici) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { ReadableStream } = require('undici');
      if (ReadableStream) {
        globalThis.ReadableStream = ReadableStream;
      }
    }
  } catch {
    // Fallback to mock
  }

  // If still undefined, use mock
  if (typeof globalThis.ReadableStream === 'undefined') {
    // Simple ReadableStream mock for testing
    globalThis.ReadableStream = class MockReadableStream {
      constructor(underlyingSource) {
        this._underlyingSource = underlyingSource;
        this._controller = null;
        this._started = false;
        this._startPromise = null;
      }

      getReader() {
        return {
          read: async () => {
            if (!this._started && this._underlyingSource?.start) {
              this._started = true;
              const controller = {
                // eslint-disable-next-line no-undef
                enqueue: jest.fn(),
                // eslint-disable-next-line no-undef
                close: jest.fn(),
              };
              this._controller = controller;
              // 启动异步任务但不等待完成
              this._startPromise = Promise.resolve(
                this._underlyingSource.start(controller)
              ).catch(() => {
                // 忽略错误，因为这是测试环境
              });
            }
            // 如果 start 方法正在执行，等待它完成
            if (this._startPromise) {
              await this._startPromise;
              this._startPromise = null;
            }
            return { done: true, value: undefined };
          },
          // eslint-disable-next-line no-undef
          cancel: jest.fn(),
          // eslint-disable-next-line no-undef
          releaseLock: jest.fn(),
        };
      }

      cancel() {
        return Promise.resolve();
      }
    };
  }
}

// Polyfill for TextEncoder/TextDecoder
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = class MockTextEncoder {
    encode(str) {
      return new Uint8Array(
        str.split('').map((char) => char.charCodeAt(0))
      );
    }
  };
}

if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = class MockTextDecoder {
    decode(bytes) {
      return String.fromCharCode(...bytes);
    }
  };
}
