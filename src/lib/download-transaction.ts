import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

const DOWNLOAD_PROCESS_INSTANCE = randomUUID();

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

export interface ResumeFile {
  index: number;
  path: string;
  expectedLength?: number | null;
}

export interface MediaPlaylistResource {
  index: number;
  sequence: number;
  url: string;
  keyIndex: number | null;
  mapIndex: number | null;
}

export interface MediaPlaylistUnit {
  index: number;
  url: string;
  relationship: string;
}

export interface ParsedMediaPlaylistResources {
  mediaSequence: number;
  segments: MediaPlaylistResource[];
  keys: MediaPlaylistUnit[];
  maps: MediaPlaylistUnit[];
}

export interface RemappedMediaPlaylistResources {
  preservedSegmentIndices: number[];
  pendingSegments: MediaPlaylistResource[];
  keys: MediaPlaylistUnit[];
  maps: MediaPlaylistUnit[];
}

export interface ProgressivePlaylistOptions {
  availableSegmentIndices: number[];
  availableKeyIndices: number[];
  availableMapIndices: number[];
  segmentUri: (index: number) => string;
  keyUri: (index: number) => string;
  mapUri: (index: number) => string;
}

export interface ProgressivePlaylistResult {
  content: string;
  segmentCount: number;
  durationSeconds: number;
}

function absolutePlaylistUrl(value: string, playlistUrl: string): string {
  return new URL(value, playlistUrl).href;
}

function relationshipSignature(line: string): string {
  return line.replace(/URI="[^"]+"/i, 'URI="<redacted>"').replace(/\s+/g, '');
}

export function parseMediaPlaylistResources(
  content: string,
  playlistUrl: string
): ParsedMediaPlaylistResources {
  const mediaSequenceMatch = content.match(
    /^#EXT-X-MEDIA-SEQUENCE\s*:\s*(\d+)\s*$/im
  );
  const mediaSequence = mediaSequenceMatch
    ? Number.parseInt(mediaSequenceMatch[1], 10)
    : 0;
  const keys: MediaPlaylistUnit[] = [];
  const maps: MediaPlaylistUnit[] = [];
  const keyIndices = new Map<string, number>();
  const mapIndices = new Map<string, number>();
  const segments: MediaPlaylistResource[] = [];
  let keyIndex: number | null = null;
  let mapIndex: number | null = null;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#EXT-X-KEY')) {
      if (/METHOD=NONE/i.test(line)) {
        keyIndex = null;
        continue;
      }
      const match = line.match(/URI="([^"]+)"/i);
      if (!match) continue;
      const url = absolutePlaylistUrl(match[1], playlistUrl);
      const relationship = relationshipSignature(line);
      const identity = `${relationship}\n${url}`;
      const known = keyIndices.get(identity);
      if (known == null) {
        keyIndex = keys.length;
        keyIndices.set(identity, keyIndex);
        keys.push({ index: keyIndex, url, relationship });
      } else {
        keyIndex = known;
      }
      continue;
    }
    if (line.startsWith('#EXT-X-MAP')) {
      const match = line.match(/URI="([^"]+)"/i);
      if (!match) continue;
      const url = absolutePlaylistUrl(match[1], playlistUrl);
      const relationship = relationshipSignature(line);
      const identity = `${relationship}\n${url}`;
      const known = mapIndices.get(identity);
      if (known == null) {
        mapIndex = maps.length;
        mapIndices.set(identity, mapIndex);
        maps.push({ index: mapIndex, url, relationship });
      } else {
        mapIndex = known;
      }
      continue;
    }
    if (!line.startsWith('#')) {
      const index = segments.length;
      segments.push({
        index,
        sequence: mediaSequence + index,
        url: absolutePlaylistUrl(line, playlistUrl),
        keyIndex,
        mapIndex,
      });
    }
  }
  return { mediaSequence, segments, keys, maps };
}

export function remapMediaPlaylistResources(
  original: ParsedMediaPlaylistResources,
  refreshed: ParsedMediaPlaylistResources,
  completedSegmentIndices: number[]
): RemappedMediaPlaylistResources {
  const refreshedBySequence = new Map(
    refreshed.segments.map((segment) => [segment.sequence, segment])
  );
  const relationshipsMatch = original.segments.every((segment) => {
    const next = refreshedBySequence.get(segment.sequence);
    return (
      next != null &&
      next.keyIndex === segment.keyIndex &&
      next.mapIndex === segment.mapIndex
    );
  });
  if (
    original.segments.length === 0 ||
    refreshed.segments.length !== original.segments.length ||
    !relationshipsMatch ||
    original.keys.length !== refreshed.keys.length ||
    original.maps.length !== refreshed.maps.length ||
    original.keys.some(
      (key, index) => key.relationship !== refreshed.keys[index]?.relationship
    ) ||
    original.maps.some(
      (map, index) => map.relationship !== refreshed.maps[index]?.relationship
    )
  ) {
    throw new Error('playlist structure mismatch');
  }

  const completed = new Set(completedSegmentIndices);
  const pendingSegments = original.segments.flatMap((segment) => {
    if (completed.has(segment.index)) return [];
    const next = refreshedBySequence.get(segment.sequence);
    if (!next) throw new Error('playlist structure mismatch');
    return [{ ...next, index: segment.index }];
  });
  return {
    preservedSegmentIndices: original.segments
      .filter((segment) => completed.has(segment.index))
      .map((segment) => segment.index),
    pendingSegments,
    keys: refreshed.keys,
    maps: refreshed.maps,
  };
}

export function buildProgressivePlaylist(
  content: string,
  playlistUrl: string,
  options: ProgressivePlaylistOptions
): ProgressivePlaylistResult {
  const resources = parseMediaPlaylistResources(content, playlistUrl);
  const availableSegments = new Set(options.availableSegmentIndices);
  const availableKeys = new Set(options.availableKeyIndices);
  const availableMaps = new Set(options.availableMapIndices);
  let segmentCount = 0;
  for (const segment of resources.segments) {
    if (
      !availableSegments.has(segment.index) ||
      (segment.keyIndex !== null && !availableKeys.has(segment.keyIndex)) ||
      (segment.mapIndex !== null && !availableMaps.has(segment.mapIndex))
    ) {
      break;
    }
    segmentCount += 1;
  }

  const header: string[] = [];
  const groups: string[][] = [];
  let pending: string[] = [];
  let segmentIndex = 0;
  let sawSegmentScopedTag = false;
  const segmentScopedTag =
    /^#EXT(?:INF|-X-(?:KEY|MAP|BYTERANGE|DISCONTINUITY|PROGRAM-DATE-TIME))/i;

  for (const rawLine of content.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed || /^#EXT-X-ENDLIST/i.test(trimmed)) continue;
    if (segmentIndex === 0 && !sawSegmentScopedTag && trimmed.startsWith('#')) {
      if (segmentScopedTag.test(trimmed)) {
        sawSegmentScopedTag = true;
        pending.push(rawLine);
      } else {
        header.push(rawLine);
      }
      continue;
    }
    if (trimmed.startsWith('#')) {
      pending.push(rawLine);
      continue;
    }
    if (segmentIndex >= segmentCount) break;
    groups.push([...pending, options.segmentUri(segmentIndex)]);
    pending = [];
    segmentIndex += 1;
  }

  if (!header.some((line) => /^#EXTM3U/i.test(line.trim()))) {
    header.unshift('#EXTM3U');
  }
  if (!header.some((line) => /^#EXT-X-PLAYLIST-TYPE:/i.test(line.trim()))) {
    header.push('#EXT-X-PLAYLIST-TYPE:EVENT');
  }

  let durationSeconds = 0;
  const rewrittenGroups = groups.map((group) =>
    group.map((line) => {
      const trimmed = line.trim();
      const duration = trimmed.match(/^#EXTINF:([\d.]+)/i);
      if (duration) durationSeconds += Number.parseFloat(duration[1]);
      if (trimmed.startsWith('#EXT-X-KEY') && !/METHOD=NONE/i.test(trimmed)) {
        const match = trimmed.match(/URI="([^"]+)"/i);
        if (!match) return line;
        const absolute = absolutePlaylistUrl(match[1], playlistUrl);
        const relationship = relationshipSignature(trimmed);
        const key = resources.keys.find(
          (candidate) =>
            candidate.url === absolute &&
            candidate.relationship === relationship
        );
        if (!key) throw new Error('playlist structure mismatch');
        return line.replace(
          /URI="[^"]+"/i,
          `URI="${options.keyUri(key.index)}"`
        );
      }
      if (trimmed.startsWith('#EXT-X-MAP')) {
        const match = trimmed.match(/URI="([^"]+)"/i);
        if (!match) return line;
        const absolute = absolutePlaylistUrl(match[1], playlistUrl);
        const relationship = relationshipSignature(trimmed);
        const map = resources.maps.find(
          (candidate) =>
            candidate.url === absolute &&
            candidate.relationship === relationship
        );
        if (!map) throw new Error('playlist structure mismatch');
        return line.replace(
          /URI="[^"]+"/i,
          `URI="${options.mapUri(map.index)}"`
        );
      }
      return line;
    })
  );

  return {
    content: [...header, ...rewrittenGroups.flat()].join('\n'),
    segmentCount,
    durationSeconds,
  };
}

export function validateResumeFiles(files: ResumeFile[]): {
  valid: number[];
  invalid: number[];
  bytes: number;
} {
  const result = { valid: [] as number[], invalid: [] as number[], bytes: 0 };
  const seenIndices = new Set<number>();
  for (const file of files) {
    if (seenIndices.has(file.index)) continue;
    seenIndices.add(file.index);
    try {
      const size = fs.statSync(file.path).size;
      if (
        size <= 0 ||
        (file.expectedLength != null && size !== file.expectedLength)
      ) {
        result.invalid.push(file.index);
        continue;
      }
      result.valid.push(file.index);
      result.bytes += size;
    } catch {
      result.invalid.push(file.index);
    }
  }
  return result;
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
      JSON.stringify({
        ...payload,
        processInstance: DOWNLOAD_PROCESS_INSTANCE,
        startedAt: Date.now(),
      }),
      { encoding: 'utf-8', flag: 'wx' }
    );
    return lockPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const age = Date.now() - fs.statSync(lockPath).mtimeMs;
    let ownerAlive = false;
    let reusedPidFromAnotherInstance = false;
    try {
      const existing = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as {
        pid?: unknown;
        processInstance?: unknown;
      };
      if (typeof existing.pid === 'number') {
        process.kill(existing.pid, 0);
        reusedPidFromAnotherInstance =
          existing.pid === process.pid &&
          existing.processInstance !== DOWNLOAD_PROCESS_INSTANCE;
        ownerAlive =
          existing.pid !== process.pid ||
          existing.processInstance === DOWNLOAD_PROCESS_INSTANCE;
      }
    } catch {
      ownerAlive = false;
    }
    if (ownerAlive || (!reusedPidFromAnotherInstance && age <= staleAfterMs)) {
      throw new Error('该剧集已有下载任务进行中');
    }
    fs.rmSync(lockPath, { force: true });
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        ...payload,
        processInstance: DOWNLOAD_PROCESS_INSTANCE,
        startedAt: Date.now(),
        reclaimed: true,
      }),
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
