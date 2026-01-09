/**
 * 官方与非官方资源搜索独立功能测试
 */

import { searchOfficialResources, searchUnofficialResources } from '../search-independent';

// Mock fetch
global.fetch = jest.fn();

describe('Search Independent Resources', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 重置环境变量
    delete process.env.NEXT_PUBLIC_OFFICIAL_SEARCH_URL;
    delete process.env.NEXT_PUBLIC_UNOFFICIAL_SEARCH_URL;
  });

  describe('searchOfficialResources', () => {
    const mockApiResponse = {
      code: 1,
      msg: '数据列表',
      page: 1,
      pagecount: 5,
      limit: 20,
      total: 100,
      list: [
        {
          vod_id: '12345',
          vod_name: '测试影片',
          vod_pic: 'https://example.com/poster.jpg',
          vod_play_url:
            '播放源1$https://v.qq.com/x/cover/test1.html#第1集$https://v.qq.com/x/cover/test2.html$$$播放源2$https://v.qq.com/x/cover/test3.html',
          vod_class: '动作',
          vod_year: '2024',
          vod_content: '测试简介',
          type_name: '电影',
          vod_douban_id: 123456,
        },
      ],
    };

    it('should successfully search official resources', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockApiResponse,
      });

      const results = await searchOfficialResources('测试');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://789jx.riowang.win/?q='),
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': expect.any(String),
            Accept: 'application/json',
          }),
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        id: '12345',
        title: '测试影片',
        poster: 'https://example.com/poster.jpg',
        source: 'official',
        source_name: '官方资源',
        source_type: 'official',
        year: '2024',
        class: '动作',
        type_name: '电影',
        douban_id: 123456,
      });
      expect(results[0].episodes).toHaveLength(3);
      expect(results[0].episodes[0]).toBe('https://v.qq.com/x/cover/test1.html');
    });

    it('should use custom baseUrl when provided', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockApiResponse,
      });

      const customUrl = 'https://custom-official-api.com';
      await searchOfficialResources('测试', customUrl);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(customUrl),
        expect.any(Object)
      );
    });

    it('should use environment variable for baseUrl', async () => {
      process.env.NEXT_PUBLIC_OFFICIAL_SEARCH_URL = 'https://env-official-api.com';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockApiResponse,
      });

      await searchOfficialResources('测试');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://env-official-api.com'),
        expect.any(Object)
      );
    });

    it('should handle empty results', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 1,
          msg: '数据列表',
          list: [],
        }),
      });

      const results = await searchOfficialResources('测试');

      expect(results).toHaveLength(0);
    });

    it('should handle API error response', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const results = await searchOfficialResources('测试');

      expect(results).toHaveLength(0);
    });

    it('should handle timeout', async () => {
      jest.useFakeTimers();

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

      const searchPromise = searchOfficialResources('测试');

      // 等待 setTimeout 被调用
      await Promise.resolve();

      // 触发超时
      jest.advanceTimersByTime(5000);

      // 等待 abort 信号处理
      await Promise.resolve();

      const result = await searchPromise;
      expect(result).toHaveLength(0);

      jest.useRealTimers();
    });

    it('should extract episodes correctly from vod_play_url', async () => {
      const responseWithMultipleEpisodes = {
        ...mockApiResponse,
        list: [
          {
            ...mockApiResponse.list[0],
            vod_play_url:
              '源1$https://example.com/ep1.html#第2集$https://example.com/ep2.html$$$源2$https://example.com/ep3.html',
          },
        ],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => responseWithMultipleEpisodes,
      });

      const results = await searchOfficialResources('测试');

      expect(results[0].episodes).toEqual([
        'https://example.com/ep1.html',
        'https://example.com/ep2.html',
        'https://example.com/ep3.html',
      ]);
    });

    it('should handle missing vod_play_url', async () => {
      const responseWithoutPlayUrl = {
        ...mockApiResponse,
        list: [
          {
            ...mockApiResponse.list[0],
            vod_play_url: undefined,
          },
        ],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => responseWithoutPlayUrl,
      });

      const results = await searchOfficialResources('测试');

      expect(results[0].episodes).toHaveLength(0);
    });
  });

  describe('searchUnofficialResources', () => {
    const mockApiResponse = {
      code: 1,
      msg: '数据列表',
      page: 1,
      pagecount: 5,
      limit: 20,
      total: 100,
      list: [
        {
          vod_id: '67890',
          vod_name: '测试影片2',
          vod_pic: 'https://example.com/poster2.jpg',
          vod_play_url:
            '播放源1$https://example.com/video1.m3u8#第2集$https://example.com/video2.m3u8$$$播放源2$https://example.com/video3.m3u8',
          vod_class: '喜剧',
          vod_year: '2023',
          vod_content: '测试简介2',
          type_name: '电视剧',
          vod_douban_id: 789012,
        },
      ],
    };

    it('should successfully search unofficial resources', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockApiResponse,
      });

      const results = await searchUnofficialResources('测试');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://ss.riowang.win/?q='),
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': expect.any(String),
            Accept: 'application/json',
          }),
        })
      );

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        id: '67890',
        title: '测试影片2',
        poster: 'https://example.com/poster2.jpg',
        source: 'unofficial',
        source_name: '非官方资源',
        source_type: 'unofficial',
        year: '2023',
        class: '喜剧',
        type_name: '电视剧',
        douban_id: 789012,
      });
      expect(results[0].episodes.length).toBeGreaterThan(0);
      expect(results[0].episodes[0]).toContain('.m3u8');
    });

    it('should use custom baseUrl when provided', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockApiResponse,
      });

      const customUrl = 'https://custom-unofficial-api.com';
      await searchUnofficialResources('测试', customUrl);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(customUrl),
        expect.any(Object)
      );
    });

    it('should use environment variable for baseUrl', async () => {
      process.env.NEXT_PUBLIC_UNOFFICIAL_SEARCH_URL = 'https://env-unofficial-api.com';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockApiResponse,
      });

      await searchUnofficialResources('测试');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://env-unofficial-api.com'),
        expect.any(Object)
      );
    });

    it('should extract m3u8 links correctly', async () => {
      const responseWithM3U8 = {
        ...mockApiResponse,
        list: [
          {
            ...mockApiResponse.list[0],
            vod_play_url:
              '源1$https://example.com/video1.m3u8#第2集$https://example.com/video2.m3u8$$$源2$https://example.com/video3.m3u8',
          },
        ],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => responseWithM3U8,
      });

      const results = await searchUnofficialResources('测试');

      expect(results[0].episodes).toEqual(
        expect.arrayContaining([
          expect.stringContaining('.m3u8'),
        ])
      );
    });

    it('should handle empty results', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 1,
          msg: '数据列表',
          list: [],
        }),
      });

      const results = await searchUnofficialResources('测试');

      expect(results).toHaveLength(0);
    });

    it('should handle API error response', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const results = await searchUnofficialResources('测试');

      expect(results).toHaveLength(0);
    });

    it('should handle timeout', async () => {
      jest.useFakeTimers();

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

      const searchPromise = searchUnofficialResources('测试');

      // 等待 setTimeout 被调用
      await Promise.resolve();

      // 触发超时
      jest.advanceTimersByTime(5000);

      // 等待 abort 信号处理
      await Promise.resolve();

      const result = await searchPromise;
      expect(result).toHaveLength(0);

      jest.useRealTimers();
    });

    it('should handle missing vod_play_url', async () => {
      const responseWithoutPlayUrl = {
        ...mockApiResponse,
        list: [
          {
            ...mockApiResponse.list[0],
            vod_play_url: undefined,
          },
        ],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => responseWithoutPlayUrl,
      });

      const results = await searchUnofficialResources('测试');

      expect(results[0].episodes).toHaveLength(0);
    });

    it('should deduplicate m3u8 links', async () => {
      const responseWithDuplicates = {
        ...mockApiResponse,
        list: [
          {
            ...mockApiResponse.list[0],
            vod_play_url:
              '源1$https://example.com/video1.m3u8#第2集$https://example.com/video1.m3u8$$$源2$https://example.com/video1.m3u8',
          },
        ],
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => responseWithDuplicates,
      });

      const results = await searchUnofficialResources('测试');

      // 应该去重
      const uniqueEpisodes = [...new Set(results[0].episodes)];
      expect(results[0].episodes.length).toBe(uniqueEpisodes.length);
    });
  });
});
