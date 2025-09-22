/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { AdminConfig } from './admin.types';
import { Favorite, IStorage, PlayRecord, SkipConfig } from './types';

/**
 * Workers API 客户端存储实现
 * 通过HTTP请求与Cloudflare Workers API通信
 */
export class WorkersStorage implements IStorage {
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;

  constructor() {
    // 从环境变量获取Workers API地址
    this.baseUrl =
      process.env.WORKERS_API_URL ||
      'https://moontv-database.x8bd542jnt.workers.dev';
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private getHeaders(username?: string): Record<string, string> {
    const headers = { ...this.defaultHeaders };
    if (username) {
      headers['X-Username'] = username;
    }
    return headers;
  }

  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {},
    username?: string
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = this.getHeaders(username);

    try {
      const response = await fetch(url, {
        ...options,
        headers: { ...headers, ...options.headers },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Workers API请求失败: ${response.status} - ${errorText}`
        );
      }

      const data = await response.json();

      // 检查Workers API响应格式
      if (data.code !== 200) {
        throw new Error(data.msg || 'Workers API返回错误');
      }

      return data.data;
    } catch (error) {
      console.error(`Workers API请求失败 (${endpoint}):`, error);
      throw error;
    }
  }

  // ==================== 播放记录相关 ====================

  async getPlayRecord(
    userName: string,
    key: string
  ): Promise<PlayRecord | null> {
    try {
      const records = await this.makeRequest<Record<string, PlayRecord>>(
        '/api/playrecords',
        { method: 'GET' },
        userName
      );
      return records[key] || null;
    } catch (error) {
      console.error('获取播放记录失败:', error);
      return null;
    }
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    await this.makeRequest(
      '/api/playrecords',
      {
        method: 'POST',
        body: JSON.stringify({ key, record }),
      },
      userName
    );
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<Record<string, PlayRecord>> {
    try {
      return await this.makeRequest<Record<string, PlayRecord>>(
        '/api/playrecords',
        { method: 'GET' },
        userName
      );
    } catch (error) {
      console.error('获取所有播放记录失败:', error);
      return {};
    }
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    await this.makeRequest(
      `/api/playrecords?key=${encodeURIComponent(key)}`,
      { method: 'DELETE' },
      userName
    );
  }

  // ==================== 收藏相关 ====================

  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    try {
      const favorites = await this.makeRequest<Record<string, Favorite>>(
        '/api/favorites',
        { method: 'GET' },
        userName
      );
      return favorites[key] || null;
    } catch (error) {
      console.error('获取收藏失败:', error);
      return null;
    }
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    await this.makeRequest(
      '/api/favorites',
      {
        method: 'POST',
        body: JSON.stringify({ key, favorite }),
      },
      userName
    );
  }

  async getAllFavorites(userName: string): Promise<Record<string, Favorite>> {
    try {
      return await this.makeRequest<Record<string, Favorite>>(
        '/api/favorites',
        { method: 'GET' },
        userName
      );
    } catch (error) {
      console.error('获取所有收藏失败:', error);
      return {};
    }
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    await this.makeRequest(
      `/api/favorites?key=${encodeURIComponent(key)}`,
      { method: 'DELETE' },
      userName
    );
  }

  // ==================== 用户相关 ====================

  async registerUser(userName: string, password: string): Promise<void> {
    await this.makeRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: userName, password }),
    });
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    try {
      const result = await this.makeRequest<{ valid: boolean }>(
        '/api/auth/verify',
        {
          method: 'POST',
          body: JSON.stringify({ username: userName, password }),
        }
      );
      return result.valid;
    } catch (error) {
      console.error('验证用户失败:', error);
      return false;
    }
  }

  async checkUserExist(userName: string): Promise<boolean> {
    try {
      // 通过尝试获取用户数据来检查用户是否存在
      await this.makeRequest('/api/playrecords', { method: 'GET' }, userName);
      return true;
    } catch (error) {
      // 如果返回401说明用户不存在或未授权
      return false;
    }
  }

  async changePassword(userName: string, newPassword: string): Promise<void> {
    // 注意：这里需要旧密码，但接口设计可能需要调整
    await this.makeRequest('/api/user/change-password', {
      method: 'POST',
      body: JSON.stringify({
        username: userName,
        newPassword,
        // oldPassword 需要从其他地方获取
      }),
    });
  }

  async deleteUser(userName: string): Promise<void> {
    await this.makeRequest(`/api/admin/users/${userName}`, {
      method: 'DELETE',
    });
  }

  // ==================== 搜索历史相关 ====================

  async getSearchHistory(userName: string): Promise<string[]> {
    try {
      return await this.makeRequest<string[]>(
        '/api/searchhistory',
        { method: 'GET' },
        userName
      );
    } catch (error) {
      console.error('获取搜索历史失败:', error);
      return [];
    }
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    await this.makeRequest(
      '/api/searchhistory',
      {
        method: 'POST',
        body: JSON.stringify({ keyword }),
      },
      userName
    );
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    const url = keyword
      ? `/api/searchhistory?keyword=${encodeURIComponent(keyword)}`
      : '/api/searchhistory';

    await this.makeRequest(url, { method: 'DELETE' }, userName);
  }

  // ==================== 用户列表 ====================

  async getAllUsers(): Promise<string[]> {
    try {
      const users = await this.makeRequest<Array<{ username: string }>>(
        '/api/admin/users',
        {
          method: 'GET',
        }
      );
      return users.map((u) => u.username);
    } catch (error) {
      console.error('获取用户列表失败:', error);
      return [];
    }
  }

  // ==================== 管理员配置相关 ====================

  async getAdminConfig(): Promise<AdminConfig | null> {
    try {
      return await this.makeRequest<AdminConfig>('/api/admin/config', {
        method: 'GET',
      });
    } catch (error) {
      console.error('获取管理员配置失败:', error);
      return null;
    }
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    await this.makeRequest('/api/admin/config', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  // ==================== 跳过片头片尾配置 ====================

  async getSkipConfig(
    _userName: string,
    _source: string,
    _id: string
  ): Promise<SkipConfig | null> {
    try {
      // 这个功能可能需要在Workers API中实现对应的端点
      console.warn('getSkipConfig: Workers API暂未实现此功能');
      return null;
    } catch (error) {
      console.error('获取跳过配置失败:', error);
      return null;
    }
  }

  async setSkipConfig(
    _userName: string,
    _source: string,
    _id: string,
    _config: SkipConfig
  ): Promise<void> {
    console.warn('setSkipConfig: Workers API暂未实现此功能');
  }

  async deleteSkipConfig(
    _userName: string,
    _source: string,
    _id: string
  ): Promise<void> {
    console.warn('deleteSkipConfig: Workers API暂未实现此功能');
  }

  async getAllSkipConfigs(
    _userName: string
  ): Promise<{ [key: string]: SkipConfig }> {
    console.warn('getAllSkipConfigs: Workers API暂未实现此功能');
    return {};
  }
}
