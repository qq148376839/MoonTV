/**
 * 新解析API测试
 */

import { GET } from '../route';

// Mock fetch
global.fetch = jest.fn();

describe('/api/parse', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.NEXT_PUBLIC_PARSE_API_URL;
  });

  describe('GET', () => {
    const mockParseResponse = {
      success: true,
      data: {
        m3u8_url: 'http://localhost:8000/api/v1/m3u8/148b71ab92719b9f',
        method: 'paid_key',
        parse_time: 0.191,
        cached: true,
      },
    };

    it('should successfully parse video URL', async () => {
      const videoUrl =
        'https://v.qq.com/x/cover/mzc00200x2xo33l/l4101xix2xn.html';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockParseResponse,
      });

      const request = new Request(
        `http://localhost:3000/api/parse?url=${encodeURIComponent(videoUrl)}`
      );
      const response = await GET(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result).toMatchObject({
        success: true,
        data: {
          m3u8_url: expect.any(String),
          method: 'paid_key',
          parse_time: 0.191,
          cached: true,
        },
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://gfjx.riowang.win/api/v1/parse'),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
          headers: expect.objectContaining({
            'User-Agent': expect.any(String),
            Accept: 'application/json',
          }),
        })
      );
    });

    it('should return 400 when url parameter is missing', async () => {
      const request = new Request('http://localhost:3000/api/parse');
      const response = await GET(request);
      const result = await response.json();

      expect(response.status).toBe(400);
      expect(result).toMatchObject({
        success: false,
        error: '缺少视频 URL 参数',
      });
    });

    it('should handle parse failure', async () => {
      const videoUrl = 'https://invalid-url.com';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: false,
          data: {},
          error: '解析失败：无法获取播放地址',
        }),
      });

      const request = new Request(
        `http://localhost:3000/api/parse?url=${encodeURIComponent(videoUrl)}`
      );
      const response = await GET(request);
      const result = await response.json();

      expect(response.status).toBe(500);
      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('解析失败'),
      });
    });

    it('should handle parse failure with empty m3u8_url', async () => {
      const videoUrl = 'https://v.qq.com/x/cover/test.html';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            m3u8_url: null,
          },
        }),
      });

      const request = new Request(
        `http://localhost:3000/api/parse?url=${encodeURIComponent(videoUrl)}`
      );
      const response = await GET(request);
      const result = await response.json();

      expect(response.status).toBe(500);
      expect(result.success).toBe(false);
    });

    it('should handle API error response', async () => {
      const videoUrl = 'https://v.qq.com/x/cover/test.html';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const request = new Request(
        `http://localhost:3000/api/parse?url=${encodeURIComponent(videoUrl)}`
      );
      const response = await GET(request);
      const result = await response.json();

      expect(response.status).toBe(500);
      expect(result).toMatchObject({
        success: false,
        error: expect.stringContaining('解析接口返回错误'),
      });
    });

    it('should handle timeout', async () => {
      jest.useFakeTimers();
      const videoUrl = 'https://v.qq.com/x/cover/test.html';

      let abortController: AbortController | undefined;
      // eslint-disable-next-line unused-imports/no-unused-vars
      (global.fetch as jest.Mock).mockImplementationOnce((_url, _options) => {
        abortController = new AbortController();
        // 模拟 signal 被 abort
        setTimeout(() => {
          abortController?.abort();
        }, 5000);
        return new Promise((_, reject) => {
          abortController?.signal.addEventListener('abort', () => {
            const error = new Error('Aborted');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (error as any).name = 'AbortError';
            reject(error);
          });
        });
      });

      const request = new Request(
        `http://localhost:3000/api/parse?url=${encodeURIComponent(videoUrl)}`
      );

      const parsePromise = GET(request);

      // 等待 setTimeout 被调用
      await Promise.resolve();

      // 触发超时（这会触发 abort）
      jest.advanceTimersByTime(5000);

      // 等待 abort 信号处理
      await Promise.resolve();

      const response = await parsePromise;
      const result = await response.json();

      expect(response.status).toBe(500);
      expect(result.success).toBe(false);

      jest.useRealTimers();
    });

    it('should handle network error', async () => {
      const videoUrl = 'https://v.qq.com/x/cover/test.html';

      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error('Network error')
      );

      const request = new Request(
        `http://localhost:3000/api/parse?url=${encodeURIComponent(videoUrl)}`
      );
      const response = await GET(request);
      const result = await response.json();

      expect(response.status).toBe(500);
      expect(result).toMatchObject({
        success: false,
        error: 'Network error',
      });
    });

    it('should use custom parse API URL from environment variable', async () => {
      process.env.NEXT_PUBLIC_PARSE_API_URL =
        'https://custom-parse-api.com/api/v1/parse';
      const videoUrl = 'https://v.qq.com/x/cover/test.html';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockParseResponse,
      });

      const request = new Request(
        `http://localhost:3000/api/parse?url=${encodeURIComponent(videoUrl)}`
      );
      await GET(request);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://custom-parse-api.com/api/v1/parse'),
        expect.any(Object)
      );
    });

    it('should URL encode video URL correctly', async () => {
      const videoUrl = 'https://v.qq.com/x/cover/test?param=value&other=123';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockParseResponse,
      });

      const request = new Request(
        `http://localhost:3000/api/parse?url=${encodeURIComponent(videoUrl)}`
      );
      await GET(request);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent(videoUrl)),
        expect.any(Object)
      );
    });
  });
});
