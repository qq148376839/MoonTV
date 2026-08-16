import fs from 'fs';
import path from 'path';

export interface EpisodeGenerationPaths {
  generationId: string;
  rootDir: string;
  segmentsDir: string;
  keysDir: string;
  mapsDir: string;
  playlistPath: string;
  rawPlaylistPath: string;
  cleanedPlaylistPath: string;
  reportPath: string;
  relativePrefix: string;
}

export interface PlaylistValidationResult {
  references: number;
  files: string[];
}

export function redactDownloadUrl(value: string): string {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return value.split(/[?#]/, 1)[0];
  }
}

export function redactUrlsInText(value: string): string {
  return value.replace(/https?:\/\/[^\s"'<>]+/gi, (url) =>
    redactDownloadUrl(url)
  );
}

export function createEpisodeGeneration(
  resourceDir: string,
  episodeIndex: number,
  generationId: string
): EpisodeGenerationPaths {
  const epNo = String(episodeIndex).padStart(2, '0');
  const relativePrefix = `episode_${epNo}_generations/${generationId}`;
  const rootDir = path.join(resourceDir, relativePrefix);
  const segmentsDir = path.join(rootDir, 'segments');
  const keysDir = path.join(rootDir, 'keys');
  const mapsDir = path.join(rootDir, 'maps');
  fs.mkdirSync(segmentsDir, { recursive: true });
  fs.mkdirSync(keysDir, { recursive: true });
  fs.mkdirSync(mapsDir, { recursive: true });

  return {
    generationId,
    rootDir,
    segmentsDir,
    keysDir,
    mapsDir,
    playlistPath: path.join(rootDir, 'playlist.m3u8'),
    rawPlaylistPath: path.join(rootDir, 'source.raw.m3u8'),
    cleanedPlaylistPath: path.join(rootDir, 'source.cleaned.m3u8'),
    reportPath: path.join(rootDir, 'report.json'),
    relativePrefix,
  };
}

function extractLocalReferences(content: string): string[] {
  const references: string[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith('#')) {
      if (!/^https?:\/\//i.test(trimmed)) references.push(trimmed);
      continue;
    }
    if (trimmed.startsWith('#EXT-X-KEY') || trimmed.startsWith('#EXT-X-MAP')) {
      const match = trimmed.match(/URI="([^"]+)"/);
      if (match && !/^https?:\/\//i.test(match[1])) references.push(match[1]);
    }
  }
  return references;
}

export function validateLocalPlaylist(
  playlistPath: string,
  baseDir = path.dirname(playlistPath)
): PlaylistValidationResult {
  const content = fs.readFileSync(playlistPath, 'utf-8');
  const references = extractLocalReferences(content);
  const missing: string[] = [];
  const files = references.map((reference) => {
    const absolute = path.resolve(baseDir, reference);
    if (!fs.existsSync(absolute) || fs.statSync(absolute).size <= 0) {
      missing.push(reference);
    }
    return absolute;
  });
  if (missing.length > 0) {
    throw new Error(`播放列表引用文件缺失或为空: ${missing.join(', ')}`);
  }
  return { references: references.length, files };
}

export function acquireEpisodeLock(
  resourceDir: string,
  episodeIndex: number,
  payload: Record<string, unknown>,
  staleAfterMs = 6 * 60 * 60 * 1000
): string {
  const lockPath = path.join(
    resourceDir,
    `.episode_${String(episodeIndex).padStart(2, '0')}.download.lock`
  );
  try {
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ ...payload, startedAt: Date.now() }),
      { encoding: 'utf-8', flag: 'wx' }
    );
    return lockPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const age = Date.now() - fs.statSync(lockPath).mtimeMs;
    let ownerAlive = false;
    try {
      const existing = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as {
        pid?: unknown;
      };
      if (typeof existing.pid === 'number') {
        process.kill(existing.pid, 0);
        ownerAlive = true;
      }
    } catch {
      ownerAlive = false;
    }
    if (ownerAlive || age <= staleAfterMs) {
      throw new Error('该剧集已有下载任务进行中');
    }
    fs.rmSync(lockPath, { force: true });
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ ...payload, startedAt: Date.now(), reclaimed: true }),
      { encoding: 'utf-8', flag: 'wx' }
    );
    return lockPath;
  }
}

export function releaseEpisodeLock(lockPath: string): void {
  fs.rmSync(lockPath, { force: true });
}

export function commitPlaylistAtomically(
  activePlaylistPath: string,
  content: string
): void {
  const tempPath = `${activePlaylistPath}.tmp`;
  fs.writeFileSync(tempPath, content, 'utf-8');
  fs.renameSync(tempPath, activePlaylistPath);
}
