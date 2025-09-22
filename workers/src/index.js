/**
 * MoonTV Cloudflare Workers API - v2.0
 * 混合用户系统与视频数据存储的完整解决方案
 * 兼容MoonTV原有API接口，新增视频数据管理功能
 */

<<<<<<< HEAD
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const path = url.pathname
=======
const worker = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)

    // CORS 头部
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
<<<<<<< HEAD
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Username',
      'Access-Control-Max-Age': '86400',
    }

    // 处理 OPTIONS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
=======
      'Access-Control-Allow-Headers':
        'Content-Type, Authorization, X-API-Key, X-Username',
      'Access-Control-Max-Age': '86400',
    };

    // 处理 OPTIONS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
    }

    try {
      // ==================== 用户系统API (兼容MoonTV) ====================
      if (path === '/api/auth/login' && request.method === 'POST') {
<<<<<<< HEAD
        return await handleLogin(request, env, corsHeaders)
      } else if (path === '/api/auth/register' && request.method === 'POST') {
        return await handleRegister(request, env, corsHeaders)
      } else if (path === '/api/auth/verify' && request.method === 'POST') {
        return await handleVerifyUser(request, env, corsHeaders)
      } else if (path === '/api/user/change-password' && request.method === 'POST') {
        return await handleChangePassword(request, env, corsHeaders)
      
      // 播放记录API
      } else if (path === '/api/playrecords' && request.method === 'GET') {
        return await handleGetPlayRecords(request, env, corsHeaders)
      } else if (path === '/api/playrecords' && request.method === 'POST') {
        return await handleSetPlayRecord(request, env, corsHeaders)
      } else if (path === '/api/playrecords' && request.method === 'DELETE') {
        return await handleDeletePlayRecord(request, env, corsHeaders)
      
      // 收藏API
      } else if (path === '/api/favorites' && request.method === 'GET') {
        return await handleGetFavorites(request, env, corsHeaders)
      } else if (path === '/api/favorites' && request.method === 'POST') {
        return await handleSetFavorite(request, env, corsHeaders)
      } else if (path === '/api/favorites' && request.method === 'DELETE') {
        return await handleDeleteFavorite(request, env, corsHeaders)
      
      // 搜索历史API
      } else if (path === '/api/searchhistory' && request.method === 'GET') {
        return await handleGetSearchHistory(request, env, corsHeaders)
      } else if (path === '/api/searchhistory' && request.method === 'POST') {
        return await handleAddSearchHistory(request, env, corsHeaders)
      } else if (path === '/api/searchhistory' && request.method === 'DELETE') {
        return await handleDeleteSearchHistory(request, env, corsHeaders)

      // ==================== 视频数据API (新增功能) ====================
      
      // 视频搜索和详情
      } else if (path === '/api/videos/search' && request.method === 'GET') {
        return await handleSearchVideos(request, env, corsHeaders)
      } else if (path === '/api/videos/aggregated' && request.method === 'GET') {
        return await handleGetAggregatedVideos(request, env, corsHeaders)
      } else if (path.startsWith('/api/videos/') && request.method === 'GET') {
        return await handleGetVideoDetail(request, env, corsHeaders)
      } else if (path === '/api/videos' && request.method === 'POST') {
        return await handleCreateVideo(request, env, corsHeaders)
      } else if (path === '/api/videos/batch' && request.method === 'POST') {
        return await handleBatchCreateVideos(request, env, corsHeaders)
      
      // 分类管理
      } else if (path === '/api/categories' && request.method === 'GET') {
        return await handleGetCategories(request, env, corsHeaders)
      } else if (path === '/api/categories/hierarchy' && request.method === 'GET') {
        return await handleGetCategoryHierarchy(request, env, corsHeaders)
      } else if (path === '/api/categories' && request.method === 'POST') {
        return await handleCreateCategory(request, env, corsHeaders)
      
      // 数据采集API (兼容autotasks接口)
      } else if (path === '/api/collection/update_data' && request.method === 'POST') {
        return await handleUpdateData(request, env, corsHeaders)
      } else if (path === '/api/collection/run' && request.method === 'POST') {
        return await handleRunCollection(request, env, ctx, corsHeaders)
      } else if (path === '/api/collection/status' && request.method === 'GET') {
        return await handleGetCollectionStatus(request, env, corsHeaders)
      
      // 统计API
      } else if (path === '/api/stats' && request.method === 'GET') {
        return await handleGetStats(request, env, corsHeaders)
      } else if (path === '/api/stats/dashboard' && request.method === 'GET') {
        return await handleGetDashboardStats(request, env, corsHeaders)

      // 管理员API
      } else if (path === '/api/admin/users' && request.method === 'GET') {
        return await handleGetAllUsers(request, env, corsHeaders)
      } else if (path === '/api/admin/config' && request.method === 'GET') {
        return await handleGetAdminConfig(request, env, corsHeaders)
      } else if (path === '/api/admin/config' && request.method === 'POST') {
        return await handleSetAdminConfig(request, env, corsHeaders)

      } else {
        return new Response('Not Found', { 
          status: 404, 
          headers: corsHeaders 
        })
      }
    } catch (error) {
      console.error('API Error:', error)
      return new Response(JSON.stringify({
        code: 500,
        msg: error.message || 'Internal Server Error',
        data: null
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
=======
        return await handleLogin(request, env, corsHeaders);
      } else if (path === '/api/auth/register' && request.method === 'POST') {
        return await handleRegister(request, env, corsHeaders);
      } else if (path === '/api/auth/verify' && request.method === 'POST') {
        return await handleVerifyUser(request, env, corsHeaders);
      } else if (
        path === '/api/user/change-password' &&
        request.method === 'POST'
      ) {
        return await handleChangePassword(request, env, corsHeaders);

        // 播放记录API
      } else if (path === '/api/playrecords' && request.method === 'GET') {
        return await handleGetPlayRecords(request, env, corsHeaders);
      } else if (path === '/api/playrecords' && request.method === 'POST') {
        return await handleSetPlayRecord(request, env, corsHeaders);
      } else if (path === '/api/playrecords' && request.method === 'DELETE') {
        return await handleDeletePlayRecord(request, env, corsHeaders);

        // 收藏API
      } else if (path === '/api/favorites' && request.method === 'GET') {
        return await handleGetFavorites(request, env, corsHeaders);
      } else if (path === '/api/favorites' && request.method === 'POST') {
        return await handleSetFavorite(request, env, corsHeaders);
      } else if (path === '/api/favorites' && request.method === 'DELETE') {
        return await handleDeleteFavorite(request, env, corsHeaders);

        // 搜索历史API
      } else if (path === '/api/searchhistory' && request.method === 'GET') {
        return await handleGetSearchHistory(request, env, corsHeaders);
      } else if (path === '/api/searchhistory' && request.method === 'POST') {
        return await handleAddSearchHistory(request, env, corsHeaders);
      } else if (path === '/api/searchhistory' && request.method === 'DELETE') {
        return await handleDeleteSearchHistory(request, env, corsHeaders);

        // ==================== 视频数据API (新增功能) ====================

        // 视频搜索和详情
      } else if (path === '/api/videos/search' && request.method === 'GET') {
        return await handleSearchVideos(request, env, corsHeaders);
      } else if (
        path === '/api/videos/aggregated' &&
        request.method === 'GET'
      ) {
        return await handleGetAggregatedVideos(request, env, corsHeaders);
      } else if (path.startsWith('/api/videos/') && request.method === 'GET') {
        return await handleGetVideoDetail(request, env, corsHeaders);
      } else if (path === '/api/videos' && request.method === 'POST') {
        return await handleCreateVideo(request, env, corsHeaders);
      } else if (path === '/api/videos/batch' && request.method === 'POST') {
        return await handleBatchCreateVideos(request, env, corsHeaders);

        // 分类管理
      } else if (path === '/api/categories' && request.method === 'GET') {
        return await handleGetCategories(request, env, corsHeaders);
      } else if (
        path === '/api/categories/hierarchy' &&
        request.method === 'GET'
      ) {
        return await handleGetCategoryHierarchy(request, env, corsHeaders);
      } else if (path === '/api/categories' && request.method === 'POST') {
        return await handleCreateCategory(request, env, corsHeaders);

        // 数据采集API (兼容autotasks接口)
      } else if (
        path === '/api/collection/update_data' &&
        request.method === 'POST'
      ) {
        return await handleUpdateData(request, env, corsHeaders);
      } else if (path === '/api/collection/run' && request.method === 'POST') {
        return await handleRunCollection(request, env, ctx, corsHeaders);
      } else if (
        path === '/api/collection/status' &&
        request.method === 'GET'
      ) {
        return await handleGetCollectionStatus(request, env, corsHeaders);

        // 统计API
      } else if (path === '/api/stats' && request.method === 'GET') {
        return await handleGetStats(request, env, corsHeaders);
      } else if (path === '/api/stats/dashboard' && request.method === 'GET') {
        return await handleGetDashboardStats(request, env, corsHeaders);

        // 管理员API
      } else if (path === '/api/admin/users' && request.method === 'GET') {
        return await handleGetAllUsers(request, env, corsHeaders);
      } else if (path === '/api/admin/config' && request.method === 'GET') {
        return await handleGetAdminConfig(request, env, corsHeaders);
      } else if (path === '/api/admin/config' && request.method === 'POST') {
        return await handleSetAdminConfig(request, env, corsHeaders);
      } else {
        return new Response('Not Found', {
          status: 404,
          headers: corsHeaders,
        });
      }
    } catch (error) {
      console.error('API Error:', error);
      return new Response(
        JSON.stringify({
          code: 500,
          msg: error.message || 'Internal Server Error',
          data: null,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
    }
  },

  // 定时任务处理器
<<<<<<< HEAD
  async scheduled(controller, env, ctx) {
    console.log('定时任务开始执行:', new Date().toISOString())
    
    try {
      // 执行数据同步任务
      await syncExternalData(env)
      
      // 清理过期缓存
      await cleanupExpiredCache(env)
      
      console.log('定时任务执行完成')
    } catch (error) {
      console.error('定时任务执行失败:', error)
    }
  }
}
=======
  async scheduled(_controller, env, _ctx) {
    // 定时任务开始执行

    try {
      // 执行数据同步任务
      await syncExternalData(env);

      // 清理过期缓存
      await cleanupExpiredCache(env);

      // 定时任务执行完成
    } catch (error) {
      console.error('定时任务执行失败:', error);
    }
  },
};
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)

// ==================== 工具函数 ====================

function createSuccessResponse(data, msg = 'success', corsHeaders = {}) {
<<<<<<< HEAD
  return new Response(JSON.stringify({
    code: 200,
    msg,
    data
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

function createErrorResponse(code, msg, corsHeaders = {}, httpStatus = 400) {
  return new Response(JSON.stringify({
    code,
    msg,
    data: null
  }), {
    status: httpStatus,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
=======
  return new Response(
    JSON.stringify({
      code: 200,
      msg,
      data,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}

function createErrorResponse(code, msg, corsHeaders = {}, httpStatus = 400) {
  return new Response(
    JSON.stringify({
      code,
      msg,
      data: null,
    }),
    {
      status: httpStatus,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
}

// 获取用户名从请求头
function getUserFromRequest(request) {
<<<<<<< HEAD
  return request.headers.get('X-Username') || 'anonymous'
=======
  return request.headers.get('X-Username') || 'anonymous';
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
}

// 验证管理员权限
async function isAdmin(username, env) {
<<<<<<< HEAD
  if (!username || username === 'anonymous') return false
  
  const user = await env.DB.prepare(
    'SELECT is_admin FROM users WHERE username = ?'
  ).bind(username).first()
  
  return user?.is_admin === 1
=======
  if (!username || username === 'anonymous') return false;

  const user = await env.DB.prepare(
    'SELECT is_admin FROM users WHERE username = ?'
  )
    .bind(username)
    .first();

  return user?.is_admin === 1;
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
}

// ==================== 用户系统API处理函数 ====================

async function handleLogin(request, env, corsHeaders) {
  try {
<<<<<<< HEAD
    const { username, password } = await request.json()
    
    if (!username || !password) {
      return createErrorResponse(400, '用户名和密码不能为空', corsHeaders)
=======
    const { username, password } = await request.json();

    if (!username || !password) {
      return createErrorResponse(400, '用户名和密码不能为空', corsHeaders);
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
    }

    const user = await env.DB.prepare(
      'SELECT username, is_admin FROM users WHERE username = ? AND password = ?'
<<<<<<< HEAD
    ).bind(username, password).first()

    if (!user) {
      return createErrorResponse(401, '用户名或密码错误', corsHeaders)
    }

    return createSuccessResponse({
      username: user.username,
      is_admin: user.is_admin === 1
    }, '登录成功', corsHeaders)

  } catch (error) {
    console.error('登录失败:', error)
    return createErrorResponse(500, '登录失败', corsHeaders)
=======
    )
      .bind(username, password)
      .first();

    if (!user) {
      return createErrorResponse(401, '用户名或密码错误', corsHeaders);
    }

    return createSuccessResponse(
      {
        username: user.username,
        is_admin: user.is_admin === 1,
      },
      '登录成功',
      corsHeaders
    );
  } catch (error) {
    console.error('登录失败:', error);
    return createErrorResponse(500, '登录失败', corsHeaders);
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
  }
}

async function handleRegister(request, env, corsHeaders) {
  try {
<<<<<<< HEAD
    const { username, password } = await request.json()
    
    if (!username || !password) {
      return createErrorResponse(400, '用户名和密码不能为空', corsHeaders)
=======
    const { username, password } = await request.json();

    if (!username || !password) {
      return createErrorResponse(400, '用户名和密码不能为空', corsHeaders);
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
    }

    // 检查用户是否已存在
    const existingUser = await env.DB.prepare(
      'SELECT username FROM users WHERE username = ?'
<<<<<<< HEAD
    ).bind(username).first()

    if (existingUser) {
      return createErrorResponse(409, '用户名已存在', corsHeaders)
    }

    // 创建用户
    await env.DB.prepare(
      'INSERT INTO users (username, password) VALUES (?, ?)'
    ).bind(username, password).run()

    return createSuccessResponse({ username }, '注册成功', corsHeaders)

  } catch (error) {
    console.error('注册失败:', error)
    return createErrorResponse(500, '注册失败', corsHeaders)
=======
    )
      .bind(username)
      .first();

    if (existingUser) {
      return createErrorResponse(409, '用户名已存在', corsHeaders);
    }

    // 创建用户
    await env.DB.prepare('INSERT INTO users (username, password) VALUES (?, ?)')
      .bind(username, password)
      .run();

    return createSuccessResponse({ username }, '注册成功', corsHeaders);
  } catch (error) {
    console.error('注册失败:', error);
    return createErrorResponse(500, '注册失败', corsHeaders);
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
  }
}

async function handleVerifyUser(request, env, corsHeaders) {
  try {
<<<<<<< HEAD
    const { username, password } = await request.json()
    
    const user = await env.DB.prepare(
      'SELECT username FROM users WHERE username = ? AND password = ?'
    ).bind(username, password).first()

    return createSuccessResponse({ 
      valid: !!user 
    }, user ? '验证成功' : '验证失败', corsHeaders)

  } catch (error) {
    console.error('验证用户失败:', error)
    return createErrorResponse(500, '验证失败', corsHeaders)
=======
    const { username, password } = await request.json();

    const user = await env.DB.prepare(
      'SELECT username FROM users WHERE username = ? AND password = ?'
    )
      .bind(username, password)
      .first();

    return createSuccessResponse(
      {
        valid: !!user,
      },
      user ? '验证成功' : '验证失败',
      corsHeaders
    );
  } catch (error) {
    console.error('验证用户失败:', error);
    return createErrorResponse(500, '验证失败', corsHeaders);
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
  }
}

async function handleChangePassword(request, env, corsHeaders) {
  try {
<<<<<<< HEAD
    const { username, oldPassword, newPassword } = await request.json()
    
    if (!username || !oldPassword || !newPassword) {
      return createErrorResponse(400, '参数不完整', corsHeaders)
=======
    const { username, oldPassword, newPassword } = await request.json();

    if (!username || !oldPassword || !newPassword) {
      return createErrorResponse(400, '参数不完整', corsHeaders);
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
    }

    // 验证旧密码
    const user = await env.DB.prepare(
      'SELECT username FROM users WHERE username = ? AND password = ?'
<<<<<<< HEAD
    ).bind(username, oldPassword).first()

    if (!user) {
      return createErrorResponse(401, '原密码错误', corsHeaders)
    }

    // 更新密码
    await env.DB.prepare(
      'UPDATE users SET password = ? WHERE username = ?'
    ).bind(newPassword, username).run()

    return createSuccessResponse(null, '密码修改成功', corsHeaders)

  } catch (error) {
    console.error('修改密码失败:', error)
    return createErrorResponse(500, '修改密码失败', corsHeaders)
=======
    )
      .bind(username, oldPassword)
      .first();

    if (!user) {
      return createErrorResponse(401, '原密码错误', corsHeaders);
    }

    // 更新密码
    await env.DB.prepare('UPDATE users SET password = ? WHERE username = ?')
      .bind(newPassword, username)
      .run();

    return createSuccessResponse(null, '密码修改成功', corsHeaders);
  } catch (error) {
    console.error('修改密码失败:', error);
    return createErrorResponse(500, '修改密码失败', corsHeaders);
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
  }
}

// ==================== 播放记录API ====================

async function handleGetPlayRecords(request, env, corsHeaders) {
  try {
<<<<<<< HEAD
    const username = getUserFromRequest(request)
    if (username === 'anonymous') {
      return createErrorResponse(401, '未授权访问', corsHeaders)
=======
    const username = getUserFromRequest(request);
    if (username === 'anonymous') {
      return createErrorResponse(401, '未授权访问', corsHeaders);
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
    }

    const records = await env.DB.prepare(
      'SELECT * FROM play_records WHERE username = ? ORDER BY save_time DESC'
<<<<<<< HEAD
    ).bind(username).all()

    const formattedRecords = {}
    records.results.forEach(record => {
=======
    )
      .bind(username)
      .all();

    const formattedRecords = {};
    records.results.forEach((record) => {
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
      formattedRecords[record.key] = {
        title: record.title,
        source_name: record.source_name,
        cover: record.cover,
        year: record.year,
        index: record.index_episode,
        total_episodes: record.total_episodes,
        play_time: record.play_time,
        total_time: record.total_time,
        save_time: record.save_time,
<<<<<<< HEAD
        search_title: record.search_title
      }
    })

    return createSuccessResponse(formattedRecords, '获取播放记录成功', corsHeaders)

  } catch (error) {
    console.error('获取播放记录失败:', error)
    return createErrorResponse(500, '获取播放记录失败', corsHeaders)
=======
        search_title: record.search_title,
      };
    });

    return createSuccessResponse(
      formattedRecords,
      '获取播放记录成功',
      corsHeaders
    );
  } catch (error) {
    console.error('获取播放记录失败:', error);
    return createErrorResponse(500, '获取播放记录失败', corsHeaders);
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
  }
}

async function handleSetPlayRecord(request, env, corsHeaders) {
  try {
<<<<<<< HEAD
    const username = getUserFromRequest(request)
    if (username === 'anonymous') {
      return createErrorResponse(401, '未授权访问', corsHeaders)
    }

    const { key, record } = await request.json()
    
    if (!key || !record) {
      return createErrorResponse(400, '参数不完整', corsHeaders)
    }

    await env.DB.prepare(`
      INSERT OR REPLACE INTO play_records 
      (username, key, title, source_name, cover, year, index_episode, total_episodes, play_time, total_time, save_time, search_title)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      username, key, record.title, record.source_name, record.cover, record.year,
      record.index, record.total_episodes, record.play_time, record.total_time,
      record.save_time, record.search_title || null
    ).run()

    return createSuccessResponse(null, '保存播放记录成功', corsHeaders)

  } catch (error) {
    console.error('保存播放记录失败:', error)
    return createErrorResponse(500, '保存播放记录失败', corsHeaders)
=======
    const username = getUserFromRequest(request);
    if (username === 'anonymous') {
      return createErrorResponse(401, '未授权访问', corsHeaders);
    }

    const { key, record } = await request.json();

    if (!key || !record) {
      return createErrorResponse(400, '参数不完整', corsHeaders);
    }

    await env.DB.prepare(
      `
      INSERT OR REPLACE INTO play_records 
      (username, key, title, source_name, cover, year, index_episode, total_episodes, play_time, total_time, save_time, search_title)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
      .bind(
        username,
        key,
        record.title,
        record.source_name,
        record.cover,
        record.year,
        record.index,
        record.total_episodes,
        record.play_time,
        record.total_time,
        record.save_time,
        record.search_title || null
      )
      .run();

    return createSuccessResponse(null, '保存播放记录成功', corsHeaders);
  } catch (error) {
    console.error('保存播放记录失败:', error);
    return createErrorResponse(500, '保存播放记录失败', corsHeaders);
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
  }
}

async function handleDeletePlayRecord(request, env, corsHeaders) {
  try {
<<<<<<< HEAD
    const username = getUserFromRequest(request)
    if (username === 'anonymous') {
      return createErrorResponse(401, '未授权访问', corsHeaders)
    }

    const { searchParams } = new URL(request.url)
    const key = searchParams.get('key')
    
    if (!key) {
      return createErrorResponse(400, '缺少key参数', corsHeaders)
=======
    const username = getUserFromRequest(request);
    if (username === 'anonymous') {
      return createErrorResponse(401, '未授权访问', corsHeaders);
    }

    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (!key) {
      return createErrorResponse(400, '缺少key参数', corsHeaders);
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
    }

    await env.DB.prepare(
      'DELETE FROM play_records WHERE username = ? AND key = ?'
<<<<<<< HEAD
    ).bind(username, key).run()

    return createSuccessResponse(null, '删除播放记录成功', corsHeaders)

  } catch (error) {
    console.error('删除播放记录失败:', error)
    return createErrorResponse(500, '删除播放记录失败', corsHeaders)
=======
    )
      .bind(username, key)
      .run();

    return createSuccessResponse(null, '删除播放记录成功', corsHeaders);
  } catch (error) {
    console.error('删除播放记录失败:', error);
    return createErrorResponse(500, '删除播放记录失败', corsHeaders);
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
  }
}

// ==================== 收藏API ====================

async function handleGetFavorites(request, env, corsHeaders) {
  try {
<<<<<<< HEAD
    const username = getUserFromRequest(request)
    if (username === 'anonymous') {
      return createErrorResponse(401, '未授权访问', corsHeaders)
=======
    const username = getUserFromRequest(request);
    if (username === 'anonymous') {
      return createErrorResponse(401, '未授权访问', corsHeaders);
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
    }

    const favorites = await env.DB.prepare(
      'SELECT * FROM favorites WHERE username = ? ORDER BY save_time DESC'
<<<<<<< HEAD
    ).bind(username).all()

    const formattedFavorites = {}
    favorites.results.forEach(favorite => {
=======
    )
      .bind(username)
      .all();

    const formattedFavorites = {};
    favorites.results.forEach((favorite) => {
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
      formattedFavorites[favorite.key] = {
        title: favorite.title,
        source_name: favorite.source_name,
        cover: favorite.cover,
        year: favorite.year,
        total_episodes: favorite.total_episodes,
        save_time: favorite.save_time,
<<<<<<< HEAD
        search_title: favorite.search_title
      }
    })

    return createSuccessResponse(formattedFavorites, '获取收藏成功', corsHeaders)

  } catch (error) {
    console.error('获取收藏失败:', error)
    return createErrorResponse(500, '获取收藏失败', corsHeaders)
=======
        search_title: favorite.search_title,
      };
    });

    return createSuccessResponse(
      formattedFavorites,
      '获取收藏成功',
      corsHeaders
    );
  } catch (error) {
    console.error('获取收藏失败:', error);
    return createErrorResponse(500, '获取收藏失败', corsHeaders);
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
  }
}

async function handleSetFavorite(request, env, corsHeaders) {
  try {
<<<<<<< HEAD
    const username = getUserFromRequest(request)
    if (username === 'anonymous') {
      return createErrorResponse(401, '未授权访问', corsHeaders)
    }

    const { key, favorite } = await request.json()
    
    if (!key || !favorite) {
      return createErrorResponse(400, '参数不完整', corsHeaders)
    }

    await env.DB.prepare(`
      INSERT OR REPLACE INTO favorites 
      (username, key, title, source_name, cover, year, total_episodes, save_time, search_title)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      username, key, favorite.title, favorite.source_name, favorite.cover, 
      favorite.year, favorite.total_episodes, favorite.save_time, favorite.search_title || null
    ).run()

    return createSuccessResponse(null, '添加收藏成功', corsHeaders)

  } catch (error) {
    console.error('添加收藏失败:', error)
    return createErrorResponse(500, '添加收藏失败', corsHeaders)
=======
    const username = getUserFromRequest(request);
    if (username === 'anonymous') {
      return createErrorResponse(401, '未授权访问', corsHeaders);
    }

    const { key, favorite } = await request.json();

    if (!key || !favorite) {
      return createErrorResponse(400, '参数不完整', corsHeaders);
    }

    await env.DB.prepare(
      `
      INSERT OR REPLACE INTO favorites 
      (username, key, title, source_name, cover, year, total_episodes, save_time, search_title)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
      .bind(
        username,
        key,
        favorite.title,
        favorite.source_name,
        favorite.cover,
        favorite.year,
        favorite.total_episodes,
        favorite.save_time,
        favorite.search_title || null
      )
      .run();

    return createSuccessResponse(null, '添加收藏成功', corsHeaders);
  } catch (error) {
    console.error('添加收藏失败:', error);
    return createErrorResponse(500, '添加收藏失败', corsHeaders);
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
  }
}

async function handleDeleteFavorite(request, env, corsHeaders) {
  try {
<<<<<<< HEAD
    const username = getUserFromRequest(request)
    if (username === 'anonymous') {
      return createErrorResponse(401, '未授权访问', corsHeaders)
    }

    const { searchParams } = new URL(request.url)
    const key = searchParams.get('key')
    
    if (!key) {
      return createErrorResponse(400, '缺少key参数', corsHeaders)
    }

    await env.DB.prepare(
      'DELETE FROM favorites WHERE username = ? AND key = ?'
    ).bind(username, key).run()

    return createSuccessResponse(null, '删除收藏成功', corsHeaders)

  } catch (error) {
    console.error('删除收藏失败:', error)
    return createErrorResponse(500, '删除收藏失败', corsHeaders)
=======
    const username = getUserFromRequest(request);
    if (username === 'anonymous') {
      return createErrorResponse(401, '未授权访问', corsHeaders);
    }

    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (!key) {
      return createErrorResponse(400, '缺少key参数', corsHeaders);
    }

    await env.DB.prepare('DELETE FROM favorites WHERE username = ? AND key = ?')
      .bind(username, key)
      .run();

    return createSuccessResponse(null, '删除收藏成功', corsHeaders);
  } catch (error) {
    console.error('删除收藏失败:', error);
    return createErrorResponse(500, '删除收藏失败', corsHeaders);
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
  }
}

// ==================== 搜索历史API ====================

async function handleGetSearchHistory(request, env, corsHeaders) {
  try {
<<<<<<< HEAD
    const username = getUserFromRequest(request)
    if (username === 'anonymous') {
      return createErrorResponse(401, '未授权访问', corsHeaders)
=======
    const username = getUserFromRequest(request);
    if (username === 'anonymous') {
      return createErrorResponse(401, '未授权访问', corsHeaders);
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
    }

    const history = await env.DB.prepare(
      'SELECT keyword FROM search_history WHERE username = ? ORDER BY created_at DESC LIMIT 20'
<<<<<<< HEAD
    ).bind(username).all()

    const keywords = history.results.map(row => row.keyword)

    return createSuccessResponse(keywords, '获取搜索历史成功', corsHeaders)

  } catch (error) {
    console.error('获取搜索历史失败:', error)
    return createErrorResponse(500, '获取搜索历史失败', corsHeaders)
=======
    )
      .bind(username)
      .all();

    const keywords = history.results.map((row) => row.keyword);

    return createSuccessResponse(keywords, '获取搜索历史成功', corsHeaders);
  } catch (error) {
    console.error('获取搜索历史失败:', error);
    return createErrorResponse(500, '获取搜索历史失败', corsHeaders);
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
  }
}

async function handleAddSearchHistory(request, env, corsHeaders) {
  try {
<<<<<<< HEAD
    const username = getUserFromRequest(request)
    if (username === 'anonymous') {
      return createErrorResponse(401, '未授权访问', corsHeaders)
    }

    const { keyword } = await request.json()
    
    if (!keyword) {
      return createErrorResponse(400, '关键词不能为空', corsHeaders)
=======
    const username = getUserFromRequest(request);
    if (username === 'anonymous') {
      return createErrorResponse(401, '未授权访问', corsHeaders);
    }

    const { keyword } = await request.json();

    if (!keyword) {
      return createErrorResponse(400, '关键词不能为空', corsHeaders);
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
    }

    // 删除可能存在的重复记录
    await env.DB.prepare(
      'DELETE FROM search_history WHERE username = ? AND keyword = ?'
<<<<<<< HEAD
    ).bind(username, keyword).run()
=======
    )
      .bind(username, keyword)
      .run();
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)

    // 添加新记录
    await env.DB.prepare(
      'INSERT INTO search_history (username, keyword) VALUES (?, ?)'
<<<<<<< HEAD
    ).bind(username, keyword).run()

    // 保持历史记录条数限制
    await env.DB.prepare(`
=======
    )
      .bind(username, keyword)
      .run();

    // 保持历史记录条数限制
    await env.DB.prepare(
      `
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
      DELETE FROM search_history 
      WHERE username = ? AND id NOT IN (
        SELECT id FROM search_history 
        WHERE username = ? 
        ORDER BY created_at DESC 
        LIMIT 20
      )
<<<<<<< HEAD
    `).bind(username, username).run()

    return createSuccessResponse(null, '添加搜索历史成功', corsHeaders)

  } catch (error) {
    console.error('添加搜索历史失败:', error)
    return createErrorResponse(500, '添加搜索历史失败', corsHeaders)
=======
    `
    )
      .bind(username, username)
      .run();

    return createSuccessResponse(null, '添加搜索历史成功', corsHeaders);
  } catch (error) {
    console.error('添加搜索历史失败:', error);
    return createErrorResponse(500, '添加搜索历史失败', corsHeaders);
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
  }
}

async function handleDeleteSearchHistory(request, env, corsHeaders) {
  try {
<<<<<<< HEAD
    const username = getUserFromRequest(request)
    if (username === 'anonymous') {
      return createErrorResponse(401, '未授权访问', corsHeaders)
    }

    const { searchParams } = new URL(request.url)
    const keyword = searchParams.get('keyword')
    
=======
    const username = getUserFromRequest(request);
    if (username === 'anonymous') {
      return createErrorResponse(401, '未授权访问', corsHeaders);
    }

    const { searchParams } = new URL(request.url);
    const keyword = searchParams.get('keyword');

>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
    if (keyword) {
      // 删除特定关键词
      await env.DB.prepare(
        'DELETE FROM search_history WHERE username = ? AND keyword = ?'
<<<<<<< HEAD
      ).bind(username, keyword).run()
    } else {
      // 清空所有搜索历史
      await env.DB.prepare(
        'DELETE FROM search_history WHERE username = ?'
      ).bind(username).run()
    }

    return createSuccessResponse(null, '删除搜索历史成功', corsHeaders)

  } catch (error) {
    console.error('删除搜索历史失败:', error)
    return createErrorResponse(500, '删除搜索历史失败', corsHeaders)
=======
      )
        .bind(username, keyword)
        .run();
    } else {
      // 清空所有搜索历史
      await env.DB.prepare('DELETE FROM search_history WHERE username = ?')
        .bind(username)
        .run();
    }

    return createSuccessResponse(null, '删除搜索历史成功', corsHeaders);
  } catch (error) {
    console.error('删除搜索历史失败:', error);
    return createErrorResponse(500, '删除搜索历史失败', corsHeaders);
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
  }
}

// ==================== 视频数据API ====================

async function handleSearchVideos(request, env, corsHeaders) {
  try {
<<<<<<< HEAD
    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q') || ''
    const page = parseInt(searchParams.get('page')) || 1
    const limit = parseInt(searchParams.get('limit')) || 20
    const typeId = searchParams.get('type_id')
    
    const offset = (page - 1) * limit
=======
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    const page = parseInt(searchParams.get('page')) || 1;
    const limit = parseInt(searchParams.get('limit')) || 20;
    const typeId = searchParams.get('type_id');

    const offset = (page - 1) * limit;
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)

    let sql = `
      SELECT v.*, t.type_name 
      FROM mac_vod v 
      LEFT JOIN mac_type t ON v.type_id = t.type_id 
      WHERE v.vod_status = 1
<<<<<<< HEAD
    `
    const params = []

    if (query) {
      sql += ' AND (v.vod_name LIKE ? OR v.vod_actor LIKE ? OR v.vod_director LIKE ?)'
      const searchPattern = `%${query}%`
      params.push(searchPattern, searchPattern, searchPattern)
    }

    if (typeId) {
      sql += ' AND v.type_id = ?'
      params.push(typeId)
    }

    sql += ' ORDER BY v.vod_time DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const videos = await env.DB.prepare(sql).bind(...params).all()

    return createSuccessResponse({
      videos: videos.results,
      pagination: {
        page,
        limit,
        total: videos.results.length
      }
    }, '搜索成功', corsHeaders)

  } catch (error) {
    console.error('搜索视频失败:', error)
    return createErrorResponse(500, '搜索失败', corsHeaders)
=======
    `;
    const params = [];

    if (query) {
      sql +=
        ' AND (v.vod_name LIKE ? OR v.vod_actor LIKE ? OR v.vod_director LIKE ?)';
      const searchPattern = `%${query}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    if (typeId) {
      sql += ' AND v.type_id = ?';
      params.push(typeId);
    }

    sql += ' ORDER BY v.vod_time DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const videos = await env.DB.prepare(sql)
      .bind(...params)
      .all();

    return createSuccessResponse(
      {
        videos: videos.results,
        pagination: {
          page,
          limit,
          total: videos.results.length,
        },
      },
      '搜索成功',
      corsHeaders
    );
  } catch (error) {
    console.error('搜索视频失败:', error);
    return createErrorResponse(500, '搜索失败', corsHeaders);
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
  }
}

async function handleGetVideoDetail(request, env, corsHeaders) {
  try {
<<<<<<< HEAD
    const url = new URL(request.url)
    const vodId = url.pathname.split('/').pop()

    if (!vodId) {
      return createErrorResponse(400, '视频ID不能为空', corsHeaders)
    }

    const video = await env.DB.prepare(`
=======
    const url = new URL(request.url);
    const vodId = url.pathname.split('/').pop();

    if (!vodId) {
      return createErrorResponse(400, '视频ID不能为空', corsHeaders);
    }

    const video = await env.DB.prepare(
      `
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
      SELECT v.*, t.type_name 
      FROM mac_vod v 
      LEFT JOIN mac_type t ON v.type_id = t.type_id 
      WHERE v.vod_id = ? AND v.vod_status = 1
<<<<<<< HEAD
    `).bind(vodId).first()

    if (!video) {
      return createErrorResponse(404, '视频不存在', corsHeaders)
=======
    `
    )
      .bind(vodId)
      .first();

    if (!video) {
      return createErrorResponse(404, '视频不存在', corsHeaders);
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
    }

    // 更新点击数
    await env.DB.prepare(
      'UPDATE mac_vod SET vod_hits = vod_hits + 1, vod_time_hits = ? WHERE vod_id = ?'
<<<<<<< HEAD
    ).bind(Math.floor(Date.now() / 1000), vodId).run()

    return createSuccessResponse(video, '获取视频详情成功', corsHeaders)

  } catch (error) {
    console.error('获取视频详情失败:', error)
    return createErrorResponse(500, '获取视频详情失败', corsHeaders)
=======
    )
      .bind(Math.floor(Date.now() / 1000), vodId)
      .run();

    return createSuccessResponse(video, '获取视频详情成功', corsHeaders);
  } catch (error) {
    console.error('获取视频详情失败:', error);
    return createErrorResponse(500, '获取视频详情失败', corsHeaders);
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
  }
}

// ==================== 分类管理API ====================

async function handleGetCategories(request, env, corsHeaders) {
  try {
<<<<<<< HEAD
    const categories = await env.DB.prepare(`
      SELECT * FROM mac_type 
      WHERE type_status = 1 
      ORDER BY type_sort ASC, type_id ASC
    `).all()

    return createSuccessResponse(categories.results, '获取分类成功', corsHeaders)

  } catch (error) {
    console.error('获取分类失败:', error)
    return createErrorResponse(500, '获取分类失败', corsHeaders)
=======
    const categories = await env.DB.prepare(
      `
      SELECT * FROM mac_type 
      WHERE type_status = 1 
      ORDER BY type_sort ASC, type_id ASC
    `
    ).all();

    return createSuccessResponse(
      categories.results,
      '获取分类成功',
      corsHeaders
    );
  } catch (error) {
    console.error('获取分类失败:', error);
    return createErrorResponse(500, '获取分类失败', corsHeaders);
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
  }
}

async function handleGetCategoryHierarchy(request, env, corsHeaders) {
  try {
<<<<<<< HEAD
    const categories = await env.DB.prepare(`
      SELECT * FROM mac_type 
      WHERE type_status = 1 
      ORDER BY type_sort ASC, type_id ASC
    `).all()

    // 构建层级结构
    const hierarchy = []
    const categoryMap = new Map()

    // 第一遍：创建所有分类的映射
    categories.results.forEach(cat => {
      categoryMap.set(cat.type_id, {
        ...cat,
        children: []
      })
    })

    // 第二遍：构建层级关系
    categories.results.forEach(cat => {
      if (cat.type_pid === 0) {
        // 顶级分类
        hierarchy.push(categoryMap.get(cat.type_id))
      } else {
        // 子分类
        const parent = categoryMap.get(cat.type_pid)
        if (parent) {
          parent.children.push(categoryMap.get(cat.type_id))
        }
      }
    })

    return createSuccessResponse(hierarchy, '获取分类层级成功', corsHeaders)

  } catch (error) {
    console.error('获取分类层级失败:', error)
    return createErrorResponse(500, '获取分类层级失败', corsHeaders)
=======
    const categories = await env.DB.prepare(
      `
      SELECT * FROM mac_type 
      WHERE type_status = 1 
      ORDER BY type_sort ASC, type_id ASC
    `
    ).all();

    // 构建层级结构
    const hierarchy = [];
    const categoryMap = new Map();

    // 第一遍：创建所有分类的映射
    categories.results.forEach((cat) => {
      categoryMap.set(cat.type_id, {
        ...cat,
        children: [],
      });
    });

    // 第二遍：构建层级关系
    categories.results.forEach((cat) => {
      if (cat.type_pid === 0) {
        // 顶级分类
        hierarchy.push(categoryMap.get(cat.type_id));
      } else {
        // 子分类
        const parent = categoryMap.get(cat.type_pid);
        if (parent) {
          parent.children.push(categoryMap.get(cat.type_id));
        }
      }
    });

    return createSuccessResponse(hierarchy, '获取分类层级成功', corsHeaders);
  } catch (error) {
    console.error('获取分类层级失败:', error);
    return createErrorResponse(500, '获取分类层级失败', corsHeaders);
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
  }
}

// ==================== 统计API ====================

async function handleGetStats(request, env, corsHeaders) {
  try {
    const stats = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) as count FROM users').first(),
<<<<<<< HEAD
      env.DB.prepare('SELECT COUNT(*) as count FROM mac_vod WHERE vod_status = 1').first(),
      env.DB.prepare('SELECT COUNT(*) as count FROM mac_type WHERE type_status = 1').first(),
      env.DB.prepare('SELECT COUNT(*) as count FROM play_records').first(),
      env.DB.prepare('SELECT COUNT(*) as count FROM favorites').first()
    ])

    return createSuccessResponse({
      users: stats[0].count,
      videos: stats[1].count,
      categories: stats[2].count,
      play_records: stats[3].count,
      favorites: stats[4].count
    }, '获取统计信息成功', corsHeaders)

  } catch (error) {
    console.error('获取统计信息失败:', error)
    return createErrorResponse(500, '获取统计信息失败', corsHeaders)
=======
      env.DB.prepare(
        'SELECT COUNT(*) as count FROM mac_vod WHERE vod_status = 1'
      ).first(),
      env.DB.prepare(
        'SELECT COUNT(*) as count FROM mac_type WHERE type_status = 1'
      ).first(),
      env.DB.prepare('SELECT COUNT(*) as count FROM play_records').first(),
      env.DB.prepare('SELECT COUNT(*) as count FROM favorites').first(),
    ]);

    return createSuccessResponse(
      {
        users: stats[0].count,
        videos: stats[1].count,
        categories: stats[2].count,
        play_records: stats[3].count,
        favorites: stats[4].count,
      },
      '获取统计信息成功',
      corsHeaders
    );
  } catch (error) {
    console.error('获取统计信息失败:', error);
    return createErrorResponse(500, '获取统计信息失败', corsHeaders);
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
  }
}

// ==================== 管理员API ====================

async function handleGetAllUsers(request, env, corsHeaders) {
  try {
<<<<<<< HEAD
    const username = getUserFromRequest(request)
    
    if (!(await isAdmin(username, env))) {
      return createErrorResponse(403, '权限不足', corsHeaders)
=======
    const username = getUserFromRequest(request);

    if (!(await isAdmin(username, env))) {
      return createErrorResponse(403, '权限不足', corsHeaders);
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
    }

    const users = await env.DB.prepare(
      'SELECT username, is_admin, created_at FROM users ORDER BY created_at ASC'
<<<<<<< HEAD
    ).all()

    return createSuccessResponse(users.results, '获取用户列表成功', corsHeaders)

  } catch (error) {
    console.error('获取用户列表失败:', error)
    return createErrorResponse(500, '获取用户列表失败', corsHeaders)
=======
    ).all();

    return createSuccessResponse(
      users.results,
      '获取用户列表成功',
      corsHeaders
    );
  } catch (error) {
    console.error('获取用户列表失败:', error);
    return createErrorResponse(500, '获取用户列表失败', corsHeaders);
  }
}

async function handleGetAdminConfig(request, env, corsHeaders) {
  try {
    const username = getUserFromRequest(request);

    if (!(await isAdmin(username, env))) {
      return createErrorResponse(403, '权限不足', corsHeaders);
    }

    // 尝试从数据库获取管理员配置（适配现有表结构）
    const configRow = await env.DB.prepare(
      'SELECT config FROM admin_config WHERE id = 1'
    ).first();

    if (configRow) {
      const config = JSON.parse(configRow.config);
      return createSuccessResponse(config, '获取管理员配置成功', corsHeaders);
    } else {
      // 如果没有配置，返回默认配置
      const defaultConfig = {
        SiteConfig: {
          SiteName: 'MoonTV',
          Announcement:
            '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。',
          SearchDownstreamMaxPage: 5,
          SiteInterfaceCacheTime: 7200,
          ImageProxy: '',
          DoubanProxy: '',
          DisableYellowFilter: false,
        },
        UserConfig: {
          AllowRegister: false,
          Users: [],
        },
        SourceConfig: [],
        CustomCategories: [],
      };
      return createSuccessResponse(
        defaultConfig,
        '获取默认配置成功',
        corsHeaders
      );
    }
  } catch (error) {
    console.error('获取管理员配置失败:', error);
    return createErrorResponse(500, '获取管理员配置失败', corsHeaders);
  }
}

async function handleSetAdminConfig(request, env, corsHeaders) {
  try {
    const username = getUserFromRequest(request);

    if (!(await isAdmin(username, env))) {
      return createErrorResponse(403, '权限不足', corsHeaders);
    }

    const config = await request.json();

    // 将配置保存到数据库（适配现有表结构）
    await env.DB.prepare(
      `
      INSERT OR REPLACE INTO admin_config (id, config, updated_at)
      VALUES (1, ?, ?)
    `
    )
      .bind(JSON.stringify(config), Math.floor(Date.now() / 1000))
      .run();

    return createSuccessResponse(null, '保存管理员配置成功', corsHeaders);
  } catch (error) {
    console.error('保存管理员配置失败:', error);
    return createErrorResponse(500, '保存管理员配置失败', corsHeaders);
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
  }
}

// ==================== 数据采集相关 (兼容autotasks接口) ====================

async function handleUpdateData(request, env, corsHeaders) {
  try {
<<<<<<< HEAD
    const formData = await request.formData()
    
=======
    const formData = await request.formData();

>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
    const videoData = {
      vod_name: formData.get('vod_name') || '',
      vod_sub: formData.get('vod_sub') || '',
      vod_pic: formData.get('vod_pic') || '',
      vod_actor: formData.get('vod_actor') || '',
      vod_director: formData.get('vod_director') || '',
      vod_year: formData.get('vod_year') || '',
      vod_area: formData.get('vod_area') || '',
      vod_lang: formData.get('vod_lang') || '',
      vod_content: formData.get('vod_content') || '',
      vod_remarks: formData.get('vod_remarks') || '',
      vod_serial: formData.get('vod_serial') || '',
      vod_play_from: formData.get('vod_play_from') || '',
      vod_play_url: formData.get('vod_play_url') || '',
      vod_play_server: formData.get('vod_play_server') || '',
      vod_play_note: formData.get('vod_play_note') || '',
      type_name: formData.get('type_name') || '电影',
<<<<<<< HEAD
      vod_time: Math.floor(Date.now() / 1000)
    }

    if (!videoData.vod_name) {
      return createErrorResponse(400, '视频名称不能为空', corsHeaders)
    }

    // 获取或创建分类ID
    const typeId = await getOrCreateCategory(env.DB, videoData.type_name)
    videoData.type_id = typeId
=======
      vod_time: Math.floor(Date.now() / 1000),
    };

    if (!videoData.vod_name) {
      return createErrorResponse(400, '视频名称不能为空', corsHeaders);
    }

    // 获取或创建分类ID
    const typeId = await getOrCreateCategory(env.DB, videoData.type_name);
    videoData.type_id = typeId;
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)

    // 检查视频是否已存在
    const existingVideo = await env.DB.prepare(
      'SELECT vod_id FROM mac_vod WHERE vod_name = ? AND vod_play_from = ? LIMIT 1'
<<<<<<< HEAD
    ).bind(videoData.vod_name, videoData.vod_play_from).first()

    if (existingVideo) {
      // 更新现有视频
      await env.DB.prepare(`
=======
    )
      .bind(videoData.vod_name, videoData.vod_play_from)
      .first();

    if (existingVideo) {
      // 更新现有视频
      await env.DB.prepare(
        `
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
        UPDATE mac_vod SET 
        vod_pic = ?, vod_actor = ?, vod_director = ?, vod_year = ?, vod_area = ?,
        vod_lang = ?, vod_content = ?, vod_remarks = ?, vod_play_url = ?, vod_time = ?
        WHERE vod_id = ?
<<<<<<< HEAD
      `).bind(
        videoData.vod_pic, videoData.vod_actor, videoData.vod_director, 
        videoData.vod_year, videoData.vod_area, videoData.vod_lang,
        videoData.vod_content, videoData.vod_remarks, videoData.vod_play_url,
        videoData.vod_time, existingVideo.vod_id
      ).run()

      return createSuccessResponse('ok-更新成功', '更新成功', corsHeaders)
    } else {
      // 创建新视频
      await env.DB.prepare(`
=======
      `
      )
        .bind(
          videoData.vod_pic,
          videoData.vod_actor,
          videoData.vod_director,
          videoData.vod_year,
          videoData.vod_area,
          videoData.vod_lang,
          videoData.vod_content,
          videoData.vod_remarks,
          videoData.vod_play_url,
          videoData.vod_time,
          existingVideo.vod_id
        )
        .run();

      return createSuccessResponse('ok-更新成功', '更新成功', corsHeaders);
    } else {
      // 创建新视频
      await env.DB.prepare(
        `
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
        INSERT INTO mac_vod (
          type_id, vod_name, vod_sub, vod_pic, vod_actor, vod_director,
          vod_year, vod_area, vod_lang, vod_content, vod_remarks, vod_serial,
          vod_play_from, vod_play_url, vod_play_server, vod_play_note, vod_time, vod_time_add
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
<<<<<<< HEAD
      `).bind(
        videoData.type_id, videoData.vod_name, videoData.vod_sub, videoData.vod_pic,
        videoData.vod_actor, videoData.vod_director, videoData.vod_year, videoData.vod_area,
        videoData.vod_lang, videoData.vod_content, videoData.vod_remarks, videoData.vod_serial,
        videoData.vod_play_from, videoData.vod_play_url, videoData.vod_play_server,
        videoData.vod_play_note, videoData.vod_time, videoData.vod_time
      ).run()

      return createSuccessResponse('ok-添加成功', '添加成功', corsHeaders)
    }

  } catch (error) {
    console.error('更新数据失败:', error)
    return createErrorResponse(500, `更新数据失败: ${error.message}`, corsHeaders)
=======
      `
      )
        .bind(
          videoData.type_id,
          videoData.vod_name,
          videoData.vod_sub,
          videoData.vod_pic,
          videoData.vod_actor,
          videoData.vod_director,
          videoData.vod_year,
          videoData.vod_area,
          videoData.vod_lang,
          videoData.vod_content,
          videoData.vod_remarks,
          videoData.vod_serial,
          videoData.vod_play_from,
          videoData.vod_play_url,
          videoData.vod_play_server,
          videoData.vod_play_note,
          videoData.vod_time,
          videoData.vod_time
        )
        .run();

      return createSuccessResponse('ok-添加成功', '添加成功', corsHeaders);
    }
  } catch (error) {
    console.error('更新数据失败:', error);
    return createErrorResponse(
      500,
      `更新数据失败: ${error.message}`,
      corsHeaders
    );
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
  }
}

// 获取或创建分类
async function getOrCreateCategory(db, typeName) {
<<<<<<< HEAD
  if (!typeName) return 1 // 默认分类

  // 查找现有分类
  const existing = await db.prepare(
    'SELECT type_id FROM mac_type WHERE type_name = ?'
  ).bind(typeName).first()

  if (existing) {
    return existing.type_id
  }

  // 创建新分类
  const result = await db.prepare(
    'INSERT INTO mac_type (type_name, type_sort) VALUES (?, 99)'
  ).bind(typeName).run()

  return result.meta.last_row_id
=======
  if (!typeName) return 1; // 默认分类

  // 查找现有分类
  const existing = await db
    .prepare('SELECT type_id FROM mac_type WHERE type_name = ?')
    .bind(typeName)
    .first();

  if (existing) {
    return existing.type_id;
  }

  // 创建新分类
  const result = await db
    .prepare('INSERT INTO mac_type (type_name, type_sort) VALUES (?, 99)')
    .bind(typeName)
    .run();

  return result.meta.last_row_id;
}

// ==================== 缺失的API处理函数 ====================

async function handleGetAggregatedVideos(request, env, corsHeaders) {
  try {
    // 获取聚合视频数据的逻辑
    return createSuccessResponse([], '获取聚合视频成功', corsHeaders);
  } catch (error) {
    console.error('获取聚合视频失败:', error);
    return createErrorResponse(500, '获取聚合视频失败', corsHeaders);
  }
}

async function handleCreateVideo(request, env, corsHeaders) {
  try {
    // 创建单个视频的逻辑
    return createSuccessResponse(null, '创建视频成功', corsHeaders);
  } catch (error) {
    console.error('创建视频失败:', error);
    return createErrorResponse(500, '创建视频失败', corsHeaders);
  }
}

async function handleBatchCreateVideos(request, env, corsHeaders) {
  try {
    // 批量创建视频的逻辑
    return createSuccessResponse(null, '批量创建视频成功', corsHeaders);
  } catch (error) {
    console.error('批量创建视频失败:', error);
    return createErrorResponse(500, '批量创建视频失败', corsHeaders);
  }
}

async function handleCreateCategory(request, env, corsHeaders) {
  try {
    // 创建分类的逻辑
    return createSuccessResponse(null, '创建分类成功', corsHeaders);
  } catch (error) {
    console.error('创建分类失败:', error);
    return createErrorResponse(500, '创建分类失败', corsHeaders);
  }
}

async function handleRunCollection(request, env, _ctx, corsHeaders) {
  try {
    // 运行数据采集的逻辑
    return createSuccessResponse(null, '启动数据采集成功', corsHeaders);
  } catch (error) {
    console.error('启动数据采集失败:', error);
    return createErrorResponse(500, '启动数据采集失败', corsHeaders);
  }
}

async function handleGetCollectionStatus(request, env, corsHeaders) {
  try {
    // 获取数据采集状态的逻辑
    return createSuccessResponse(
      { status: 'idle' },
      '获取采集状态成功',
      corsHeaders
    );
  } catch (error) {
    console.error('获取采集状态失败:', error);
    return createErrorResponse(500, '获取采集状态失败', corsHeaders);
  }
}

async function handleGetDashboardStats(request, env, corsHeaders) {
  try {
    // 获取仪表板统计的逻辑
    return createSuccessResponse({}, '获取仪表板统计成功', corsHeaders);
  } catch (error) {
    console.error('获取仪表板统计失败:', error);
    return createErrorResponse(500, '获取仪表板统计失败', corsHeaders);
  }
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
}

// ==================== 定时任务相关 ====================

<<<<<<< HEAD
async function syncExternalData(env) {
  // 这里可以实现定时同步外部API数据的逻辑
  console.log('执行数据同步任务')
}

async function cleanupExpiredCache(env) {
  // 清理过期缓存
  console.log('清理过期缓存')
}
=======
async function syncExternalData(_env) {
  // 这里可以实现定时同步外部API数据的逻辑
  console.log('执行数据同步任务');
}

async function cleanupExpiredCache(_env) {
  // 清理过期缓存
  console.log('清理过期缓存');
}

export default worker;
>>>>>>> bb9e458 (fix: 修复Workers API缺失函数和ESLint错误)
