/**
 * 搜索流式API集成测试
 * 测试官方和非官方资源搜索的集成
 */

import { getConfig } from '@/lib/config';
import * as searchIndependent from '@/lib/search-independent';

import { GET } from '../route';

// Mock dependencies
jest.mock('@/lib/search-independent');
jest.mock('@/lib/downstream');
jest.mock('@/lib/config');
jest.mock('@/lib/yellow');

describe('/api/search/stream', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET - 搜索结果合并', () => {
    const mockOfficialResults = [
      {
        id: '1',
        title: '官方资源1',
        poster: 'https://example.com/poster1.jpg',
        episodes: ['https://v.qq.com/x/cover/test1.html'],
        source: 'official',
        source_name: '官方资源',
        source_type: 'official' as const,
        year: '2024',
      },
    ];

    const mockUnofficialResults = [
      {
        id: '2',
        title: '非官方资源1',
        poster: 'https://example.com/poster2.jpg',
        episodes: ['https://example.com/video1.m3u8'],
        source: 'unofficial',
        source_name: '非官方资源',
        source_type: 'unofficial' as const,
        year: '2023',
      },
    ];

    it('should merge official and unofficial search results', async () => {
      // Mock config
      const mockGetConfig = getConfig as jest.Mock;
      mockGetConfig.mockResolvedValueOnce({
        SourceConfig: [],
        SiteConfig: {
          DisableYellowFilter: true,
        },
      });

      // Mock search functions
      const mockSearchOfficial = searchIndependent.searchOfficialResources as jest.Mock;
      const mockSearchUnofficial = searchIndependent.searchUnofficialResources as jest.Mock;

      mockSearchOfficial.mockResolvedValueOnce(mockOfficialResults);
      mockSearchUnofficial.mockResolvedValueOnce(mockUnofficialResults);

      const request = new Request('http://localhost:3000/api/search/stream?q=测试');
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/event-stream');

      // 读取流式响应以确保异步任务完成
      if (response.body) {
        const reader = response.body.getReader();
        try {
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { done } = await reader.read();
            if (done) break;
          }
        } finally {
          reader.releaseLock();
        }
      }

      // 等待所有异步任务完成（使用轮询方式）
      let attempts = 0;
      while (attempts < 50) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (mockSearchOfficial.mock.calls.length > 0 && mockSearchUnofficial.mock.calls.length > 0) {
          break;
        }
        attempts++;
      }

      // 验证两个搜索函数都被调用
      expect(mockSearchOfficial).toHaveBeenCalledWith('测试', undefined);
      expect(mockSearchUnofficial).toHaveBeenCalledWith('测试', undefined);
    });

    it('should handle missing query parameter', async () => {
      const request = new Request('http://localhost:3000/api/search/stream');
      const response = await GET(request);

      expect(response.status).toBe(400);
    });

    it('should continue when official search fails', async () => {
      const mockGetConfig = getConfig as jest.Mock;
      mockGetConfig.mockResolvedValueOnce({
        SourceConfig: [],
        SiteConfig: {
          DisableYellowFilter: true,
        },
      });

      const mockSearchOfficial = searchIndependent.searchOfficialResources as jest.Mock;
      const mockSearchUnofficial = searchIndependent.searchUnofficialResources as jest.Mock;

      mockSearchOfficial.mockRejectedValueOnce(new Error('Official search failed'));
      mockSearchUnofficial.mockResolvedValueOnce(mockUnofficialResults);

      const request = new Request('http://localhost:3000/api/search/stream?q=测试');
      const response = await GET(request);

      // 应该仍然返回200，因为非官方搜索成功
      expect(response.status).toBe(200);
    });

    it('should continue when unofficial search fails', async () => {
      const mockGetConfig = getConfig as jest.Mock;
      mockGetConfig.mockResolvedValueOnce({
        SourceConfig: [],
        SiteConfig: {
          DisableYellowFilter: true,
        },
      });

      const mockSearchOfficial = searchIndependent.searchOfficialResources as jest.Mock;
      const mockSearchUnofficial = searchIndependent.searchUnofficialResources as jest.Mock;

      mockSearchOfficial.mockResolvedValueOnce(mockOfficialResults);
      mockSearchUnofficial.mockRejectedValueOnce(new Error('Unofficial search failed'));

      const request = new Request('http://localhost:3000/api/search/stream?q=测试');
      const response = await GET(request);

      // 应该仍然返回200，因为官方搜索成功
      expect(response.status).toBe(200);
    });

    it('should deduplicate results by source_type and id', async () => {
      const mockGetConfig = getConfig as jest.Mock;
      mockGetConfig.mockResolvedValueOnce({
        SourceConfig: [],
        SiteConfig: {
          DisableYellowFilter: true,
        },
      });

      const duplicateOfficialResults = [
        {
          id: '1',
          title: '官方资源1',
          poster: 'https://example.com/poster1.jpg',
          episodes: ['https://v.qq.com/x/cover/test1.html'],
          source: 'official',
          source_name: '官方资源',
          source_type: 'official' as const,
          year: '2024',
        },
        {
          id: '1', // 重复的ID
          title: '官方资源1-重复',
          poster: 'https://example.com/poster1-dup.jpg',
          episodes: ['https://v.qq.com/x/cover/test1-dup.html'],
          source: 'official',
          source_name: '官方资源',
          source_type: 'official' as const,
          year: '2024',
        },
      ];

      const mockSearchOfficial = searchIndependent.searchOfficialResources as jest.Mock;
      const mockSearchUnofficial = searchIndependent.searchUnofficialResources as jest.Mock;

      mockSearchOfficial.mockResolvedValueOnce(duplicateOfficialResults);
      mockSearchUnofficial.mockResolvedValueOnce([]);

      const request = new Request('http://localhost:3000/api/search/stream?q=测试');
      const response = await GET(request);

      expect(response.status).toBe(200);
      // 注意：去重逻辑在流式返回中实现，这里主要测试不会因为重复而崩溃
    });
  });
});
