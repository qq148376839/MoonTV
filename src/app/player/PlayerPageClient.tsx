/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console */

'use client';

import Artplayer from 'artplayer';
import Hls from 'hls.js';
import { useSearchParams } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  convertToProxyM3u8UrlIfNeeded,
  parseProxyFlag,
} from '@/lib/video-proxy';

import PageLayout from '@/components/PageLayout';

// 扩展 HTMLVideoElement 类型以支持 hls 属性
declare global {
  interface HTMLVideoElement {
    hls?: any;
  }
}

export default function PlayerPageClient() {
  const searchParams = useSearchParams();
  const artRef = useRef<HTMLDivElement>(null);
  const artPlayerRef = useRef<Artplayer | null>(null);

  const [videoUrl, setVideoUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [_retryCount, setRetryCount] = useState(0);
  const [containerReady, setContainerReady] = useState(false);

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

  // 从URL参数获取视频地址
  useEffect(() => {
    // 获取完整的URL参数（包括可能被分割的部分）
    const urlParam = searchParams.get('url');
    const proxyParam = searchParams.get('proxy');
    if (!urlParam) {
      setError('请提供视频地址（使用 url 参数）');
      setLoading(false);
      return;
    }

    try {
      // 解码URL参数
      let decodedUrl = decodeURIComponent(urlParam);

      // 检查URL是否完整（如果URL包含查询参数但被截断，尝试从当前页面URL中恢复）
      // 如果decodedUrl以&结尾或包含不完整的查询参数，尝试从window.location恢复
      if (typeof window !== 'undefined') {
        const currentUrl = new URL(window.location.href);
        const urlParamIndex = currentUrl.search.indexOf('url=');
        if (urlParamIndex !== -1) {
          // 提取url=之后的所有内容（包括后续的参数）
          const urlPart = currentUrl.search.substring(urlParamIndex + 4);
          // 如果原始参数不完整，尝试使用完整部分
          if (urlPart && urlPart.length > decodedUrl.length) {
            try {
              const fullDecoded = decodeURIComponent(urlPart);
              // 验证是否是有效的URL
              new URL(fullDecoded);
              decodedUrl = fullDecoded;
              console.log('从完整URL参数恢复:', decodedUrl);
            } catch {
              // 如果恢复失败，使用原始值
            }
          }
        }
      }

      console.log('解析到的视频URL:', decodedUrl);

      // 验证URL格式
      try {
        new URL(decodedUrl);
      } catch (urlError) {
        console.error('URL格式验证失败:', urlError);
        setError(
          '视频地址格式无效，请检查URL是否正确。提示：如果URL包含多个查询参数，请使用 encodeURIComponent 完整编码'
        );
        setLoading(false);
        return;
      }

      // 默认启用同源代理以解决 CORS；允许通过 proxy=0 直连用于排查
      const proxyFlag = parseProxyFlag(proxyParam);
      const proxyEnabled = proxyFlag !== false;

      // /player 的去广告逻辑仍在前端（CustomHlsJsLoader），所以 clean 默认关闭，避免服务端误清理
      const finalUrl = convertToProxyM3u8UrlIfNeeded(decodedUrl, {
        proxyEnabled,
        clean: false,
      });

      if (!proxyEnabled) {
        console.log(
          '[Player] proxy=0，使用直连播放地址:',
          decodedUrl.substring(0, 100)
        );
      } else if (finalUrl !== decodedUrl) {
        console.log(
          '[Player] 使用同源代理解决CORS问题:',
          decodedUrl.substring(0, 100)
        );
      }

      setVideoUrl(finalUrl);
      setError(null);
      setLoading(true); // 开始加载
    } catch (err) {
      console.error('URL解析错误:', err);
      setError(
        '视频地址格式错误: ' + (err instanceof Error ? err.message : String(err))
      );
      setLoading(false);
    }
  }, [searchParams]);

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

  // 自定义HLS.js Loader（用于去广告）
  class CustomHlsJsLoader extends Hls.DefaultConfig.loader {
    constructor(config: any) {
      super(config);
      const load = this.load.bind(this);
      this.load = function (context: any, config: any, callbacks: any) {
        // 拦截manifest和level请求
        if ((context as any).type === 'manifest' || (context as any).type === 'level') {
          const onSuccess = callbacks.onSuccess;
          callbacks.onSuccess = function (
            response: any,
            stats: any,
            context: any
          ) {
            // 如果是m3u8文件，处理内容以移除广告分段
            if (response.data && typeof response.data === 'string') {
              // 过滤掉广告段
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

  // 确保视频源正确设置
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

  // 监听容器挂载状态（使用 useLayoutEffect 确保在 DOM 更新后立即检查）
  useLayoutEffect(() => {
    if (artRef.current && !containerReady) {
      console.log('播放器容器已挂载，节点:', artRef.current);
      setContainerReady(true);
    }
  });

  // 初始化播放器
  useEffect(() => {
    console.log('播放器初始化检查:', {
      Artplayer: !!Artplayer,
      Hls: !!Hls,
      videoUrl,
      artRef: !!artRef.current,
      containerReady,
    });

    // 检查所有必要条件
    if (!Artplayer || !Hls || !videoUrl) {
      console.log('播放器初始化条件不满足（库或URL缺失），跳过');
      return;
    }

    // 如果容器还没准备好，等待一下
    if (!artRef.current) {
      console.log('播放器容器未准备好，等待...');
      // 使用requestAnimationFrame确保DOM已渲染
      const timer = requestAnimationFrame(() => {
        if (artRef.current) {
          console.log('容器已准备好，重新检查');
          setContainerReady(true);
        }
      });
      return () => cancelAnimationFrame(timer);
    }

    if (!containerReady) {
      console.log('容器状态未更新，设置containerReady');
      setContainerReady(true);
      return;
    }

    console.log('开始初始化播放器，视频URL:', videoUrl);

    // 检测是否为WebKit浏览器
    const isWebkit =
      typeof window !== 'undefined' &&
      typeof (window as any).webkitConvertPointFromNodeToPage === 'function';

    // 非WebKit浏览器且播放器已存在，使用switch方法切换
    if (!isWebkit && artPlayerRef.current) {
      artPlayerRef.current.switch = videoUrl;
      if (artPlayerRef.current?.video) {
        ensureVideoSource(artPlayerRef.current.video as HTMLVideoElement, videoUrl);
      }
      return;
    }

    // WebKit浏览器或首次创建：销毁之前的播放器实例并创建新的
    if (artPlayerRef.current) {
      if (artPlayerRef.current.video && artPlayerRef.current.video.hls) {
        artPlayerRef.current.video.hls.destroy();
      }
      artPlayerRef.current.destroy();
      artPlayerRef.current = null;
    }

    try {
      setLoading(true);
      setError(null);

      // 创建新的播放器实例
      Artplayer.PLAYBACK_RATE = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
      Artplayer.USE_RAF = true;

      artPlayerRef.current = new Artplayer({
        container: artRef.current,
        url: videoUrl,
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
              setError('HLS.js 未加载，无法播放视频');
              setLoading(false);
              return;
            }

            if (video.hls) {
              video.hls.destroy();
            }
            const hls = new Hls({
              debug: false,
              enableWorker: true,
              lowLatencyMode: true,
              maxBufferLength: 30,
              backBufferLength: 30,
              maxBufferSize: 60 * 1000 * 1000,
              loader: blockAdEnabledRef.current
                ? CustomHlsJsLoader
                : Hls.DefaultConfig.loader,
            });

            console.log('HLS加载视频源:', url);
            hls.loadSource(url);
            hls.attachMedia(video);
            video.hls = hls;

            ensureVideoSource(video, url);

            // 监听HLS加载完成事件
            hls.on(Hls.Events.MANIFEST_PARSED, function () {
              console.log('HLS清单解析完成，可以播放');
            });

            hls.on(Hls.Events.ERROR, function (event: any, data: any) {
              console.error('HLS Error:', event, data);
              if (data.fatal) {
                switch (data.type) {
                  case Hls.ErrorTypes.NETWORK_ERROR:
                    console.log('网络错误，尝试恢复...');
                    try {
                      hls.startLoad();
                    } catch (e) {
                      console.error('恢复失败:', e);
                      setError('网络错误，无法加载视频');
                      setLoading(false);
                    }
                    break;
                  case Hls.ErrorTypes.MEDIA_ERROR:
                    console.log('媒体错误，尝试恢复...');
                    try {
                      hls.recoverMediaError();
                    } catch (e) {
                      console.error('恢复失败:', e);
                      setError('媒体错误，无法播放视频');
                      setLoading(false);
                    }
                    break;
                  default:
                    console.log('无法恢复的错误:', data.type);
                    setError(`视频播放失败: ${data.details || '未知错误'}`);
                    setLoading(false);
                    hls.destroy();
                    break;
                }
              } else {
                // 非致命错误，只记录日志
                console.warn('HLS非致命错误:', data);
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
                  if (artPlayerRef.current.video && artPlayerRef.current.video.hls) {
                    artPlayerRef.current.video.hls.destroy();
                  }
                  artPlayerRef.current.destroy();
                  artPlayerRef.current = null;
                }
                setBlockAdEnabled(newVal);
                // 重新设置视频URL以触发重新加载
                setVideoUrl((prev) => prev);
              } catch (_) {
                // ignore
              }
              return newVal ? '当前开启' : '当前关闭';
            },
          },
        ],
      });

      // 监听视频可播放事件
      artPlayerRef.current.on('video:canplay', () => {
        console.log('视频可以播放');
        setLoading(false);
        setError(null);
      });

      // 监听视频加载开始
      artPlayerRef.current.on('video:loadstart' as any, () => {
        console.log('视频开始加载');
        setLoading(true);
      });

      // 监听播放器错误
      artPlayerRef.current.on('error', (err: any) => {
        console.error('播放器错误:', err);
        setError('播放器初始化失败，请重试');
        setLoading(false);
      });

      // 监听视频加载错误
      artPlayerRef.current.on('video:error', (err: any) => {
        console.error('视频加载错误:', err);
        const video = artPlayerRef.current?.video as HTMLVideoElement;
        if (video?.error) {
          const errorCode = video.error.code;
          const errorMessage = video.error.message;
          console.error('视频错误详情:', {
            code: errorCode,
            message: errorMessage,
          });
          let errorMsg = '视频加载失败';
          switch (errorCode) {
            case 1:
              errorMsg = '视频加载中断';
              break;
            case 2:
              errorMsg = '网络错误，无法加载视频';
              break;
            case 3:
              errorMsg = '视频解码错误';
              break;
            case 4:
              errorMsg = '视频格式不支持或地址无效';
              break;
          }
          setError(errorMsg);
        } else {
          setError('视频加载失败，请检查视频地址是否正确');
        }
        setLoading(false);
      });

      if (artPlayerRef.current?.video) {
        ensureVideoSource(artPlayerRef.current.video as HTMLVideoElement, videoUrl);
      }
    } catch (err) {
      console.error('创建播放器失败:', err);
      setError('播放器初始化失败，请重试');
      setLoading(false);
    }
  }, [videoUrl, blockAdEnabled, containerReady]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (artPlayerRef.current) {
        if (artPlayerRef.current.video && artPlayerRef.current.video.hls) {
          artPlayerRef.current.video.hls.destroy();
        }
        artPlayerRef.current.destroy();
        artPlayerRef.current = null;
      }
    };
  }, []);

  // 重试功能
  const handleRetry = () => {
    setRetryCount((prev) => prev + 1);
    setError(null);
    setLoading(true);

    // 销毁当前播放器
    if (artPlayerRef.current) {
      if (artPlayerRef.current.video && artPlayerRef.current.video.hls) {
        artPlayerRef.current.video.hls.destroy();
      }
      artPlayerRef.current.destroy();
      artPlayerRef.current = null;
    }

    // 重新设置视频URL以触发重新加载（添加时间戳避免缓存）
    if (videoUrl) {
      const separator = videoUrl.includes('?') ? '&' : '?';
      setVideoUrl(videoUrl.split('?')[0].split('&')[0] + separator + '_retry=' + Date.now());
    }
  };

  // 播放器界面（始终渲染容器，根据状态显示不同内容）
  return (
    <PageLayout activePath='/player'>
      <div className='w-full min-h-screen bg-transparent'>
        {/* 播放器容器 - 始终渲染以确保ref可用 */}
        <div className='w-full max-w-7xl mx-auto px-4 py-6 relative'>
          {/* 播放器容器 - 始终渲染但可能隐藏 */}
          <div
            ref={artRef}
            className='w-full aspect-video bg-black rounded-lg overflow-hidden shadow-2xl'
            style={{
              maxHeight: 'calc(100vh - 8rem)',
              visibility: error || (loading && !videoUrl) ? 'hidden' : 'visible',
              position: error || (loading && !videoUrl) ? 'absolute' : 'relative',
            }}
          ></div>

          {/* 加载状态覆盖层 */}
          {loading && !error && videoUrl && (
            <div className='absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 rounded-lg z-10'>
              <div className='text-center'>
                <div className='relative mb-4'>
                  <div className='relative mx-auto w-16 h-16 bg-gradient-to-r from-green-500 to-emerald-600 rounded-xl shadow-xl flex items-center justify-center'>
                    <div className='text-white text-2xl'>🎬</div>
                    <div className='absolute -inset-1 bg-gradient-to-r from-green-500 to-emerald-600 rounded-xl opacity-20 animate-spin'></div>
                  </div>
                </div>
                <p className='text-white text-sm'>正在加载视频...</p>
              </div>
            </div>
          )}

          {/* 错误状态 */}
          {error && (
            <div className='flex items-center justify-center min-h-[400px] bg-transparent'>
              <div className='text-center max-w-md mx-auto px-6'>
                {/* 错误图标 */}
                <div className='relative mb-8'>
                  <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-red-500 to-rose-600 rounded-2xl shadow-2xl flex items-center justify-center'>
                    <div className='text-white text-4xl'>⚠️</div>
                  </div>
                </div>

                {/* 错误提示 */}
                <h2 className='text-xl font-semibold text-gray-800 dark:text-gray-200 mb-2'>
                  播放失败
                </h2>
                <p className='text-gray-600 dark:text-gray-400 mb-6'>{error}</p>

                {/* 重试按钮 */}
                <button
                  onClick={handleRetry}
                  className='px-6 py-3 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition-colors duration-200'
                >
                  重试
                </button>
              </div>
            </div>
          )}

          {/* 初始加载状态（没有URL时） */}
          {loading && !videoUrl && !error && (
            <div className='flex items-center justify-center min-h-[400px] bg-transparent'>
              <div className='text-center max-w-md mx-auto px-6'>
                {/* 加载动画 */}
                <div className='relative mb-8'>
                  <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                    <div className='text-white text-4xl'>🎬</div>
                    {/* 旋转光环 */}
                    <div className='absolute -inset-2 bg-gradient-to-r from-green-500 to-emerald-600 rounded-2xl opacity-20 animate-spin'></div>
                  </div>
                </div>

                {/* 加载提示 */}
                <h2 className='text-xl font-semibold text-gray-800 dark:text-gray-200 mb-2'>
                  正在加载视频...
                </h2>
                <p className='text-gray-600 dark:text-gray-400'>请稍候，视频正在准备中</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

