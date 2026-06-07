/**
 * M3U8 Cleaner Utility
 * Ports the Python logic to TypeScript and handles relative URL resolution
 * Uses Web API URL (available in Edge Runtime) instead of Node.js url module
 */
export class M3U8Cleaner {
  // Patterns to clean (regex strings)
  private static readonly CLEAN_PATTERNS = [
    /cachem3u8\.2s0\.cn/i, // 2s0 cache domain
    // Add more patterns here as needed
  ];

  /**
   * Cleans M3U8 content by removing ads/injected segments and resolving relative URLs
   * @param content Original M3U8 content
   * @param baseUrl Base URL of the M3U8 file (for resolving relative paths)
   * @returns Cleaned M3U8 content with absolute URLs
   */
  static clean(content: string, baseUrl: string): string {
    const lines = content.split('\n');
    const cleanLines: string[] = [];

    // 1. First pass: Identify "majority" domain for absolute URLs
    // This helps identify injected segments that point to different domains
    const absoluteUrls = lines
      .map((l) => l.trim())
      .filter((l) => l.startsWith('http://') || l.startsWith('https://'));

    const majorityDomains = new Set<string>();

    if (absoluteUrls.length > 0) {
      const domainCounts = new Map<string, number>();

      for (const url of absoluteUrls) {
        try {
          const domain = new URL(url).hostname;
          domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
        } catch (e) {
          // Ignore invalid URLs
        }
      }

      // Find the max count
      let maxCount = 0;
      // Use Array.from() to avoid downlevelIteration issue
      const counts = Array.from(domainCounts.values());
      for (let i = 0; i < counts.length; i++) {
        const count = counts[i];
        if (count > maxCount) maxCount = count;
      }

      // Add all domains with maxCount to majority set
      for (const [domain, count] of domainCounts.entries()) {
        if (count === maxCount) {
          majorityDomains.add(domain);
        }
      }
    }

    // 2. Second pass: Filter lines and resolve URLs
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const trimmedLine = line.trim();
      let shouldRemove = false;

      // Check if it's a URL line (absolute or relative)
      // A line is a URL if it doesn't start with # and is not empty
      const isUrl = trimmedLine.length > 0 && !trimmedLine.startsWith('#');

      if (isUrl) {
        // Check absolute URLs against majority domain
        if (
          trimmedLine.startsWith('http://') ||
          trimmedLine.startsWith('https://')
        ) {
          try {
            const domain = new URL(trimmedLine).hostname;
            // If we have majority domains identified, and this one isn't one of them, remove it
            if (majorityDomains.size > 0 && !majorityDomains.has(domain)) {
              shouldRemove = true;
            }
          } catch (e) {
            // Invalid URL, keep it safe or remove? Let's keep for now unless it matches patterns
          }
        }

        // Check regex patterns (for both absolute and relative)
        if (!shouldRemove) {
          for (const pattern of this.CLEAN_PATTERNS) {
            if (pattern.test(trimmedLine)) {
              shouldRemove = true;
              break;
            }
          }
        }
      } else if (trimmedLine.startsWith('#EXTINF')) {
        // EXTINF checks are done relative to the *next* line (the URL)
        // But we can also check the current line for patterns if needed
        for (const pattern of this.CLEAN_PATTERNS) {
          if (pattern.test(trimmedLine)) {
            shouldRemove = true;
            break;
          }
        }
      }

      if (shouldRemove) {
        // If this is a URL line and we're removing it, we should also remove the preceding #EXTINF if it exists
        if (
          isUrl &&
          cleanLines.length > 0 &&
          cleanLines[cleanLines.length - 1].trim().startsWith('#EXTINF')
        ) {
          cleanLines.pop();
        }
        i++;
        continue;
      }

      // If we kept the line, we might need to modify it
      if (isUrl) {
        // Resolve relative URL to absolute URL
        try {
          const absoluteUrl = new URL(trimmedLine, baseUrl).href;
          cleanLines.push(absoluteUrl);
        } catch (e) {
          // If resolution fails, keep original
          cleanLines.push(line);
        }
      } else {
        cleanLines.push(line);
      }

      i++;
    }

    // 3. Post-processing: Remove orphaned #EXTINF tags
    // The Python logic does a robust check here.
    // We'll iterate through cleanLines and remove EXTINF that aren't followed by a URL
    const finalLines: string[] = [];
    let j = 0;
    while (j < cleanLines.length) {
      const line = cleanLines[j];
      const trimmedLine = line.trim();

      if (trimmedLine.startsWith('#EXTINF')) {
        // Look ahead
        if (j + 1 < cleanLines.length) {
          const nextLine = cleanLines[j + 1].trim();
          const nextIsUrl = nextLine.length > 0 && !nextLine.startsWith('#');

          if (nextIsUrl) {
            finalLines.push(line); // Keep EXTINF
            finalLines.push(cleanLines[j + 1]); // Keep URL
            j += 2;
            continue;
          } else {
            // Next line is not a URL (maybe another tag or EOF), so this EXTINF is orphan
            // Skip this line
            j++;
            continue;
          }
        } else {
          // EOF after EXTINF, orphan
          j++;
          continue;
        }
      } else if (trimmedLine.length > 0 && !trimmedLine.startsWith('#')) {
        // This is a URL. If it was part of an EXTINF pair, it would have been handled above.
        // If we reach here, it's a standalone URL or we missed the EXTINF.
        // Just add it.
        finalLines.push(line);
        j++;
      } else {
        // Other tags (#EXTM3U, #EXT-X-..., etc)
        finalLines.push(line);
        j++;
      }
    }

    return finalLines.join('\n');
  }
}
