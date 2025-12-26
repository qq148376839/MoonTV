/**
 * 官方解析器解密工具
 * 参考 final_direct_parser_v2.py 的实现
 */
/* eslint-disable no-console */

import crypto from 'crypto';

// DecryptConfig and DecryptResult interfaces are kept for future use
// eslint-disable-next-line unused-imports/no-unused-vars
interface DecryptConfig {
  url: string; // 加密的URL
  uid: string; // 用户ID
}

// eslint-disable-next-line unused-imports/no-unused-vars
interface DecryptResult {
  success: boolean;
  m3u8Url?: string;
  error?: string;
}

/**
 * 解密ConFig.url
 * 使用AES-CBC解密，PKCS7填充
 */
export function decryptUrl(encryptedUrl: string, uid: string): string | null {
  // 清理转义字符（HTML中的 \/ 需要转换为 /）
  const cleanedUrl = encryptedUrl.replace(/\\\//g, '/');

  // Key生成方式
  const keyStr = '2890' + uid + 'tB959C';
  const keyBytes = Buffer.from(keyStr, 'utf-8');

  // 尝试不同的密钥生成方式
  const keyMethods: Array<{ name: string; key: Buffer }> = [];

  // 方式1: 直接使用UTF-8字节（如果长度正好是16/24/32）
  if (
    keyBytes.length === 16 ||
    keyBytes.length === 24 ||
    keyBytes.length === 32
  ) {
    keyMethods.push({ name: '直接UTF-8', key: keyBytes });
  }

  // 方式2: MD5哈希（16字节）
  keyMethods.push({
    name: 'MD5哈希',
    key: crypto.createHash('md5').update(keyBytes).digest(),
  });

  // 方式3: SHA256哈希（前16字节）
  keyMethods.push({
    name: 'SHA256前16字节',
    key: crypto.createHash('sha256').update(keyBytes).digest().slice(0, 16),
  });

  // 方式4: SHA256哈希（前24字节）
  if (keyBytes.length !== 24) {
    keyMethods.push({
      name: 'SHA256前24字节',
      key: crypto.createHash('sha256').update(keyBytes).digest().slice(0, 24),
    });
  }

  // 方式5: SHA256哈希（前32字节）
  if (keyBytes.length !== 32) {
    keyMethods.push({
      name: 'SHA256前32字节',
      key: crypto.createHash('sha256').update(keyBytes).digest().slice(0, 32),
    });
  }

  // IV生成方式
  const ivStr = '2F131BE91247866E';
  const ivMethods: Array<{ name: string; iv: Buffer }> = [
    { name: 'UTF-8编码(16字节)', iv: Buffer.from(ivStr, 'utf-8') },
    { name: '十六进制解析(8字节)', iv: Buffer.from(ivStr, 'hex') },
    {
      name: '十六进制解析+填充',
      iv: Buffer.concat([Buffer.from(ivStr, 'hex'), Buffer.alloc(8, 0)]),
    },
    {
      name: '重复填充',
      iv: Buffer.concat([
        Buffer.from(ivStr, 'hex'),
        Buffer.from(ivStr, 'hex'),
      ]).slice(0, 16),
    },
  ];

  // Base64解码
  let encryptedData: Buffer;
  try {
    encryptedData = Buffer.from(cleanedUrl, 'base64');
    if (encryptedData.length % 16 !== 0) {
      console.error('加密数据长度不是16的倍数');
      return null;
    }
  } catch (e) {
    console.error('Base64解码失败:', e);
    return null;
  }

  // 尝试所有组合
  for (const keyMethod of keyMethods) {
    // 确保key长度正确
    let key = keyMethod.key;
    if (key.length < 16) {
      key = Buffer.concat([key, Buffer.alloc(16 - key.length, 0)]);
    } else if (key.length > 16 && key.length < 24) {
      // 尝试截断到16或填充到24
      const key16 = key.slice(0, 16);
      const key24 = Buffer.concat([key, Buffer.alloc(24 - key.length, 0)]);
      keyMethods.push({ name: `${keyMethod.name}(截断到16)`, key: key16 });
      keyMethods.push({ name: `${keyMethod.name}(填充到24)`, key: key24 });
      continue;
    } else if (key.length > 24 && key.length < 32) {
      const key24 = key.slice(0, 24);
      const key32 = Buffer.concat([key, Buffer.alloc(32 - key.length, 0)]);
      keyMethods.push({ name: `${keyMethod.name}(截断到24)`, key: key24 });
      keyMethods.push({ name: `${keyMethod.name}(填充到32)`, key: key32 });
      continue;
    }

    if (key.length !== 16 && key.length !== 24 && key.length !== 32) {
      continue;
    }

    for (const ivMethod of ivMethods) {
      // 确保IV长度为16字节
      let iv = ivMethod.iv;
      if (iv.length < 16) {
        iv = Buffer.concat([iv, Buffer.alloc(16 - iv.length, 0)]);
      } else if (iv.length > 16) {
        iv = iv.slice(0, 16);
      }

      try {
        // AES-CBC解密
        const decipher = crypto.createDecipheriv(
          'aes-128-cbc',
          key.slice(0, 16),
          iv
        );
        let decrypted = Buffer.concat([
          decipher.update(encryptedData),
          decipher.final(),
        ]);

        // 尝试移除PKCS7填充
        try {
          const paddingLen = decrypted[decrypted.length - 1];
          if (paddingLen > 0 && paddingLen <= 16) {
            decrypted = decrypted.slice(0, decrypted.length - paddingLen);
          }
        } catch (e) {
          // 填充移除失败，尝试手动移除
          const paddingLen = decrypted[decrypted.length - 1];
          if (paddingLen > 0 && paddingLen <= 16) {
            decrypted = decrypted.slice(0, decrypted.length - paddingLen);
          }
        }

        const result = decrypted.toString('utf-8');

        if (result.startsWith('http')) {
          console.log(
            `解密成功！密钥方式: ${keyMethod.name}, IV方式: ${ivMethod.name}`
          );
          return result;
        } else if (
          result.includes('http') ||
          result.includes('.m3u8') ||
          result.toLowerCase().includes('m3u8')
        ) {
          console.warn(
            `解密成功但结果不是标准URL: ${result.substring(0, 200)}`
          );
        }
      } catch (e) {
        // 静默失败，继续尝试下一个组合
        continue;
      }
    }
  }

  console.error('所有解密组合都失败了');
  return null;
}

/**
 * 移除PKCS7填充
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _unpadPKCS7(data: Buffer): Buffer {
  const paddingLen = data[data.length - 1];
  if (paddingLen > 0 && paddingLen <= 16) {
    return data.slice(0, data.length - paddingLen);
  }
  return data;
}
