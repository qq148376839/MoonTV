import path from 'path';

/**
 * 路径规范化工具
 * 统一处理多平台路径格式问题（Windows/Mac/Linux/Docker）
 */
export class PathUtils {
  /**
   * 规范化路径分隔符
   * Windows: \ → /
   * Mac/Linux: 保持不变
   */
  static normalizeSeparator(pathStr: string): string {
    return pathStr.replace(/\\/g, '/');
  }

  /**
   * 规范化路径（统一分隔符，移除多余的 ./）
   */
  static normalizePath(pathStr: string): string {
    let normalized = this.normalizeSeparator(pathStr);
    // 移除开头的 ./
    normalized = normalized.replace(/^\.\//, '');
    // 移除多余的斜杠
    normalized = normalized.replace(/\/+/g, '/');
    return normalized;
  }

  /**
   * 检查路径是否以指定前缀开头（忽略分隔符差异）
   */
  static startsWith(pathStr: string, prefix: string): boolean {
    const normalizedPath = this.normalizePath(pathStr);
    const normalizedPrefix = this.normalizePath(prefix);
    return normalizedPath.startsWith(normalizedPrefix);
  }

  /**
   * 解析资源路径（支持相对路径和绝对路径）
   * @param resourcePath 资源路径（可能来自 index.json）
   * @param basePath 基础路径（storagePath 或 process.cwd()）
   */
  static resolveResourcePath(resourcePath: string, basePath?: string): string {
    // 规范化路径分隔符
    const normalizedPath = this.normalizePath(resourcePath);

    // 如果已经是绝对路径，直接返回
    if (path.isAbsolute(resourcePath)) {
      return resourcePath;
    }

    // 检查是否是相对于项目根目录的路径
    if (
      this.startsWith(normalizedPath, 'data/videos') ||
      this.startsWith(normalizedPath, './data/videos')
    ) {
      return path.resolve(process.cwd(), normalizedPath.replace(/^\.\//, ''));
    }

    // 否则相对于 basePath
    const base = basePath || process.cwd();
    return path.resolve(base, normalizedPath);
  }

  /**
   * 统一存储路径格式（存储到 index.json 时使用）
   * 统一使用正斜杠，相对于项目根目录
   */
  static formatForStorage(absolutePath: string): string {
    const normalized = this.normalizePath(absolutePath);
    const cwd = this.normalizePath(process.cwd());

    // 如果是相对于项目根目录的路径，返回相对路径
    if (normalized.startsWith(cwd)) {
      return normalized.substring(cwd.length).replace(/^\//, '');
    }

    // 否则返回绝对路径（规范化后）
    return normalized;
  }
}
