/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

'use client';

import Artplayer from 'artplayer';
import Hls from 'hls.js';
import { Heart } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

import {
  deleteFavorite,
  deletePlayRecord,
  deleteSkipConfig,
  generateStorageKey,
  getAllPlayRecords,
  getSkipConfig,
  isFavorited,
  saveFavorite,
  savePlayRecord,
  saveSkipConfig,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { detailCacheManager } from '@/lib/detail-cache';
import { searchCacheManager } from '@/lib/search-cache';
import { SearchResult } from '@/lib/types';
import { getVideoResolutionFromM3u8, processImageUrl } from '@/lib/utils';

import EpisodeSelector from '@/components/EpisodeSelector';
import PageLayout from '@/components/PageLayout';

// 扩展 HTMLVideoElement 类型以支持 hls 属性
declare global {
  interface HTMLVideoElement {
    hls?: any;
  }
}

function PlayPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // -----------------------------------------------------------------------------
  // 状态变量（State）
  // -----------------------------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<
    'searching' | 'preferring' | 'fetching' | 'ready'
  >('searching');
  const [loadingMessage, setLoadingMessage] = useState('正在搜索播放源...');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SearchResult | null>(null);

  // 收藏状态
  const [favorited, setFavorited] = useState(false);

  // 跳过片头片尾配置
  const [skipConfig, setSkipConfig] = useState<{
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }>({
    enable: false,
    intro_time: 0,
    outro_time: 0,
  });
  const skipConfigRef = useRef(skipConfig);
  useEffect(() => {
    skipConfigRef.current = skipConfig;
  }, [
    skipConfig,
    skipConfig.enable,
    skipConfig.intro_time,
    skipConfig.outro_time,
  ]);

  // 跳过检查的时间间隔控制
  const lastSkipCheckRef = useRef(0);

  // 去广告开关（从 localStorage 继承，默认 true）
  const [blockAdEnabled, setBlockAdEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('enable_blockad');
      if (v !== null) return v === 'true';
    }
    return true;
  });
  const blockAdEnabledRef = useRef(blockAdEnabled);
  useEffect(() => {
    blockAdEnabledRef.current = blockAdEnabled;
  }, [blockAdEnabled]);

  // 视频基本信息
  const [videoTitle, setVideoTitle] = useState(searchParams.get('title') || '');
  const [videoYear, setVideoYear] = useState(searchParams.get('year') || '');
  const [videoCover, setVideoCover] = useState('');
  // 当前源和ID
  const [currentSource, setCurrentSource] = useState(
    searchParams.get('source') || ''
  );
  const [currentId, setCurrentId] = useState(searchParams.get('id') || '');

  // 搜索所需信息
  const [searchTitle] = useState(searchParams.get('stitle') || '');
  const [searchType] = useState(searchParams.get('stype') || '');

  // 是否需要优选
  const [needPrefer, setNeedPrefer] = useState(
    searchParams.get('prefer') === 'true'
  );
  const needPreferRef = useRef(needPrefer);
  useEffect(() => {
    needPreferRef.current = needPrefer;
  }, [needPrefer]);
  // 集数相关
  const [currentEpisodeIndex, setCurrentEpisodeIndex] = useState(0);

  const currentSourceRef = useRef(currentSource);
  const currentIdRef = useRef(currentId);
  const videoTitleRef = useRef(videoTitle);
  const videoYearRef = useRef(videoYear);
  const detailRef = useRef<SearchResult | null>(detail);
  const currentEpisodeIndexRef = useRef(currentEpisodeIndex);

  // 本地资源检测相关
  const [isUsingLocalResource, setIsUsingLocalResource] = useState(false);
  const localResourceCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 同步最新值到 refs
  useEffect(() => {
    currentSourceRef.current = currentSource;
    currentIdRef.current = currentId;
    detailRef.current = detail;
    currentEpisodeIndexRef.current = currentEpisodeIndex;
    videoTitleRef.current = videoTitle;
    videoYearRef.current = videoYear;
  }, [
    currentSource,
    currentId,
    detail,
    currentEpisodeIndex,
    videoTitle,
    videoYear,
  ]);

  // 视频播放地址
  const [videoUrl, setVideoUrl] = useState('');

  // 官方解析解密状态
  const [decrypting, setDecrypting] = useState(false);
  const [decryptError, setDecryptError] = useState<string | null>(null);

  // 源配置（用于检查official_parser）
  const [sourceConfig, setSourceConfig] = useState<
    Array<{
      key: string;
      official_parser?: boolean;
      detail?: string;
    }>
  >([]);

  // 总集数
  const totalEpisodes = detail?.episodes?.length || 0;

  // 用于记录是否需要在播放器 ready 后跳转到指定进度
  const resumeTimeRef = useRef<number | null>(null);
  // 上次使用的音量，默认 0.7
  const lastVolumeRef = useRef<number>(0.7);
  // 上次使用的播放速率，默认 1.0
  const lastPlaybackRateRef = useRef<number>(1.0);

  // 换源相关状态
  const [availableSources, setAvailableSources] = useState<SearchResult[]>([]);
  const [sourceSearchLoading, setSourceSearchLoading] = useState(false);
  const [sourceSearchError, setSourceSearchError] = useState<string | null>(
    null
  );

  // 优选和测速开关
  const [optimizationEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('enableOptimization');
      if (saved !== null) {
        try {
          return JSON.parse(saved);
        } catch {
          /* ignore */
        }
      }
    }
    return true;
  });

  // 保存优选时的测速结果，避免EpisodeSelector重复测速
  const [precomputedVideoInfo, setPrecomputedVideoInfo] = useState<
    Map<string, { quality: string; loadSpeed: string; pingTime: number }>
  >(new Map());

  // 折叠状态（仅在 lg 及以上屏幕有效）
  const [isEpisodeSelectorCollapsed, setIsEpisodeSelectorCollapsed] =
    useState(false);

  // 换源加载状态
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const [videoLoadingStage, setVideoLoadingStage] = useState<
    'initing' | 'sourceChanging'
  >('initing');

  // 播放进度保存相关
  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveTimeRef = useRef<number>(0);

  const artPlayerRef = useRef<any>(null);
  const artRef = useRef<HTMLDivElement | null>(null);

  // -----------------------------------------------------------------------------
  // 工具函数（Utils）
  // -----------------------------------------------------------------------------

  // 播放源优选函数
  const preferBestSource = async (
    sources: SearchResult[]
  ): Promise<SearchResult> => {
    if (sources.length === 1) return sources[0];

    // 将播放源均分为两批，并发测速各批，避免一次性过多请求
    const batchSize = Math.ceil(sources.length / 2);
    const allResults: Array<{
      source: SearchResult;
      testResult: { quality: string; loadSpeed: string; pingTime: number };
    } | null> = [];

    for (let start = 0; start < sources.length; start += batchSize) {
      const batchSources = sources.slice(start, start + batchSize);
      const batchResults = await Promise.all(
        batchSources.map(async (source) => {
          try {
            // 检查是否有第一集的播放地址
            if (!source.episodes || source.episodes.length === 0) {
              // eslint-disable-next-line no-console
              console.warn(`播放源 ${source.source_name} 没有可用的播放地址`);
              return null;
            }

            const episodeUrl =
              source.episodes.length > 1
                ? source.episodes[1]
                : source.episodes[0];
            const testResult = await getVideoResolutionFromM3u8(episodeUrl);

            return {
              source,
              testResult,
            };
          } catch (error) {
            return null;
          }
        })
      );
      allResults.push(...batchResults);
    }

    // 等待所有测速完成，包含成功和失败的结果
    // 保存所有测速结果到 precomputedVideoInfo，供 EpisodeSelector 使用（包含错误结果）
    const newVideoInfoMap = new Map<
      string,
      {
        quality: string;
        loadSpeed: string;
        pingTime: number;
        hasError?: boolean;
      }
    >();
    allResults.forEach((result, index) => {
      const source = sources[index];
      const sourceKey = `${source.source}-${source.id}`;

      if (result) {
        // 成功的结果
        newVideoInfoMap.set(sourceKey, result.testResult);
      }
    });

    // 过滤出成功的结果用于优选计算
    const successfulResults = allResults.filter(Boolean) as Array<{
      source: SearchResult;
      testResult: { quality: string; loadSpeed: string; pingTime: number };
    }>;

    setPrecomputedVideoInfo(newVideoInfoMap);

    if (successfulResults.length === 0) {
      // eslint-disable-next-line no-console
      console.warn('所有播放源测速都失败，使用第一个播放源');
      return sources[0];
    }

    // 找出所有有效速度的最大值，用于线性映射
    const validSpeeds = successfulResults
      .map((result) => {
        const speedStr = result.testResult.loadSpeed;
        if (speedStr === '未知' || speedStr === '测量中...') return 0;

        const match = speedStr.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
        if (!match) return 0;

        const value = parseFloat(match[1]);
        const unit = match[2];
        return unit === 'MB/s' ? value * 1024 : value; // 统一转换为 KB/s
      })
      .filter((speed) => speed > 0);

    const maxSpeed = validSpeeds.length > 0 ? Math.max(...validSpeeds) : 1024; // 默认1MB/s作为基准

    // 找出所有有效延迟的最小值和最大值，用于线性映射
    const validPings = successfulResults
      .map((result) => result.testResult.pingTime)
      .filter((ping) => ping > 0);

    const minPing = validPings.length > 0 ? Math.min(...validPings) : 50;
    const maxPing = validPings.length > 0 ? Math.max(...validPings) : 1000;

    // 计算每个结果的评分
    const resultsWithScore = successfulResults.map((result) => ({
      ...result,
      score: calculateSourceScore(
        result.testResult,
        maxSpeed,
        minPing,
        maxPing
      ),
    }));

    // 按综合评分排序，选择最佳播放源
    resultsWithScore.sort((a, b) => b.score - a.score);

    // eslint-disable-next-line no-console
    console.log('播放源评分排序结果:');
    resultsWithScore.forEach((result, index) => {
      // eslint-disable-next-line no-console
      console.log(
        `${index + 1}. ${
          result.source.source_name
        } - 评分: ${result.score.toFixed(2)} (${result.testResult.quality}, ${
          result.testResult.loadSpeed
        }, ${result.testResult.pingTime}ms)`
      );
    });

    return resultsWithScore[0].source;
  };

  // 计算播放源综合评分
  const calculateSourceScore = (
    testResult: {
      quality: string;
      loadSpeed: string;
      pingTime: number;
    },
    maxSpeed: number,
    minPing: number,
    maxPing: number
  ): number => {
    let score = 0;

    // 分辨率评分 (40% 权重)
    const qualityScore = (() => {
      switch (testResult.quality) {
        case '4K':
          return 100;
        case '2K':
          return 85;
        case '1080p':
          return 75;
        case '720p':
          return 60;
        case '480p':
          return 40;
        case 'SD':
          return 20;
        default:
          return 0;
      }
    })();
    score += qualityScore * 0.4;

    // 下载速度评分 (40% 权重) - 基于最大速度线性映射
    const speedScore = (() => {
      const speedStr = testResult.loadSpeed;
      if (speedStr === '未知' || speedStr === '测量中...') return 30;

      // 解析速度值
      const match = speedStr.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
      if (!match) return 30;

      const value = parseFloat(match[1]);
      const unit = match[2];
      const speedKBps = unit === 'MB/s' ? value * 1024 : value;

      // 基于最大速度线性映射，最高100分
      const speedRatio = speedKBps / maxSpeed;
      return Math.min(100, Math.max(0, speedRatio * 100));
    })();
    score += speedScore * 0.4;

    // 网络延迟评分 (20% 权重) - 基于延迟范围线性映射
    const pingScore = (() => {
      const ping = testResult.pingTime;
      if (ping <= 0) return 0; // 无效延迟给默认分

      // 如果所有延迟都相同，给满分
      if (maxPing === minPing) return 100;

      // 线性映射：最低延迟=100分，最高延迟=0分
      const pingRatio = (maxPing - ping) / (maxPing - minPing);
      return Math.min(100, Math.max(0, pingRatio * 100));
    })();
    score += pingScore * 0.2;

    return Math.round(score * 100) / 100; // 保留两位小数
  };

  // 更新视频地址（支持官方解析解密和本地资源）
  const updateVideoUrl = useCallback(
    async (detailData: SearchResult | null, episodeIndex: number) => {
      if (
        !detailData ||
        !detailData.episodes ||
        episodeIndex >= detailData.episodes.length
      ) {
        setVideoUrl('');
        setDecrypting(false);
        setDecryptError(null);
        return;
      }

      const originalUrl = detailData.episodes[episodeIndex] || '';
      if (!originalUrl) {
        setVideoUrl('');
        setDecrypting(false);
        setDecryptError(null);
        return;
      }

      // 【本地资源检测】优先检查本地资源
      try {
        console.log(
          `[updateVideoUrl] 检查本地资源: ${detailData.source}_${
            detailData.id
          }, 集数: ${episodeIndex + 1}`
        );
        const localResourceResponse = await fetch(
          `/api/local-resource?source=${encodeURIComponent(
            detailData.source
          )}&id=${encodeURIComponent(detailData.id)}`
        );

        if (localResourceResponse.ok) {
          const localResourceData = await localResourceResponse.json();
          console.log(
            `[updateVideoUrl] 本地资源检测结果: exists=${
              localResourceData.exists
            }, hasMetadata=${!!localResourceData.metadata}`
          );

          if (localResourceData.exists && localResourceData.metadata) {
            // 本地资源存在，使用本地资源播放
            const episodeNumber = episodeIndex + 1;
            // 获取剧集文件路径（可能是相对路径或绝对路径）
            const episodePath =
              localResourceData.metadata.episodes[episodeIndex] ||
              localResourceData.metadata.episodes[0];

            console.log(
              `[updateVideoUrl] 剧集路径: episodeIndex=${episodeIndex}, episodePath=${episodePath}, totalEpisodes=${localResourceData.metadata.episodes.length}`
            );

            if (episodePath) {
              // 处理路径：episodePath 可能是绝对路径或相对路径
              let fullPath = episodePath;

              // 如果 episodePath 已经是完整路径（包含 data/videos），直接使用
              if (episodePath.includes('data/videos')) {
                // 已经是完整路径，直接使用
                fullPath = episodePath;
              } else if (!episodePath.startsWith('/')) {
                // 相对路径，需要拼接本地路径
                fullPath = `${localResourceData.metadata.local_path}/${episodePath}`;
              }

              // 确保路径格式正确（移除开头的 ./ 如果有）
              fullPath = fullPath.replace(/^\.\//, '');

              const localPlayUrl = `/api/local-video?path=${encodeURIComponent(
                fullPath
              )}`;

              console.log(
                `[updateVideoUrl] ✓ 使用本地资源播放: ${detailData.source}_${detailData.id}, 集数: ${episodeNumber}, URL: ${localPlayUrl}`
              );
              setVideoUrl(localPlayUrl);
              setIsUsingLocalResource(true);
              setDecrypting(false);
              setDecryptError(null);
              return;
            } else {
              console.warn(
                `[updateVideoUrl] ⚠️ 本地资源存在但未找到剧集路径: episodeIndex=${episodeIndex}`
              );
            }
          } else {
            console.log(
              `[updateVideoUrl] 本地资源不存在或元数据缺失，将使用在线资源`
            );
            setIsUsingLocalResource(false);
          }
        } else {
          console.warn(
            `[updateVideoUrl] 本地资源检测请求失败: ${localResourceResponse.status}`
          );
          setIsUsingLocalResource(false);
        }
      } catch (error) {
        // 本地资源检测失败，继续使用在线资源
        console.warn('[updateVideoUrl] 本地资源检测失败，使用在线资源:', error);
        setIsUsingLocalResource(false);
      }

      // 标记未使用本地资源（将使用在线资源）
      setIsUsingLocalResource(false);

      // 检查是否是官方解析资源
      const apiSite = sourceConfig.find((s) => s.key === detailData.source);
      const needsDecrypt = apiSite?.official_parser === true;

      console.log('[updateVideoUrl] 检查官方解析:', {
        source: detailData.source,
        originalUrl: originalUrl.substring(0, 100),
        sourceConfigLength: sourceConfig.length,
        apiSite: apiSite
          ? { key: apiSite.key, official_parser: apiSite.official_parser }
          : null,
        needsDecrypt,
      });

      if (!needsDecrypt) {
        // 普通资源，直接设置URL
        console.log('[updateVideoUrl] 普通资源，直接使用URL');
        setVideoUrl(originalUrl);
        setDecrypting(false);
        setDecryptError(null);
        return;
      }

      // 官方解析资源，需要解密
      // 使用默认解析器URL（detail字段仅用于爬取详情页，不用于解析）
      const parserUrl = 'https://jx.789jiexi.com';

      console.log('[updateVideoUrl] 开始官方解析解密:', {
        parserUrl,
        videoUrl: originalUrl.substring(0, 100),
      });

      setDecrypting(true);
      setDecryptError(null);

      try {
        const response = await fetch('/api/decrypt', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            parserUrl: parserUrl,
            videoUrl: originalUrl,
          }),
        });

        const result = await response.json();

        console.log('[updateVideoUrl] 解密API响应:', {
          success: result.success,
          cached: result.cached,
          error: result.error,
          m3u8Url: result.m3u8Url ? result.m3u8Url.substring(0, 100) : null,
        });

        if (result.success && result.m3u8Url) {
          // 解密成功，使用解密后的URL
          const decryptedUrl = result.m3u8Url;
          console.log(
            '[updateVideoUrl] ✓ 官方解析解密成功，设置videoUrl:',
            decryptedUrl.substring(0, 100)
          );
          setVideoUrl(decryptedUrl);
          setDecrypting(false);
          setDecryptError(null);
        } else {
          // 解密失败
          const errorMsg =
            result.error || '视频解析失败，请稍后重试或切换其他资源';
          console.error('[updateVideoUrl] ✗ 官方解析解密失败:', errorMsg);
          setDecryptError(errorMsg);
          setDecrypting(false);
          // 不设置videoUrl，让用户选择是否切换
        }
      } catch (error) {
        // 网络错误或其他错误
        const errorMsg =
          error instanceof Error ? error.message : '网络错误，请检查网络后重试';
        console.error('[updateVideoUrl] ✗ 官方解析解密请求失败:', error);
        setDecryptError(errorMsg);
        setDecrypting(false);
      }
    },
    [sourceConfig]
  );

  const ensureVideoSource = (video: HTMLVideoElement | null, url: string) => {
    if (!video || !url) return;
    const sources = Array.from(video.getElementsByTagName('source'));
    const existed = sources.some((s) => s.src === url);
    if (!existed) {
      // 移除旧的 source，保持唯一
      sources.forEach((s) => s.remove());
      const sourceEl = document.createElement('source');
      sourceEl.src = url;
      video.appendChild(sourceEl);
    }

    // 始终允许远程播放（AirPlay / Cast）
    video.disableRemotePlayback = false;
    // 如果曾经有禁用属性，移除之
    if (video.hasAttribute('disableRemotePlayback')) {
      video.removeAttribute('disableRemotePlayback');
    }
  };

  // 去广告相关函数
  function filterAdsFromM3U8(m3u8Content: string): string {
    if (!m3u8Content) return '';

    // 按行分割M3U8内容
    const lines = m3u8Content.split('\n');
    const filteredLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 只过滤#EXT-X-DISCONTINUITY标识
      if (!line.includes('#EXT-X-DISCONTINUITY')) {
        filteredLines.push(line);
      }
    }

    return filteredLines.join('\n');
  }

  // 跳过片头片尾配置相关函数
  const handleSkipConfigChange = async (newConfig: {
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }) => {
    if (!currentSourceRef.current || !currentIdRef.current) return;

    try {
      setSkipConfig(newConfig);
      if (!newConfig.enable && !newConfig.intro_time && !newConfig.outro_time) {
        await deleteSkipConfig(currentSourceRef.current, currentIdRef.current);
        artPlayerRef.current.setting.update({
          name: '跳过片头片尾',
          html: '跳过片头片尾',
          switch: skipConfigRef.current.enable,
          onSwitch: function (item: any) {
            const newConfig = {
              ...skipConfigRef.current,
              enable: !item.switch,
            };
            handleSkipConfigChange(newConfig);
            return !item.switch;
          },
        });
        artPlayerRef.current.setting.update({
          name: '设置片头',
          html: '设置片头',
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L17 12" stroke="#ffffff" stroke-width="2"/><path d="M17 6L17 18" stroke="#ffffff" stroke-width="2"/></svg>',
          tooltip:
            skipConfigRef.current.intro_time === 0
              ? '设置片头时间'
              : `${formatTime(skipConfigRef.current.intro_time)}`,
          onClick: function () {
            const currentTime = artPlayerRef.current?.currentTime || 0;
            if (currentTime > 0) {
              const newConfig = {
                ...skipConfigRef.current,
                intro_time: currentTime,
              };
              handleSkipConfigChange(newConfig);
              return `${formatTime(currentTime)}`;
            }
          },
        });
        artPlayerRef.current.setting.update({
          name: '设置片尾',
          html: '设置片尾',
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 6L7 18" stroke="#ffffff" stroke-width="2"/><path d="M7 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
          tooltip:
            skipConfigRef.current.outro_time >= 0
              ? '设置片尾时间'
              : `-${formatTime(-skipConfigRef.current.outro_time)}`,
          onClick: function () {
            const outroTime =
              -(
                artPlayerRef.current?.duration -
                artPlayerRef.current?.currentTime
              ) || 0;
            if (outroTime < 0) {
              const newConfig = {
                ...skipConfigRef.current,
                outro_time: outroTime,
              };
              handleSkipConfigChange(newConfig);
              return `-${formatTime(-outroTime)}`;
            }
          },
        });
      } else {
        await saveSkipConfig(
          currentSourceRef.current,
          currentIdRef.current,
          newConfig
        );
      }
      // eslint-disable-next-line no-console
      console.log('跳过片头片尾配置已保存:', newConfig);
    } catch (err) {
      console.error('保存跳过片头片尾配置失败:', err);
    }
  };

  const formatTime = (seconds: number): string => {
    if (seconds === 0) return '00:00';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.round(seconds % 60);

    if (hours === 0) {
      // 不到一小时，格式为 00:00
      return `${minutes.toString().padStart(2, '0')}:${remainingSeconds
        .toString()
        .padStart(2, '0')}`;
    } else {
      // 超过一小时，格式为 00:00:00
      return `${hours.toString().padStart(2, '0')}:${minutes
        .toString()
        .padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
  };

  class CustomHlsJsLoader extends Hls.DefaultConfig.loader {
    constructor(config: any) {
      super(config);
      const load = this.load.bind(this);
      this.load = function (context: any, config: any, callbacks: any) {
        // 拦截manifest和level请求
        if (
          (context as any).type === 'manifest' ||
          (context as any).type === 'level'
        ) {
          const onSuccess = callbacks.onSuccess;
          callbacks.onSuccess = function (
            response: any,
            stats: any,
            context: any
          ) {
            // 如果是m3u8文件，处理内容以移除广告分段
            if (response.data && typeof response.data === 'string') {
              // 过滤掉广告段 - 实现更精确的广告过滤逻辑
              response.data = filterAdsFromM3U8(response.data);
            }
            return onSuccess(response, stats, context, null);
          };
        }
        // 执行原始load方法
        load(context, config, callbacks);
      };
    }
  }

  // 获取源配置信息（用于检查official_parser）
  useEffect(() => {
    const fetchSourceConfig = async () => {
      try {
        console.log('[PlayPage] 开始获取源配置...');
        const response = await fetch('/api/server-config');
        if (response.ok) {
          const data = await response.json();
          if (data.SourceConfig) {
            const configs: Array<{
              key: string;
              official_parser?: boolean;
              detail?: string;
            }> = data.SourceConfig.map((s: any) => ({
              key: s.key,
              official_parser: s.official_parser,
              detail: s.detail,
            }));
            console.log('[PlayPage] ✓ 源配置加载完成:', {
              total: configs.length,
              officialParserSources: configs
                .filter((s) => s.official_parser)
                .map((s) => s.key),
              allSources: configs.map((s) => ({
                key: s.key,
                official_parser: s.official_parser,
              })),
            });
            setSourceConfig(configs);
          } else {
            console.warn('[PlayPage] ⚠️ 源配置数据为空，data:', data);
          }
        }
      } catch (error) {
        console.error('[PlayPage] 获取源配置失败:', error);
      }
    };
    fetchSourceConfig();
  }, []);

  // 当集数索引变化时自动更新视频地址
  // 注意：只有当sourceConfig加载完成后才调用updateVideoUrl
  useEffect(() => {
    if (sourceConfig.length === 0) {
      console.log('[PlayPage] sourceConfig未加载完成，跳过updateVideoUrl');
      return;
    }
    console.log('[PlayPage] 调用updateVideoUrl:', {
      detailSource: detail?.source,
      currentEpisodeIndex,
      sourceConfigLength: sourceConfig.length,
    });
    updateVideoUrl(detail, currentEpisodeIndex);
  }, [detail, currentEpisodeIndex, updateVideoUrl, sourceConfig]);

  // 【关键】进入页面时初始化 - 必须输出日志来确认代码执行
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('🔴 [PlayPage] useEffect 触发，准备调用 initAll');
    // eslint-disable-next-line no-console
    console.error(
      '🔴 [PlayPage] 当前URL:',
      typeof window !== 'undefined' ? window.location.href : 'SSR'
    );
    // eslint-disable-next-line no-console
    console.error('🔴 [PlayPage] searchParams:', {
      source: searchParams.get('source'),
      id: searchParams.get('id'),
      title: searchParams.get('title'),
      stitle: searchParams.get('stitle'),
    });

    const fetchSourceDetail = async (
      source: string,
      id: string
    ): Promise<SearchResult[]> => {
      try {
        // 【性能优化】优先从缓存获取
        const cachedDetail = detailCacheManager.getCachedDetail(source, id);
        if (cachedDetail) {
          // eslint-disable-next-line no-console
          console.log(`[DetailCache] 缓存命中: ${source}:${id}`);
          setAvailableSources([cachedDetail]);
          return [cachedDetail];
        }

        // 缓存未命中，从API获取
        // eslint-disable-next-line no-console
        console.log(`[DetailCache] 缓存未命中，从API获取: ${source}:${id}`);
        const detailResponse = await fetch(
          `/api/detail?source=${source}&id=${id}`
        );
        if (!detailResponse.ok) {
          throw new Error('获取视频详情失败');
        }
        const detailData = (await detailResponse.json()) as SearchResult;

        // 缓存详情供下次使用
        detailCacheManager.cacheDetail(source, id, detailData);

        setAvailableSources([detailData]);
        return [detailData];
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('获取视频详情失败:', err);
        return [];
      } finally {
        setSourceSearchLoading(false);
      }
    };
    const fetchSourcesData = async (query: string): Promise<SearchResult[]> => {
      // 【优化】优先使用多层缓存策略，减少 API 调用

      // 【优化1】首先尝试从 sessionStorage 获取（最新的搜索结果）
      try {
        const cached = sessionStorage.getItem(`search_results_${query.trim()}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          // 检查是否过期（5分钟内有效）
          const isExpired = Date.now() - parsed.timestamp > 5 * 60 * 1000;

          if (!isExpired && parsed.results && Array.isArray(parsed.results)) {
            // eslint-disable-next-line no-console
            console.log(
              '[PlayPage] ✓ 从 sessionStorage 获取搜索结果，跳过 API 调用'
            );

            // 处理搜索结果，根据规则过滤
            const results = parsed.results.filter(
              (result: SearchResult) =>
                result.title.replaceAll(' ', '').toLowerCase() ===
                  videoTitleRef.current.replaceAll(' ', '').toLowerCase() &&
                (videoYearRef.current
                  ? result.year.toLowerCase() ===
                    videoYearRef.current.toLowerCase()
                  : true) &&
                (searchType
                  ? (searchType === 'tv' && result.episodes.length > 1) ||
                    (searchType === 'movie' && result.episodes.length === 1)
                  : true)
            );

            if (results.length > 0) {
              setAvailableSources(results);
              setSourceSearchLoading(false);
              return results;
            }
          }
        }
      } catch (err) {
        // sessionStorage 解析失败，继续使用其他缓存或 API
        // eslint-disable-next-line no-console
        console.warn('[PlayPage] sessionStorage 数据无效，继续查找:', err);
      }

      // 【优化2】其次使用搜索缓存（searchCacheManager）
      const cachedResults = searchCacheManager.getCachedResults(query.trim());
      if (cachedResults) {
        // eslint-disable-next-line no-console
        console.log('[PlayPage] ✓ 从搜索缓存获取结果，跳过 API 调用');

        // 处理搜索结果，根据规则过滤
        const results = cachedResults.filter(
          (result: SearchResult) =>
            result.title.replaceAll(' ', '').toLowerCase() ===
              videoTitleRef.current.replaceAll(' ', '').toLowerCase() &&
            (videoYearRef.current
              ? result.year.toLowerCase() === videoYearRef.current.toLowerCase()
              : true) &&
            (searchType
              ? (searchType === 'tv' && result.episodes.length > 1) ||
                (searchType === 'movie' && result.episodes.length === 1)
              : true)
        );

        if (results.length > 0) {
          setAvailableSources(results);
          setSourceSearchLoading(false);
          return results;
        }
      }

      // 【优化】检测SSE是否仍在进行中（通知将在useEffect中处理）

      // 【最后】从 API 获取
      // eslint-disable-next-line no-console
      console.error('🔴 [PlayPage] ⚠️ 从 API 获取搜索结果（缓存未命中）');
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(query.trim())}`
        );
        if (!response.ok) {
          throw new Error('搜索失败');
        }
        const data = await response.json();

        // 处理搜索结果，根据规则过滤
        const results = data.results.filter(
          (result: SearchResult) =>
            result.title.replaceAll(' ', '').toLowerCase() ===
              videoTitleRef.current.replaceAll(' ', '').toLowerCase() &&
            (videoYearRef.current
              ? result.year.toLowerCase() === videoYearRef.current.toLowerCase()
              : true) &&
            (searchType
              ? (searchType === 'tv' && result.episodes.length > 1) ||
                (searchType === 'movie' && result.episodes.length === 1)
              : true)
        );
        setAvailableSources(results);
        return results;
      } catch (err) {
        setSourceSearchError(err instanceof Error ? err.message : '搜索失败');
        setAvailableSources([]);
        return [];
      } finally {
        setSourceSearchLoading(false);
      }
    };

    // 【新增】后台SSE结果加载器：持续监听sessionStorage更新
    // 注意：这个函数会在useEffect中调用，用于监听sessionStorage变化

    const initAll = async () => {
      // 直接从 searchParams 读取，避免 state 初始化延迟的问题
      const rawUrlSource = searchParams.get('source');
      const rawUrlId = searchParams.get('id');
      const urlSource = rawUrlSource?.trim() || '';
      const urlId = rawUrlId?.trim() || '';
      const urlTitle = searchParams.get('title')?.trim() || '';
      const urlSearchTitle = searchParams.get('stitle')?.trim() || '';
      const urlYear = searchParams.get('year')?.trim() || '';

      // 获取完整的 URL 用于调试
      const fullUrl = typeof window !== 'undefined' ? window.location.href : '';
      const timestamp = Date.now();

      // 【诊断日志】详细的参数验证日志（强制输出，不会被过滤）
      // eslint-disable-next-line no-console
      console.error(`🔴 [PlayPage] 🚀 initAll 开始 [${timestamp}]:`, {
        fullUrl,
        rawParams: {
          rawUrlSource: `"${rawUrlSource}"`,
          rawUrlId: `"${rawUrlId}"`,
        },
        processedParams: {
          urlSource: `"${urlSource}"`,
          urlId: `"${urlId}"`,
          urlTitle: `"${urlTitle}"`,
          urlSearchTitle: `"${urlSearchTitle}"`,
        },
        validation: {
          hasSource: urlSource.length > 0,
          hasId: urlId.length > 0,
          hasSourceAndId: urlSource.length > 0 && urlId.length > 0,
          sourceLength: urlSource.length,
          idLength: urlId.length,
        },
        stateParams: {
          currentSource,
          currentId,
          videoTitle,
        },
      });

      // 参数检查：必须至少有 source+id 或 title+stitle
      if (!urlSource && !urlId && !urlTitle && !urlSearchTitle) {
        // eslint-disable-next-line no-console
        console.warn('[PlayPage] ✗ 缺少必要参数，无法继续');
        setError('缺少必要参数');
        setLoading(false);
        return;
      }
      setLoading(true);

      let sourcesInfo: SearchResult[] = [];

      // 【性能优化】如果有明确的 source 和 id（非空字符串），优先尝试从缓存获取，绝对不执行搜索
      // 严格验证：必须同时有非空的 source 和 id
      const hasValidSourceAndId = urlSource.length > 0 && urlId.length > 0;

      if (hasValidSourceAndId) {
        // eslint-disable-next-line no-console
        console.error(
          `🔴 [PlayPage] ✓ 检测到有效的 source 和 id，优先使用缓存/详情API，绝对跳过搜索 [${timestamp}]:`,
          {
            urlSource,
            urlId,
            decision: '使用缓存/详情API，不执行搜索',
          }
        );
        setLoadingStage('fetching');
        setLoadingMessage('🎬 正在获取视频详情...');

        // 同步更新 state
        if (urlSource !== currentSource) {
          setCurrentSource(urlSource);
        }
        if (urlId !== currentId) {
          setCurrentId(urlId);
        }

        // 优先尝试从缓存获取（同步操作，立即返回）
        const cacheStartTime = Date.now();
        const cachedDetail = detailCacheManager.getCachedDetail(
          urlSource,
          urlId
        );
        const cacheTime = Date.now() - cacheStartTime;

        if (cachedDetail) {
          // eslint-disable-next-line no-console
          console.log(
            `[DetailCache] ✓ 缓存命中，立即使用 [耗时: ${cacheTime}ms]: ${urlSource}:${urlId}`
          );
          sourcesInfo = [cachedDetail];

          // 立即设置 detail 和相关状态，让UI能快速响应
          setDetail(cachedDetail);
          setVideoYear(cachedDetail.year);
          const finalTitle =
            cachedDetail.title || urlTitle || videoTitleRef.current;
          setVideoTitle(finalTitle);
          setVideoCover(cachedDetail.poster);

          // 【新增】尝试从 sessionStorage 读取聚合的源数据
          try {
            // 尝试多个可能的 key 格式以提高兼容性
            const possibleKeys = [
              `video_sources_${finalTitle}_${cachedDetail.year || ''}`,
              `video_sources_${urlTitle}_${urlYear || ''}`,
              `video_sources_${finalTitle}_${urlYear || ''}`,
              `video_sources_${urlTitle}_${cachedDetail.year || ''}`,
            ];

            let aggData: string | null = null;
            // 尝试从多个可能的key读取聚合数据
            for (const key of possibleKeys) {
              aggData = sessionStorage.getItem(key);
              if (aggData) {
                // eslint-disable-next-line no-console
                console.log(
                  `[PlayPage] ✓ 从 sessionStorage 读取聚合数据，key: ${key}`
                );
                break;
              }
            }

            if (aggData) {
              const parsed = JSON.parse(aggData);
              if (
                parsed.items &&
                Array.isArray(parsed.items) &&
                parsed.items.length > 0
              ) {
                console.log(
                  `[PlayPage] ✓ 找到聚合源数据，共 ${parsed.items.length} 个源`
                );
                setAvailableSources(parsed.items);
                sourcesInfo = parsed.items; // 更新 sourcesInfo 以便后续处理
              } else {
                console.warn('[PlayPage] 聚合数据格式不正确');
                setAvailableSources([cachedDetail]);
              }
            } else {
              console.log(
                `[PlayPage] 未找到聚合数据，尝试的keys: ${possibleKeys.join(
                  ', '
                )}`
              );
              setAvailableSources([cachedDetail]);
            }
          } catch (err) {
            console.warn('[PlayPage] 读取聚合数据失败，使用单个源:', err);
            setAvailableSources([cachedDetail]);
          }

          // eslint-disable-next-line no-console
          console.log(`[PlayPage] ✓ 缓存路径完成，绝不执行搜索 [${timestamp}]`);
        } else {
          // 缓存未命中，调用 fetchSourceDetail（内部会从API获取并缓存）
          // eslint-disable-next-line no-console
          console.log(
            `[DetailCache] ⏳ 缓存未命中，从详情API获取: ${urlSource}:${urlId}`
          );
          const apiStartTime = Date.now();
          sourcesInfo = await fetchSourceDetail(urlSource, urlId);
          const apiTime = Date.now() - apiStartTime;

          // 如果 API 获取成功，确保设置了状态
          if (sourcesInfo.length > 0) {
            const detailData = sourcesInfo[0];
            setDetail(detailData);
            setVideoYear(detailData.year);
            const finalTitle =
              detailData.title || urlTitle || videoTitleRef.current;
            setVideoTitle(finalTitle);
            setVideoCover(detailData.poster);

            // 【新增】尝试从 sessionStorage 读取聚合的源数据
            try {
              // 尝试多个可能的 key 格式以提高兼容性
              const possibleKeys = [
                `video_sources_${finalTitle}_${detailData.year || ''}`,
                `video_sources_${urlTitle}_${urlYear || ''}`,
                `video_sources_${finalTitle}_${urlYear || ''}`,
                `video_sources_${urlTitle}_${detailData.year || ''}`,
              ];

              let aggData: string | null = null;
              // 尝试从多个可能的key读取聚合数据
              for (const key of possibleKeys) {
                aggData = sessionStorage.getItem(key);
                if (aggData) {
                  // eslint-disable-next-line no-console
                  console.log(
                    `[PlayPage] ✓ 从 sessionStorage 读取聚合数据，key: ${key}`
                  );
                  break;
                }
              }

              if (aggData) {
                const parsed = JSON.parse(aggData);
                if (
                  parsed.items &&
                  Array.isArray(parsed.items) &&
                  parsed.items.length > 0
                ) {
                  // eslint-disable-next-line no-console
                  console.log(
                    `[PlayPage] ✓ 找到聚合源数据，共 ${parsed.items.length} 个源`
                  );
                  setAvailableSources(parsed.items);
                  sourcesInfo = parsed.items; // 更新 sourcesInfo 以便后续处理
                } else {
                  // eslint-disable-next-line no-console
                  console.warn('[PlayPage] 聚合数据格式不正确');
                  setAvailableSources([detailData]);
                }
              } else {
                // eslint-disable-next-line no-console
                console.log(
                  `[PlayPage] 未找到聚合数据，尝试的keys: ${possibleKeys.join(
                    ', '
                  )}`
                );
                setAvailableSources([detailData]);
              }
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn('[PlayPage] 读取聚合数据失败，使用单个源:', err);
              setAvailableSources([detailData]);
            }

            // eslint-disable-next-line no-console
            console.log(
              `[DetailCache] ✓ 详情API获取成功 [耗时: ${apiTime}ms]: ${urlSource}:${urlId}`
            );
            // eslint-disable-next-line no-console
            console.log(
              `[PlayPage] ✓ 详情API路径完成，绝不执行搜索 [${timestamp}]`
            );
          } else {
            // eslint-disable-next-line no-console
            console.error(
              `[DetailCache] ✗ 详情API获取失败 [耗时: ${apiTime}ms]: ${urlSource}:${urlId}`
            );
            // 注意：即使失败也绝不执行搜索，因为已经有明确的 source 和 id
            setError('获取视频详情失败，请检查网络连接或稍后重试');
            setLoading(false);
            return;
          }
        }
      } else {
        // 没有明确的 source 和 id，才执行搜索
        console.error(
          `🔴 [PlayPage] ⚠️ 没有有效的 source 和 id，执行搜索 [${timestamp}]:`,
          {
            urlSearchTitle,
            urlTitle,
            reason: {
              sourceValid: urlSource.length > 0,
              idValid: urlId.length > 0,
              missingBoth: !urlSource && !urlId,
              urlSourceValue: `"${urlSource}"`,
              urlIdValue: `"${urlId}"`,
              urlSourceLength: urlSource.length,
              urlIdLength: urlId.length,
            },
            fullUrl:
              typeof window !== 'undefined' ? window.location.href : 'N/A',
          }
        );
        // eslint-disable-next-line no-console
        console.error(
          '🔴 [PlayPage] ⚠️ 这通常不应该发生！如果从搜索结果点击进入，应该有source和id参数'
        );

        setLoadingStage('searching');
        setLoadingMessage('🔍 正在搜索播放源...');
        const searchStartTime = Date.now();
        sourcesInfo = await fetchSourcesData(urlSearchTitle || urlTitle);
        const searchTime = Date.now() - searchStartTime;
        // eslint-disable-next-line no-console
        console.log(
          `[PlayPage] 搜索完成，结果数量: ${sourcesInfo.length} [耗时: ${searchTime}ms]`
        );
      }
      if (sourcesInfo.length === 0) {
        setError('未找到匹配结果');
        setLoading(false);
        return;
      }

      let detailData: SearchResult = sourcesInfo[0];

      // 【性能优化】源选择逻辑：如果有明确的 source 和 id，绝对不使用优选逻辑
      // 严格验证：必须同时有非空的 source 和 id
      const checkSource = urlSource.length > 0 ? urlSource : currentSource;
      const checkId = urlId.length > 0 ? urlId : currentId;
      const shouldUseDirectly = checkSource.length > 0 && checkId.length > 0;

      // eslint-disable-next-line no-console
      console.log('[PlayPage] 源选择逻辑判断:', {
        checkSource: `"${checkSource}"`,
        checkId: `"${checkId}"`,
        shouldUseDirectly,
        needPrefer: needPreferRef.current,
        optimizationEnabled,
        sourcesInfoLength: sourcesInfo.length,
        decision: shouldUseDirectly
          ? '直接使用指定源，绝不执行优选'
          : optimizationEnabled
          ? '执行优选逻辑'
          : '使用第一个源',
      });

      // 【核心修复】如果有明确的 source 和 id，无论 prefer 参数如何，都直接使用，绝不执行优选
      if (shouldUseDirectly) {
        // eslint-disable-next-line no-console
        console.log(
          '[PlayPage] ✓ 有明确的 source 和 id，直接使用，绝对跳过优选逻辑'
        );
        const target = sourcesInfo.find(
          (source) => source.source === checkSource && source.id === checkId
        );
        if (target) {
          detailData = target;
          // eslint-disable-next-line no-console
          console.log('[PlayPage] ✓ 成功找到指定源，跳过优选:', {
            source: target.source,
            id: target.id,
          });
        } else {
          // eslint-disable-next-line no-console
          console.error('[PlayPage] ✗ 在sourcesInfo中未找到指定的源:', {
            checkSource,
            checkId,
            availableSources: sourcesInfo.map((s) => ({
              source: s.source,
              id: s.id,
            })),
          });
          setError('未找到匹配结果');
          setLoading(false);
          return;
        }
      } else if (
        !shouldUseDirectly &&
        optimizationEnabled &&
        sourcesInfo.length > 1
      ) {
        // 只有在没有明确的 source 和 id，且有多个源时，才执行优选
        // eslint-disable-next-line no-console
        console.log('[PlayPage] ⚡ 执行源优选（因为没有明确的 source 和 id）');
        setLoadingStage('preferring');
        setLoadingMessage('⚡ 正在优选最佳播放源...');
        const preferStartTime = Date.now();
        detailData = await preferBestSource(sourcesInfo);
        const preferTime = Date.now() - preferStartTime;
        // eslint-disable-next-line no-console
        console.log(`[PlayPage] ✓ 优选完成 [耗时: ${preferTime}ms]:`, {
          source: detailData.source,
          id: detailData.id,
        });
      } else {
        // 没有明确的 source 和 id，且只有一个源或优选未启用，使用第一个
        // eslint-disable-next-line no-console
        console.log(
          '[PlayPage] ✓ 使用第一个源（没有明确的 source 和 id，且优选未启用或只有一个源）'
        );
        detailData = sourcesInfo[0];
      }

      // eslint-disable-next-line no-console
      console.log(detailData.source, detailData.id);

      setNeedPrefer(false);
      setCurrentSource(detailData.source);
      setCurrentId(detailData.id);
      setVideoYear(detailData.year);
      setVideoTitle(detailData.title || videoTitleRef.current);
      setVideoCover(detailData.poster);
      setDetail(detailData);
      if (currentEpisodeIndex >= detailData.episodes.length) {
        setCurrentEpisodeIndex(0);
      }

      // 规范URL参数
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', detailData.source);
      newUrl.searchParams.set('id', detailData.id);
      newUrl.searchParams.set('year', detailData.year);
      newUrl.searchParams.set('title', detailData.title);
      newUrl.searchParams.delete('prefer');
      window.history.replaceState({}, '', newUrl.toString());

      setLoadingStage('ready');
      setLoadingMessage('✨ 准备就绪，即将开始播放...');

      // 【新增】如果有searchTitle，启动后台加载器持续监听SSE结果更新（无论是否有source和id）
      const searchTitle = urlSearchTitle || urlTitle;
      if (searchTitle) {
        try {
          const trimmedQuery = searchTitle.trim();
          let lastResultCount = 0;
          let lastTimestamp = 0;

          // 初始化时读取当前结果数量和时间戳
          // 延迟启动，避免阻塞初始化
          setTimeout(() => {
            console.log(
              '[PlayPage] ⚡ 启动SSE后台加载器，持续监听搜索结果更新'
            );

            let checkCount = 0;
            const maxChecks = 60; // 最多检查60次（约30秒）

            const loader = () => {
              try {
                checkCount++;

                // 检查是否有新的搜索结果
                const cached = sessionStorage.getItem(
                  `search_results_${trimmedQuery}`
                );
                if (cached) {
                  const parsed = JSON.parse(cached);

                  // 检查是否有更新（通过结果数量或时间戳判断）
                  const hasUpdate =
                    parsed.timestamp > lastTimestamp ||
                    parsed.results.length > lastResultCount;

                  if (hasUpdate) {
                    lastTimestamp = parsed.timestamp;
                    lastResultCount = parsed.results.length;

                    // 过滤匹配的结果
                    const filteredResults = parsed.results.filter(
                      (result: SearchResult) => {
                        const titleMatch =
                          result.title.replaceAll(' ', '').toLowerCase() ===
                          videoTitleRef.current
                            .replaceAll(' ', '')
                            .toLowerCase();
                        const yearMatch = videoYearRef.current
                          ? result.year.toLowerCase() ===
                            videoYearRef.current.toLowerCase()
                          : true;
                        const typeMatch = searchType
                          ? (searchType === 'tv' &&
                              result.episodes.length > 1) ||
                            (searchType === 'movie' &&
                              result.episodes.length === 1)
                          : true;

                        return titleMatch && yearMatch && typeMatch;
                      }
                    );

                    // 合并新源到 availableSources（使用函数式更新确保获取最新状态）
                    setAvailableSources((prevSources) => {
                      const existingKeys = new Set(
                        prevSources.map((s) => `${s.source}-${s.id}`)
                      );
                      const newSources = filteredResults.filter(
                        (r: SearchResult) =>
                          !existingKeys.has(`${r.source}-${r.id}`)
                      );

                      if (newSources.length > 0) {
                        // eslint-disable-next-line no-console
                        console.log(
                          `[PlayPage] 📥 后台加载到 ${newSources.length} 个新源（总数：${filteredResults.length}）`
                        );
                        return [...prevSources, ...newSources];
                      }
                      return prevSources;
                    });
                  }
                }

                // 检查是否应该继续监听
                const shouldContinue = checkCount < maxChecks;
                const status = sessionStorage.getItem(
                  `sse_status_${trimmedQuery}`
                );

                if (status) {
                  const parsedStatus = JSON.parse(status);
                  if (parsedStatus.isActive && shouldContinue) {
                    // SSE还在进行，继续监听
                    setTimeout(loader, 300);
                  } else {
                    // SSE已完成，但再检查一次是否有最终更新
                    setTimeout(() => {
                      loader(); // 最后一次检查
                      // eslint-disable-next-line no-console
                      console.log('[PlayPage] ✓ SSE已完成，后台加载器将停止');
                    }, 500);
                  }
                } else if (shouldContinue) {
                  // 没有SSE状态信息，但可能还在更新，继续监听一段时间（最多30秒）
                  setTimeout(loader, 300);
                } else {
                  // eslint-disable-next-line no-console
                  console.log('[PlayPage] ✓ 达到最大检查次数，停止后台加载器');
                }
              } catch (err) {
                // eslint-disable-next-line no-console
                console.warn('[PlayPage] SSE后台加载器执行失败:', err);
                // 即使出错也继续监听（如果还有检查次数）
                if (checkCount < maxChecks) {
                  setTimeout(loader, 500);
                }
              }
            };

            // 立即执行一次，获取初始结果
            loader();
          }, 500); // 缩短延迟时间，更快启动监听
        } catch (err) {
          console.warn('[PlayPage] SSE后台加载器启动失败:', err);
        }
      }

      // 短暂延迟让用户看到完成状态
      setTimeout(() => {
        setLoading(false);
      }, 1000);
    };

    console.error('🔴 [PlayPage] 准备调用 initAll()');
    initAll();
    console.error('🔴 [PlayPage] initAll() 调用完成');
  }, [searchParams]);

  // 播放记录处理
  useEffect(() => {
    // 仅在初次挂载时检查播放记录
    const initFromHistory = async () => {
      if (!currentSource || !currentId) return;

      try {
        const allRecords = await getAllPlayRecords();
        const key = generateStorageKey(currentSource, currentId);
        const record = allRecords[key];

        if (record) {
          const targetIndex = record.index - 1;
          const targetTime = record.play_time;

          // 更新当前选集索引
          if (targetIndex !== currentEpisodeIndex) {
            setCurrentEpisodeIndex(targetIndex);
          }

          // 保存待恢复的播放进度，待播放器就绪后跳转
          resumeTimeRef.current = targetTime;
        }
      } catch (err) {
        console.error('读取播放记录失败:', err);
      }
    };

    initFromHistory();
  }, []);

  // 跳过片头片尾配置处理
  useEffect(() => {
    // 仅在初次挂载时检查跳过片头片尾配置
    const initSkipConfig = async () => {
      if (!currentSource || !currentId) return;

      try {
        const config = await getSkipConfig(currentSource, currentId);
        if (config) {
          setSkipConfig(config);
        }
      } catch (err) {
        console.error('读取跳过片头片尾配置失败:', err);
      }
    };

    initSkipConfig();
  }, []);

  // 处理换源
  const handleSourceChange = async (
    newSource: string,
    newId: string,
    newTitle: string
  ) => {
    try {
      // 显示换源加载状态
      setVideoLoadingStage('sourceChanging');
      setIsVideoLoading(true);

      // 记录当前播放进度（仅在同一集数切换时恢复）
      const currentPlayTime = artPlayerRef.current?.currentTime || 0;
      console.log('换源前当前播放时间:', currentPlayTime);

      // 清除前一个历史记录
      if (currentSourceRef.current && currentIdRef.current) {
        try {
          await deletePlayRecord(
            currentSourceRef.current,
            currentIdRef.current
          );
          console.log('已清除前一个播放记录');
        } catch (err) {
          console.error('清除播放记录失败:', err);
        }
      }

      // 清除并设置下一个跳过片头片尾配置
      if (currentSourceRef.current && currentIdRef.current) {
        try {
          await deleteSkipConfig(
            currentSourceRef.current,
            currentIdRef.current
          );
          await saveSkipConfig(newSource, newId, skipConfigRef.current);
        } catch (err) {
          console.error('清除跳过片头片尾配置失败:', err);
        }
      }

      const newDetail = availableSources.find(
        (source) => source.source === newSource && source.id === newId
      );
      if (!newDetail) {
        setError('未找到匹配结果');
        return;
      }

      // 尝试跳转到当前正在播放的集数
      let targetIndex = currentEpisodeIndex;

      // 如果当前集数超出新源的范围，则跳转到第一集
      if (!newDetail.episodes || targetIndex >= newDetail.episodes.length) {
        targetIndex = 0;
      }

      // 如果仍然是同一集数且播放进度有效，则在播放器就绪后恢复到原始进度
      if (targetIndex !== currentEpisodeIndex) {
        resumeTimeRef.current = 0;
      } else if (
        (!resumeTimeRef.current || resumeTimeRef.current === 0) &&
        currentPlayTime > 1
      ) {
        resumeTimeRef.current = currentPlayTime;
      }

      // 更新URL参数（不刷新页面）
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', newSource);
      newUrl.searchParams.set('id', newId);
      newUrl.searchParams.set('year', newDetail.year);
      window.history.replaceState({}, '', newUrl.toString());

      setVideoTitle(newDetail.title || newTitle);
      setVideoYear(newDetail.year);
      setVideoCover(newDetail.poster);
      setCurrentSource(newSource);
      setCurrentId(newId);
      setDetail(newDetail);
      setCurrentEpisodeIndex(targetIndex);
    } catch (err) {
      // 隐藏换源加载状态
      setIsVideoLoading(false);
      setError(err instanceof Error ? err.message : '换源失败');
    }
  };

  useEffect(() => {
    document.addEventListener('keydown', handleKeyboardShortcuts);
    return () => {
      document.removeEventListener('keydown', handleKeyboardShortcuts);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 集数切换
  // ---------------------------------------------------------------------------
  // 处理集数切换
  const handleEpisodeChange = (episodeNumber: number) => {
    if (episodeNumber >= 0 && episodeNumber < totalEpisodes) {
      // 在更换集数前保存当前播放进度
      if (artPlayerRef.current && artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      setCurrentEpisodeIndex(episodeNumber);
    }
  };

  const handlePreviousEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx > 0) {
      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      setCurrentEpisodeIndex(idx - 1);
    }
  };

  const handleNextEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx < d.episodes.length - 1) {
      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      setCurrentEpisodeIndex(idx + 1);
    }
  };

  // ---------------------------------------------------------------------------
  // 键盘快捷键
  // ---------------------------------------------------------------------------
  // 处理全局快捷键
  const handleKeyboardShortcuts = (e: KeyboardEvent) => {
    // 忽略输入框中的按键事件
    if (
      (e.target as HTMLElement).tagName === 'INPUT' ||
      (e.target as HTMLElement).tagName === 'TEXTAREA'
    )
      return;

    // Alt + 左箭头 = 上一集
    if (e.altKey && e.key === 'ArrowLeft') {
      if (detailRef.current && currentEpisodeIndexRef.current > 0) {
        handlePreviousEpisode();
        e.preventDefault();
      }
    }

    // Alt + 右箭头 = 下一集
    if (e.altKey && e.key === 'ArrowRight') {
      const d = detailRef.current;
      const idx = currentEpisodeIndexRef.current;
      if (d && idx < d.episodes.length - 1) {
        handleNextEpisode();
        e.preventDefault();
      }
    }

    // 左箭头 = 快退
    if (!e.altKey && e.key === 'ArrowLeft') {
      if (artPlayerRef.current && artPlayerRef.current.currentTime > 5) {
        artPlayerRef.current.currentTime -= 10;
        e.preventDefault();
      }
    }

    // 右箭头 = 快进
    if (!e.altKey && e.key === 'ArrowRight') {
      if (
        artPlayerRef.current &&
        artPlayerRef.current.currentTime < artPlayerRef.current.duration - 5
      ) {
        artPlayerRef.current.currentTime += 10;
        e.preventDefault();
      }
    }

    // 上箭头 = 音量+
    if (e.key === 'ArrowUp') {
      if (artPlayerRef.current && artPlayerRef.current.volume < 1) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume + 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `音量: ${Math.round(
          artPlayerRef.current.volume * 100
        )}`;
        e.preventDefault();
      }
    }

    // 下箭头 = 音量-
    if (e.key === 'ArrowDown') {
      if (artPlayerRef.current && artPlayerRef.current.volume > 0) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume - 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `音量: ${Math.round(
          artPlayerRef.current.volume * 100
        )}`;
        e.preventDefault();
      }
    }

    // 空格 = 播放/暂停
    if (e.key === ' ') {
      if (artPlayerRef.current) {
        artPlayerRef.current.toggle();
        e.preventDefault();
      }
    }

    // f 键 = 切换全屏
    if (e.key === 'f' || e.key === 'F') {
      if (artPlayerRef.current) {
        artPlayerRef.current.fullscreen = !artPlayerRef.current.fullscreen;
        e.preventDefault();
      }
    }
  };

  // ---------------------------------------------------------------------------
  // 播放记录相关
  // ---------------------------------------------------------------------------
  // 保存播放进度
  const saveCurrentPlayProgress = async () => {
    if (
      !artPlayerRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current ||
      !videoTitleRef.current ||
      !detailRef.current?.source_name
    ) {
      return;
    }

    const player = artPlayerRef.current;
    const currentTime = player.currentTime || 0;
    const duration = player.duration || 0;

    // 如果播放时间太短（少于5秒）或者视频时长无效，不保存
    if (currentTime < 1 || !duration) {
      return;
    }

    try {
      const playRecord = {
        title: videoTitleRef.current,
        source_name: detailRef.current?.source_name || '',
        year: detailRef.current?.year,
        cover: detailRef.current?.poster || '',
        index: currentEpisodeIndexRef.current + 1, // 转换为1基索引
        total_episodes: detailRef.current?.episodes.length || 1,
        play_time: Math.floor(currentTime),
        total_time: Math.floor(duration),
        save_time: Date.now(),
        search_title: searchTitle,
        // 添加 source 和 id 到播放记录中，用于自动下载
        source: currentSourceRef.current,
        id: currentIdRef.current,
      };

      console.log('[PlayPage] 保存播放记录:', {
        source: currentSourceRef.current,
        id: currentIdRef.current,
        title: videoTitleRef.current,
        index: playRecord.index,
      });

      await savePlayRecord(
        currentSourceRef.current,
        currentIdRef.current,
        playRecord
      );

      lastSaveTimeRef.current = Date.now();
      console.log('播放进度已保存:', {
        title: videoTitleRef.current,
        episode: currentEpisodeIndexRef.current + 1,
        year: detailRef.current?.year,
        progress: `${Math.floor(currentTime)}/${Math.floor(duration)}`,
      });
    } catch (err) {
      console.error('保存播放进度失败:', err);
    }
  };

  useEffect(() => {
    // 页面即将卸载时保存播放进度
    const handleBeforeUnload = () => {
      saveCurrentPlayProgress();
    };

    // 页面可见性变化时保存播放进度
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveCurrentPlayProgress();
      }
    };

    // 添加事件监听器
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      // 清理事件监听器
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentEpisodeIndex, detail, artPlayerRef.current]);

  // 监听本地资源下载完成，自动切换到本地资源
  useEffect(() => {
    // 如果已经在使用本地资源，不需要检查
    if (isUsingLocalResource || !currentSource || !currentId || !detail) {
      return;
    }

    // 清理之前的定时器
    if (localResourceCheckIntervalRef.current) {
      clearInterval(localResourceCheckIntervalRef.current);
    }

    // 每5秒检查一次本地资源是否可用
    localResourceCheckIntervalRef.current = setInterval(async () => {
      try {
        const episodeIndex = currentEpisodeIndexRef.current;
        const episodeNumber = episodeIndex + 1;

        // 检查当前剧集是否已下载
        const localResourceResponse = await fetch(
          `/api/local-resource?source=${encodeURIComponent(
            currentSource
          )}&id=${encodeURIComponent(currentId)}`
        );

        if (localResourceResponse.ok) {
          const localResourceData = await localResourceResponse.json();

          if (localResourceData.exists && localResourceData.metadata) {
            const episodePath =
              localResourceData.metadata.episodes[episodeIndex] ||
              localResourceData.metadata.episodes[0];

            if (episodePath) {
              // 处理路径：episodePath 可能是绝对路径或相对路径
              let fullPath = episodePath;

              // 如果 episodePath 已经是完整路径（包含 data/videos），直接使用
              if (episodePath.includes('data/videos')) {
                // 已经是完整路径，直接使用
                fullPath = episodePath;
              } else if (!episodePath.startsWith('/')) {
                // 相对路径，需要拼接本地路径
                fullPath = `${localResourceData.metadata.local_path}/${episodePath}`;
              }

              // 确保路径格式正确（移除开头的 ./ 如果有）
              fullPath = fullPath.replace(/^\.\//, '');

              const localPlayUrl = `/api/local-video?path=${encodeURIComponent(
                fullPath
              )}`;

              console.log(
                `[PlayPage] ✓ 检测到本地资源已下载完成，切换到本地资源: ${currentSource}_${currentId}, 集数: ${episodeNumber}`
              );

              // 更新视频URL
              setVideoUrl(localPlayUrl);
              setIsUsingLocalResource(true);

              // 清理定时器
              if (localResourceCheckIntervalRef.current) {
                clearInterval(localResourceCheckIntervalRef.current);
                localResourceCheckIntervalRef.current = null;
              }
            }
          }
        }
      } catch (error) {
        console.warn('[PlayPage] 检查本地资源失败:', error);
      }
    }, 5000); // 每5秒检查一次

    // 清理函数
    return () => {
      if (localResourceCheckIntervalRef.current) {
        clearInterval(localResourceCheckIntervalRef.current);
        localResourceCheckIntervalRef.current = null;
      }
    };
  }, [
    isUsingLocalResource,
    currentSource,
    currentId,
    detail,
    currentEpisodeIndex,
  ]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 收藏相关
  // ---------------------------------------------------------------------------
  // 每当 source 或 id 变化时检查收藏状态
  useEffect(() => {
    if (!currentSource || !currentId) return;
    (async () => {
      try {
        const fav = await isFavorited(currentSource, currentId);
        setFavorited(fav);
      } catch (err) {
        console.error('检查收藏状态失败:', err);
      }
    })();
  }, [currentSource, currentId]);

  // 监听收藏数据更新事件
  useEffect(() => {
    if (!currentSource || !currentId) return;

    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (favorites: Record<string, any>) => {
        const key = generateStorageKey(currentSource, currentId);
        const isFav = !!favorites[key];
        setFavorited(isFav);
      }
    );

    return unsubscribe;
  }, [currentSource, currentId]);

  // 切换收藏
  const handleToggleFavorite = async () => {
    if (
      !videoTitleRef.current ||
      !detailRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current
    )
      return;

    try {
      if (favorited) {
        // 如果已收藏，删除收藏
        await deleteFavorite(currentSourceRef.current, currentIdRef.current);
        setFavorited(false);
      } else {
        // 如果未收藏，添加收藏
        await saveFavorite(currentSourceRef.current, currentIdRef.current, {
          title: videoTitleRef.current,
          source_name: detailRef.current?.source_name || '',
          year: detailRef.current?.year,
          cover: detailRef.current?.poster || '',
          total_episodes: detailRef.current?.episodes.length || 1,
          save_time: Date.now(),
          search_title: searchTitle,
        });
        setFavorited(true);
      }
    } catch (err) {
      console.error('切换收藏失败:', err);
    }
  };

  useEffect(() => {
    if (
      !Artplayer ||
      !Hls ||
      !videoUrl ||
      loading ||
      currentEpisodeIndex === null ||
      !artRef.current
    ) {
      return;
    }

    // 确保选集索引有效
    if (
      !detail ||
      !detail.episodes ||
      currentEpisodeIndex >= detail.episodes.length ||
      currentEpisodeIndex < 0
    ) {
      setError(`选集索引无效，当前共 ${totalEpisodes} 集`);
      return;
    }

    if (!videoUrl) {
      setError('视频地址无效');
      return;
    }
    console.log(videoUrl);

    // 检测是否为WebKit浏览器
    const isWebkit =
      typeof window !== 'undefined' &&
      typeof (window as any).webkitConvertPointFromNodeToPage === 'function';

    // 非WebKit浏览器且播放器已存在，使用switch方法切换
    if (!isWebkit && artPlayerRef.current) {
      artPlayerRef.current.switch = videoUrl;
      artPlayerRef.current.title = `${videoTitle} - 第${
        currentEpisodeIndex + 1
      }集`;
      artPlayerRef.current.poster = videoCover;
      if (artPlayerRef.current?.video) {
        ensureVideoSource(
          artPlayerRef.current.video as HTMLVideoElement,
          videoUrl
        );
      }
      return;
    }

    // WebKit浏览器或首次创建：销毁之前的播放器实例并创建新的
    if (artPlayerRef.current) {
      if (artPlayerRef.current.video && artPlayerRef.current.video.hls) {
        artPlayerRef.current.video.hls.destroy();
      }
      // 销毁播放器实例
      artPlayerRef.current.destroy();
      artPlayerRef.current = null;
    }

    try {
      // 创建新的播放器实例
      Artplayer.PLAYBACK_RATE = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
      Artplayer.USE_RAF = true;

      artPlayerRef.current = new Artplayer({
        container: artRef.current,
        url: videoUrl,
        poster: videoCover,
        volume: 0.7,
        isLive: false,
        muted: false,
        autoplay: true,
        pip: true,
        autoSize: false,
        autoMini: false,
        screenshot: false,
        setting: true,
        loop: false,
        flip: false,
        playbackRate: true,
        aspectRatio: false,
        fullscreen: true,
        fullscreenWeb: true,
        subtitleOffset: false,
        miniProgressBar: false,
        mutex: true,
        playsInline: true,
        autoPlayback: false,
        airplay: true,
        theme: '#22c55e',
        lang: 'zh-cn',
        hotkey: false,
        fastForward: true,
        autoOrientation: true,
        lock: true,
        moreVideoAttr: {
          crossOrigin: 'anonymous',
        },
        // HLS 支持配置
        customType: {
          m3u8: function (video: HTMLVideoElement, url: string) {
            if (!Hls) {
              console.error('HLS.js 未加载');
              return;
            }

            if (video.hls) {
              video.hls.destroy();
            }
            const hls = new Hls({
              debug: false, // 关闭日志
              enableWorker: true, // WebWorker 解码，降低主线程压力
              lowLatencyMode: true, // 开启低延迟 LL-HLS

              /* 缓冲/内存相关 */
              maxBufferLength: 30, // 前向缓冲最大 30s，过大容易导致高延迟
              backBufferLength: 30, // 仅保留 30s 已播放内容，避免内存占用
              maxBufferSize: 60 * 1000 * 1000, // 约 60MB，超出后触发清理

              /* 自定义loader */
              loader: blockAdEnabledRef.current
                ? CustomHlsJsLoader
                : Hls.DefaultConfig.loader,
            });

            hls.loadSource(url);
            hls.attachMedia(video);
            video.hls = hls;

            ensureVideoSource(video, url);

            hls.on(Hls.Events.ERROR, function (event: any, data: any) {
              console.error('HLS Error:', event, data);
              if (data.fatal) {
                switch (data.type) {
                  case Hls.ErrorTypes.NETWORK_ERROR:
                    console.log('网络错误，尝试恢复...');
                    hls.startLoad();
                    break;
                  case Hls.ErrorTypes.MEDIA_ERROR:
                    console.log('媒体错误，尝试恢复...');
                    hls.recoverMediaError();
                    break;
                  default:
                    console.log('无法恢复的错误');
                    hls.destroy();
                    break;
                }
              }
            });
          },
        },
        icons: {
          loading:
            '<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCIgdmlld0JveD0iMCAwIDUwIDUwIj48cGF0aCBkPSJNMjUuMjUxIDYuNDYxYy0xMC4zMTggMC0xOC42ODMgOC4zNjUtMTguNjgzIDE4LjY4M2g0LjA2OGMwLTguMDcgNi41NDUtMTQuNjE1IDE0LjYxNS0xNC42MTVWNi40NjF6IiBmaWxsPSIjMDA5Njg4Ij48YW5pbWF0ZVRyYW5zZm9ybSBhdHRyaWJ1dGVOYW1lPSJ0cmFuc2Zvcm0iIGF0dHJpYnV0ZVR5cGU9IlhNTCIgZHVyPSIxcyIgZnJvbT0iMCAyNSAyNSIgcmVwZWF0Q291bnQ9ImluZGVmaW5pdGUiIHRvPSIzNjAgMjUgMjUiIHR5cGU9InJvdGF0ZSIvPjwvcGF0aD48L3N2Zz4=">',
        },
        settings: [
          {
            html: '去广告',
            icon: '<text x="50%" y="50%" font-size="20" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#ffffff">AD</text>',
            tooltip: blockAdEnabled ? '已开启' : '已关闭',
            onClick() {
              const newVal = !blockAdEnabled;
              try {
                localStorage.setItem('enable_blockad', String(newVal));
                if (artPlayerRef.current) {
                  resumeTimeRef.current = artPlayerRef.current.currentTime;
                  if (
                    artPlayerRef.current.video &&
                    artPlayerRef.current.video.hls
                  ) {
                    artPlayerRef.current.video.hls.destroy();
                  }
                  artPlayerRef.current.destroy();
                  artPlayerRef.current = null;
                }
                setBlockAdEnabled(newVal);
              } catch (_) {
                // ignore
              }
              return newVal ? '当前开启' : '当前关闭';
            },
          },
          {
            name: '跳过片头片尾',
            html: '跳过片头片尾',
            switch: skipConfigRef.current.enable,
            onSwitch: function (item) {
              const newConfig = {
                ...skipConfigRef.current,
                enable: !item.switch,
              };
              handleSkipConfigChange(newConfig);
              return !item.switch;
            },
          },
          {
            html: '删除跳过配置',
            onClick: function () {
              handleSkipConfigChange({
                enable: false,
                intro_time: 0,
                outro_time: 0,
              });
              return '';
            },
          },
          {
            name: '设置片头',
            html: '设置片头',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L17 12" stroke="#ffffff" stroke-width="2"/><path d="M17 6L17 18" stroke="#ffffff" stroke-width="2"/></svg>',
            tooltip:
              skipConfigRef.current.intro_time === 0
                ? '设置片头时间'
                : `${formatTime(skipConfigRef.current.intro_time)}`,
            onClick: function () {
              const currentTime = artPlayerRef.current?.currentTime || 0;
              if (currentTime > 0) {
                const newConfig = {
                  ...skipConfigRef.current,
                  intro_time: currentTime,
                };
                handleSkipConfigChange(newConfig);
                return `${formatTime(currentTime)}`;
              }
            },
          },
          {
            name: '设置片尾',
            html: '设置片尾',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 6L7 18" stroke="#ffffff" stroke-width="2"/><path d="M7 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
            tooltip:
              skipConfigRef.current.outro_time >= 0
                ? '设置片尾时间'
                : `-${formatTime(-skipConfigRef.current.outro_time)}`,
            onClick: function () {
              const outroTime =
                -(
                  artPlayerRef.current?.duration -
                  artPlayerRef.current?.currentTime
                ) || 0;
              if (outroTime < 0) {
                const newConfig = {
                  ...skipConfigRef.current,
                  outro_time: outroTime,
                };
                handleSkipConfigChange(newConfig);
                return `-${formatTime(-outroTime)}`;
              }
            },
          },
        ],
        // 控制栏配置
        controls: [
          {
            position: 'left',
            index: 13,
            html: '<i class="art-icon flex"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" fill="currentColor"/></svg></i>',
            tooltip: '播放下一集',
            click: function () {
              handleNextEpisode();
            },
          },
        ],
      });

      // 监听播放器事件
      artPlayerRef.current.on('ready', () => {
        setError(null);
      });

      artPlayerRef.current.on('video:volumechange', () => {
        lastVolumeRef.current = artPlayerRef.current.volume;
      });
      artPlayerRef.current.on('video:ratechange', () => {
        lastPlaybackRateRef.current = artPlayerRef.current.playbackRate;
      });

      // 监听视频可播放事件，这时恢复播放进度更可靠
      artPlayerRef.current.on('video:canplay', () => {
        // 若存在需要恢复的播放进度，则跳转
        if (resumeTimeRef.current && resumeTimeRef.current > 0) {
          try {
            const duration = artPlayerRef.current.duration || 0;
            let target = resumeTimeRef.current;
            if (duration && target >= duration - 2) {
              target = Math.max(0, duration - 5);
            }
            artPlayerRef.current.currentTime = target;
            console.log('成功恢复播放进度到:', resumeTimeRef.current);
          } catch (err) {
            console.warn('恢复播放进度失败:', err);
          }
        }
        resumeTimeRef.current = null;

        setTimeout(() => {
          if (
            Math.abs(artPlayerRef.current.volume - lastVolumeRef.current) > 0.01
          ) {
            artPlayerRef.current.volume = lastVolumeRef.current;
          }
          if (
            Math.abs(
              artPlayerRef.current.playbackRate - lastPlaybackRateRef.current
            ) > 0.01 &&
            isWebkit
          ) {
            artPlayerRef.current.playbackRate = lastPlaybackRateRef.current;
          }
          artPlayerRef.current.notice.show = '';
        }, 0);

        // 隐藏换源加载状态
        setIsVideoLoading(false);
      });

      // 监听视频时间更新事件，实现跳过片头片尾
      artPlayerRef.current.on('video:timeupdate', () => {
        if (!skipConfigRef.current.enable) return;

        const currentTime = artPlayerRef.current.currentTime || 0;
        const duration = artPlayerRef.current.duration || 0;
        const now = Date.now();

        // 限制跳过检查频率为1.5秒一次
        if (now - lastSkipCheckRef.current < 1500) return;
        lastSkipCheckRef.current = now;

        // 跳过片头
        if (
          skipConfigRef.current.intro_time > 0 &&
          currentTime < skipConfigRef.current.intro_time
        ) {
          artPlayerRef.current.currentTime = skipConfigRef.current.intro_time;
          artPlayerRef.current.notice.show = `已跳过片头 (${formatTime(
            skipConfigRef.current.intro_time
          )})`;
        }

        // 跳过片尾
        if (
          skipConfigRef.current.outro_time < 0 &&
          duration > 0 &&
          currentTime >
            artPlayerRef.current.duration + skipConfigRef.current.outro_time
        ) {
          if (
            currentEpisodeIndexRef.current <
            (detailRef.current?.episodes?.length || 1) - 1
          ) {
            handleNextEpisode();
          } else {
            artPlayerRef.current.pause();
          }
          artPlayerRef.current.notice.show = `已跳过片尾 (${formatTime(
            skipConfigRef.current.outro_time
          )})`;
        }
      });

      artPlayerRef.current.on('error', (err: any) => {
        console.error('播放器错误:', err);
        if (artPlayerRef.current.currentTime > 0) {
          return;
        }
      });

      // 监听视频播放结束事件，自动播放下一集
      artPlayerRef.current.on('video:ended', () => {
        const d = detailRef.current;
        const idx = currentEpisodeIndexRef.current;
        if (d && d.episodes && idx < d.episodes.length - 1) {
          setTimeout(() => {
            setCurrentEpisodeIndex(idx + 1);
          }, 1000);
        }
      });

      artPlayerRef.current.on('video:timeupdate', () => {
        const now = Date.now();
        let interval = 5000;
        if (process.env.NEXT_PUBLIC_STORAGE_TYPE === 'd1') {
          interval = 10000;
        }
        if (process.env.NEXT_PUBLIC_STORAGE_TYPE === 'upstash') {
          interval = 20000;
        }
        if (now - lastSaveTimeRef.current > interval) {
          saveCurrentPlayProgress();
          lastSaveTimeRef.current = now;
        }
      });

      artPlayerRef.current.on('pause', () => {
        saveCurrentPlayProgress();
      });

      if (artPlayerRef.current?.video) {
        ensureVideoSource(
          artPlayerRef.current.video as HTMLVideoElement,
          videoUrl
        );
      }
    } catch (err) {
      console.error('创建播放器失败:', err);
      setError('播放器初始化失败');
    }
  }, [Artplayer, Hls, videoUrl, loading, blockAdEnabled]);

  // 当组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }
    };
  }, []);

  if (loading) {
    return (
      <PageLayout activePath='/play'>
        <div className='flex items-center justify-center min-h-screen bg-transparent'>
          <div className='text-center max-w-md mx-auto px-6'>
            {/* 动画影院图标 */}
            <div className='relative mb-8'>
              <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                <div className='text-white text-4xl'>
                  {loadingStage === 'searching' && '🔍'}
                  {loadingStage === 'preferring' && '⚡'}
                  {loadingStage === 'fetching' && '🎬'}
                  {loadingStage === 'ready' && '✨'}
                </div>
                {/* 旋转光环 */}
                <div className='absolute -inset-2 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl opacity-20 animate-spin'></div>
              </div>

              {/* 浮动粒子效果 */}
              <div className='absolute top-0 left-0 w-full h-full pointer-events-none'>
                <div className='absolute top-2 left-2 w-2 h-2 bg-green-400 rounded-full animate-bounce'></div>
                <div
                  className='absolute top-4 right-4 w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce'
                  style={{ animationDelay: '0.5s' }}
                ></div>
                <div
                  className='absolute bottom-3 left-6 w-1 h-1 bg-lime-400 rounded-full animate-bounce'
                  style={{ animationDelay: '1s' }}
                ></div>
              </div>
            </div>

            {/* 进度指示器 */}
            <div className='mb-6 w-80 mx-auto'>
              <div className='flex justify-center space-x-2 mb-4'>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${
                    loadingStage === 'searching' || loadingStage === 'fetching'
                      ? 'bg-green-500 scale-125'
                      : loadingStage === 'preferring' ||
                        loadingStage === 'ready'
                      ? 'bg-green-500'
                      : 'bg-gray-300'
                  }`}
                ></div>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${
                    loadingStage === 'preferring'
                      ? 'bg-green-500 scale-125'
                      : loadingStage === 'ready'
                      ? 'bg-green-500'
                      : 'bg-gray-300'
                  }`}
                ></div>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${
                    loadingStage === 'ready'
                      ? 'bg-green-500 scale-125'
                      : 'bg-gray-300'
                  }`}
                ></div>
              </div>

              {/* 进度条 */}
              <div className='w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden'>
                <div
                  className='h-full bg-gradient-to-r from-green-500 to-emerald-600 rounded-full transition-all duration-1000 ease-out'
                  style={{
                    width:
                      loadingStage === 'searching' ||
                      loadingStage === 'fetching'
                        ? '33%'
                        : loadingStage === 'preferring'
                        ? '66%'
                        : '100%',
                  }}
                ></div>
              </div>
            </div>

            {/* 加载消息 */}
            <div className='space-y-2'>
              <p className='text-xl font-semibold text-gray-800 dark:text-gray-200 animate-pulse'>
                {loadingMessage}
              </p>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout activePath='/play'>
        <div className='flex items-center justify-center min-h-screen bg-transparent'>
          <div className='text-center max-w-md mx-auto px-6'>
            {/* 错误图标 */}
            <div className='relative mb-8'>
              <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-red-500 to-orange-500 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                <div className='text-white text-4xl'>😵</div>
                {/* 脉冲效果 */}
                <div className='absolute -inset-2 bg-gradient-to-r from-red-500 to-orange-500 rounded-2xl opacity-20 animate-pulse'></div>
              </div>

              {/* 浮动错误粒子 */}
              <div className='absolute top-0 left-0 w-full h-full pointer-events-none'>
                <div className='absolute top-2 left-2 w-2 h-2 bg-red-400 rounded-full animate-bounce'></div>
                <div
                  className='absolute top-4 right-4 w-1.5 h-1.5 bg-orange-400 rounded-full animate-bounce'
                  style={{ animationDelay: '0.5s' }}
                ></div>
                <div
                  className='absolute bottom-3 left-6 w-1 h-1 bg-yellow-400 rounded-full animate-bounce'
                  style={{ animationDelay: '1s' }}
                ></div>
              </div>
            </div>

            {/* 错误信息 */}
            <div className='space-y-4 mb-8'>
              <h2 className='text-2xl font-bold text-gray-800 dark:text-gray-200'>
                哎呀，出现了一些问题
              </h2>
              <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4'>
                <p className='text-red-600 dark:text-red-400 font-medium'>
                  {error}
                </p>
              </div>
              <p className='text-sm text-gray-500 dark:text-gray-400'>
                请检查网络连接或尝试刷新页面
              </p>
            </div>

            {/* 操作按钮 */}
            <div className='space-y-3'>
              <button
                onClick={() =>
                  videoTitle
                    ? router.push(`/search?q=${encodeURIComponent(videoTitle)}`)
                    : router.back()
                }
                className='w-full px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-medium hover:from-green-600 hover:to-emerald-700 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl'
              >
                {videoTitle ? '🔍 返回搜索' : '← 返回上页'}
              </button>

              <button
                onClick={() => window.location.reload()}
                className='w-full px-6 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors duration-200'
              >
                🔄 重新尝试
              </button>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout activePath='/play'>
      <div className='flex flex-col gap-3 py-4 px-5 lg:px-[3rem] 2xl:px-20'>
        {/* 第一行：影片标题 */}
        <div className='py-1'>
          <h1 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
            {videoTitle || '影片标题'}
            {totalEpisodes > 1 && (
              <span className='text-gray-500 dark:text-gray-400'>
                {` > 第 ${currentEpisodeIndex + 1} 集`}
              </span>
            )}
          </h1>
        </div>
        {/* 第二行：播放器和选集 */}
        <div className='space-y-2'>
          {/* 折叠控制 - 仅在 lg 及以上屏幕显示 */}
          <div className='hidden lg:flex justify-end'>
            <button
              onClick={() =>
                setIsEpisodeSelectorCollapsed(!isEpisodeSelectorCollapsed)
              }
              className='group relative flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-white/80 hover:bg-white dark:bg-gray-800/80 dark:hover:bg-gray-800 backdrop-blur-sm border border-gray-200/50 dark:border-gray-700/50 shadow-sm hover:shadow-md transition-all duration-200'
              title={
                isEpisodeSelectorCollapsed ? '显示选集面板' : '隐藏选集面板'
              }
            >
              <svg
                className={`w-3.5 h-3.5 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${
                  isEpisodeSelectorCollapsed ? 'rotate-180' : 'rotate-0'
                }`}
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth='2'
                  d='M9 5l7 7-7 7'
                />
              </svg>
              <span className='text-xs font-medium text-gray-600 dark:text-gray-300'>
                {isEpisodeSelectorCollapsed ? '显示' : '隐藏'}
              </span>

              {/* 精致的状态指示点 */}
              <div
                className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full transition-all duration-200 ${
                  isEpisodeSelectorCollapsed
                    ? 'bg-orange-400 animate-pulse'
                    : 'bg-green-400'
                }`}
              ></div>
            </button>
          </div>

          <div
            className={`grid gap-4 lg:h-[500px] xl:h-[650px] 2xl:h-[750px] transition-all duration-300 ease-in-out ${
              isEpisodeSelectorCollapsed
                ? 'grid-cols-1'
                : 'grid-cols-1 md:grid-cols-4'
            }`}
          >
            {/* 播放器 */}
            <div
              className={`h-full transition-all duration-300 ease-in-out rounded-xl border border-white/0 dark:border-white/30 ${
                isEpisodeSelectorCollapsed ? 'col-span-1' : 'md:col-span-3'
              }`}
            >
              <div className='relative w-full h-[300px] lg:h-full'>
                <div
                  ref={artRef}
                  className='bg-black w-full h-full rounded-xl overflow-hidden shadow-lg'
                ></div>

                {/* 换源加载蒙层 */}
                {isVideoLoading && (
                  <div className='absolute inset-0 bg-black/85 backdrop-blur-sm rounded-xl flex items-center justify-center z-[500] transition-all duration-300'>
                    <div className='text-center max-w-md mx-auto px-6'>
                      {/* 动画影院图标 */}
                      <div className='relative mb-8'>
                        <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                          <div className='text-white text-4xl'>🎬</div>
                          {/* 旋转光环 */}
                          <div className='absolute -inset-2 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl opacity-20 animate-spin'></div>
                        </div>

                        {/* 浮动粒子效果 */}
                        <div className='absolute top-0 left-0 w-full h-full pointer-events-none'>
                          <div className='absolute top-2 left-2 w-2 h-2 bg-green-400 rounded-full animate-bounce'></div>
                          <div
                            className='absolute top-4 right-4 w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce'
                            style={{ animationDelay: '0.5s' }}
                          ></div>
                          <div
                            className='absolute bottom-3 left-6 w-1 h-1 bg-lime-400 rounded-full animate-bounce'
                            style={{ animationDelay: '1s' }}
                          ></div>
                        </div>
                      </div>

                      {/* 换源消息 */}
                      <div className='space-y-2'>
                        <p className='text-xl font-semibold text-white animate-pulse'>
                          {decrypting
                            ? '🔐 正在解析视频...'
                            : videoLoadingStage === 'sourceChanging'
                            ? '🔄 切换播放源...'
                            : '🔄 视频加载中...'}
                        </p>
                        {decryptError && (
                          <div className='mt-4 p-4 bg-red-500/20 border border-red-500/50 rounded-lg'>
                            <p className='text-red-200 text-sm mb-2'>
                              {decryptError}
                            </p>
                            <div className='flex gap-2 justify-center'>
                              <button
                                onClick={() => {
                                  setDecryptError(null);
                                  updateVideoUrl(detail, currentEpisodeIndex);
                                }}
                                className='px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm transition-colors'
                              >
                                重试
                              </button>
                              {availableSources.length > 1 && (
                                <button
                                  onClick={() => {
                                    setDecryptError(null);
                                    // 切换到下一个可用源
                                    const currentIndex =
                                      availableSources.findIndex(
                                        (s) =>
                                          s.source === detail?.source &&
                                          s.id === detail?.id
                                      );
                                    if (
                                      currentIndex >= 0 &&
                                      currentIndex < availableSources.length - 1
                                    ) {
                                      const nextSource =
                                        availableSources[currentIndex + 1];
                                      handleSourceChange(
                                        nextSource.source,
                                        nextSource.id,
                                        nextSource.title
                                      );
                                    }
                                  }}
                                  className='px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm transition-colors'
                                >
                                  切换其他源
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 选集和换源 - 在移动端始终显示，在 lg 及以上可折叠 */}
            <div
              className={`h-[300px] lg:h-full md:overflow-hidden transition-all duration-300 ease-in-out ${
                isEpisodeSelectorCollapsed
                  ? 'md:col-span-1 lg:hidden lg:opacity-0 lg:scale-95'
                  : 'md:col-span-1 lg:opacity-100 lg:scale-100'
              }`}
            >
              <EpisodeSelector
                totalEpisodes={totalEpisodes}
                value={currentEpisodeIndex + 1}
                onChange={handleEpisodeChange}
                onSourceChange={handleSourceChange}
                currentSource={currentSource}
                currentId={currentId}
                videoTitle={searchTitle || videoTitle}
                availableSources={availableSources}
                sourceSearchLoading={sourceSearchLoading}
                sourceSearchError={sourceSearchError}
                precomputedVideoInfo={precomputedVideoInfo}
              />
            </div>
          </div>
        </div>

        {/* 详情展示 */}
        <div className='grid grid-cols-1 md:grid-cols-4 gap-4'>
          {/* 文字区 */}
          <div className='md:col-span-3'>
            <div className='p-6 flex flex-col min-h-0'>
              {/* 标题 */}
              <h1 className='text-3xl font-bold mb-2 tracking-wide flex items-center flex-shrink-0 text-center md:text-left w-full'>
                {videoTitle || '影片标题'}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleFavorite();
                  }}
                  className='ml-3 flex-shrink-0 hover:opacity-80 transition-opacity'
                >
                  <FavoriteIcon filled={favorited} />
                </button>
              </h1>

              {/* 关键信息行 */}
              <div className='flex flex-wrap items-center gap-3 text-base mb-4 opacity-80 flex-shrink-0'>
                {detail?.class && (
                  <span className='text-green-600 font-semibold'>
                    {detail.class}
                  </span>
                )}
                {(detail?.year || videoYear) && (
                  <span>{detail?.year || videoYear}</span>
                )}
                {detail?.source_name && (
                  <span className='border border-gray-500/60 px-2 py-[1px] rounded'>
                    {detail.source_name}
                  </span>
                )}
                {detail?.type_name && <span>{detail.type_name}</span>}
              </div>
              {/* 剧情简介 */}
              {detail?.desc && (
                <div
                  className='mt-0 text-base leading-relaxed opacity-90 overflow-y-auto pr-2 flex-1 min-h-0 scrollbar-hide'
                  style={{ whiteSpace: 'pre-line' }}
                >
                  {detail.desc}
                </div>
              )}
            </div>
          </div>

          {/* 封面展示 */}
          <div className='hidden md:block md:col-span-1 md:order-first'>
            <div className='pl-0 py-4 pr-6'>
              <div className='bg-gray-300 dark:bg-gray-700 aspect-[2/3] flex items-center justify-center rounded-xl overflow-hidden'>
                {videoCover ? (
                  <img
                    src={processImageUrl(videoCover)}
                    alt={videoTitle}
                    className='w-full h-full object-cover'
                  />
                ) : (
                  <span className='text-gray-600 dark:text-gray-400'>
                    封面图片
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

// FavoriteIcon 组件
const FavoriteIcon = ({ filled }: { filled: boolean }) => {
  if (filled) {
    return (
      <svg
        className='h-7 w-7'
        viewBox='0 0 24 24'
        xmlns='http://www.w3.org/2000/svg'
      >
        <path
          d='M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'
          fill='#ef4444' /* Tailwind red-500 */
          stroke='#ef4444'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </svg>
    );
  }
  return (
    <Heart className='h-7 w-7 stroke-[1] text-gray-600 dark:text-gray-300' />
  );
};

export default function PlayPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PlayPageClient />
    </Suspense>
  );
}
