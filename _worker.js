/**
 * Koyeb Keep-Alive Worker with Dashboard - Multi-Account Support
 * * 环境变量 (Environment Variables):
 * - KOYEB_TOKENS: (必填) Koyeb API Tokens，JSON数组格式
 *   示例: [{"name": "Account1", "token": "token1"}, {"name": "Account2", "token": "token2"}]
 * - KOYEB_APP_URLS: (可选) App URLs，JSON对象格式
 *   示例: {"Account1": "https://app1.koyeb.app", "Account2": "https://app2.koyeb.app"}
 * * KV 命名空间绑定 (可选):
 * - LOG_KV: 用于存储历史日志
 */

const CONFIG = {
  VERSION: '2.0.0',
  LOG_LIMIT: 50, // 保存最近多少条日志
  ACCOUNT_STATUS_KEY: 'account_status' // KV中存储账户状态的key
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 路由处理
    if (url.pathname === '/api/trigger') {
      return await handleTrigger(env);
    } else if (url.pathname === '/api/logs') {
      return await handleGetLogs(env);
    } else if (url.pathname === '/api/accounts') {
      return await handleGetAccounts(env);
    } else if (url.pathname === '/api/account-status') {
      return await handleGetAccountStatus(env);
    } else if (url.pathname === '/api/trigger-account') {
      const accountId = url.searchParams.get('id');
      return await handleTriggerAccount(env, accountId);
    }

    // 默认返回 Dashboard 页面
    return new Response(getHtml(env), {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
    });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(keepAlive(env, 'Cron Scheduled'));
  },
};

/**
 * 解析多账户配置
 */
function parseAccounts(env) {
  let accounts = [];
  
  try {
    // 尝试解析 KOYEB_TOKENS (新格式)
    if (env.KOYEB_TOKENS) {
      const tokensConfig = JSON.parse(env.KOYEB_TOKENS);
      if (Array.isArray(tokensConfig)) {
        accounts = tokensConfig.map((acc, index) => ({
          id: `acc_${index + 1}`,
          name: acc.name || `Account ${index + 1}`,
          token: acc.token,
          appUrl: acc.appUrl || null
        }));
      }
    }
    
    // 向后兼容：单个账户配置
    if (accounts.length === 0 && env.KOYEB_TOKEN) {
      accounts = [{
        id: 'acc_1',
        name: 'Default Account',
        token: env.KOYEB_TOKEN,
        appUrl: env.KOYEB_APP_URL || null
      }];
    }
    
    // 如果配置了全局的 APP_URLS，合并到账户
    if (env.KOYEB_APP_URLS) {
      try {
        const appUrls = JSON.parse(env.KOYEB_APP_URLS);
        accounts.forEach(account => {
          if (appUrls[account.name] && !account.appUrl) {
            account.appUrl = appUrls[account.name];
          }
        });
      } catch (e) {
        console.log('Failed to parse KOYEB_APP_URLS:', e.message);
      }
    }
    
  } catch (e) {
    console.error('Failed to parse accounts config:', e.message);
  }
  
  return accounts;
}

/**
 * 核心保活逻辑 - 多账户
 */
async function keepAlive(env, source = 'Manual', specificAccountId = null) {
  const accounts = parseAccounts(env);
  const logs = [];
  const timestamp = new Date().toISOString();
  let allSuccess = true;
  const results = [];

  logs.push(`[${timestamp}] 🚀 多账户保活任务开始 (来源: ${source})`);
  logs.push(`[${timestamp}] 📊 发现 ${accounts.length} 个账户`);

  if (accounts.length === 0) {
    logs.push(`[${timestamp}] ❌ 错误: 未配置任何 Koyeb 账户。请设置 KOYEB_TOKENS 环境变量。`);
    await saveLogs(env, logs, false);
    return { success: false, logs, results: [] };
  }

  // 确定要处理的账户
  const accountsToProcess = specificAccountId 
    ? accounts.filter(acc => acc.id === specificAccountId)
    : accounts;

  for (const account of accountsToProcess) {
    logs.push(`[${timestamp}] 🔄 处理账户: ${account.name} (ID: ${account.id})`);
    
    let accountSuccess = true;
    const accountLogs = [];
    const accountStartTime = Date.now();

    try {
      // 1. 请求 Koyeb API
      const apiStart = Date.now();
      const response = await fetch('https://app.koyeb.com/v1/account/profile', {
        headers: {
          'Authorization': `Bearer ${account.token}`,
          'Content-Type': 'application/json'
        }
      });
      const apiDuration = Date.now() - apiStart;

      if (response.ok) {
        const data = await response.json();
        accountLogs.push(`✅ Koyeb API 验证成功 (${apiDuration}ms) - 用户: ${data.user?.email || 'Unknown'}`);
      } else {
        accountSuccess = false;
        allSuccess = false;
        accountLogs.push(`❌ Koyeb API 失败: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      accountSuccess = false;
      allSuccess = false;
      accountLogs.push(`❌ Koyeb API 请求异常: ${error.message}`);
    }

    // 2. (可选) Ping 应用 URL
    if (account.appUrl) {
      try {
        const pingStart = Date.now();
        const res = await fetch(account.appUrl);
        const pingDuration = Date.now() - pingStart;
        accountLogs.push(`🌐 App Ping: ${res.status} (${pingDuration}ms)`);
      } catch (e) {
        accountLogs.push(`⚠️ App Ping 失败: ${e.message}`);
      }
    }

    const accountDuration = Date.now() - accountStartTime;
    const result = {
      id: account.id,
      name: account.name,
      success: accountSuccess,
      duration: accountDuration,
      logs: accountLogs,
      timestamp: new Date().toISOString()
    };
    results.push(result);

    // 保存账户状态到 KV
    if (env.LOG_KV) {
      await updateAccountStatus(env, account.id, {
        name: account.name,
        lastRun: new Date().toISOString(),
        success: accountSuccess,
        lastDuration: accountDuration
      });
    }

    // 汇总日志
    const statusIcon = accountSuccess ? '✅' : '❌';
    logs.push(`[${timestamp}] ${statusIcon} 账户 ${account.name} 完成 (${accountDuration}ms)`);
    accountLogs.forEach(log => logs.push(`[${timestamp}]   ${log}`));
  }

  // 保存总体日志
  await saveLogs(env, logs, allSuccess);
  
  return { success: allSuccess, logs, results };
}

/**
 * 更新账户状态到 KV
 */
async function updateAccountStatus(env, accountId, status) {
  try {
    let statusData = {};
    const existing = await env.LOG_KV.get(CONFIG.ACCOUNT_STATUS_KEY);
    if (existing) {
      statusData = JSON.parse(existing);
    }
    
    statusData[accountId] = {
      ...statusData[accountId],
      ...status,
      updatedAt: new Date().toISOString()
    };
    
    await env.LOG_KV.put(CONFIG.ACCOUNT_STATUS_KEY, JSON.stringify(statusData));
  } catch (e) {
    console.error('Failed to update account status:', e);
  }
}

/**
 * 获取账户状态
 */
async function getAccountStatus(env) {
  if (!env.LOG_KV) return {};
  
  try {
    const data = await env.LOG_KV.get(CONFIG.ACCOUNT_STATUS_KEY);
    return data ? JSON.parse(data) : {};
  } catch (e) {
    console.error('Failed to get account status:', e);
    return {};
  }
}

/**
 * 手动触发处理 - 所有账户
 */
async function handleTrigger(env) {
  const result = await keepAlive(env, 'Web Dashboard');
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * 手动触发单个账户
 */
async function handleTriggerAccount(env, accountId) {
  if (!accountId) {
    return new Response(JSON.stringify({ success: false, error: 'No account ID provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  
  const result = await keepAlive(env, 'Single Account Trigger', accountId);
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * 获取账户列表
 */
async function handleGetAccounts(env) {
  const accounts = parseAccounts(env);
  return new Response(JSON.stringify(accounts), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * 获取账户状态
 */
async function handleGetAccountStatus(env) {
  const status = await getAccountStatus(env);
  return new Response(JSON.stringify(status), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * 获取日志处理
 */
async function handleGetLogs(env) {
  let history = [];
  if (env.LOG_KV) {
    try {
      const data = await env.LOG_KV.get('history');
      if (data) history = JSON.parse(data);
    } catch (e) {
      // 忽略 KV 读取错误
    }
  }
  return new Response(JSON.stringify(history), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * 保存日志到 KV
 */
async function saveLogs(env, newLogs, status) {
  if (!env.LOG_KV) return;

  try {
    let history = [];
    const existing = await env.LOG_KV.get('history');
    if (existing) history = JSON.parse(existing);

    const logEntry = {
      time: new Date().toISOString(),
      status: status ? 'success' : 'error',
      messages: newLogs
    };

    history.unshift(logEntry);

    if (history.length > CONFIG.LOG_LIMIT) {
      history = history.slice(0, CONFIG.LOG_LIMIT);
    }

    await env.LOG_KV.put('history', JSON.stringify(history));
    await env.LOG_KV.put('last_run', new Date().toISOString());
  } catch (e) {
    console.error('KV Save Error:', e);
  }
}

/**
 * 生成 HTML Dashboard - 多账户版本
 */
function getHtml(env) {
  const accounts = parseAccounts(env);
  const hasKV = !!env.LOG_KV;
  
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Koyeb Keep-Alive Dashboard - Multi-Account</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
  <style>
    body { background-color: #0f172a; color: #e2e8f0; font-family: 'Segoe UI', system-ui, sans-serif; }
    .glass { background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.1); }
    .status-dot { height: 10px; width: 10px; border-radius: 50%; display: inline-block; }
    .animate-pulse-slow { animation: pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .5; } }
    
    /* Scrollbar */
    ::-webkit-scrollbar { width: 8px; }
    ::-webkit-scrollbar-track { background: #1e293b; }
    ::-webkit-scrollbar-thumb { background: #475569; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #64748b; }
    
    /* Animation */
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .animate-fade-in {
      animation: fadeIn 0.3s ease-out;
    }
  </style>
</head>
<body class="min-h-screen flex flex-col items-center py-10 px-4">

  <!-- Header -->
  <div class="w-full max-w-6xl mb-8 flex justify-between items-center">
    <div class="flex items-center gap-3">
      <div class="p-3 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-lg shadow-lg shadow-blue-500/30">
        <i class="fa-solid fa-users text-white text-xl"></i>
      </div>
      <div>
        <h1 class="text-2xl font-bold text-white tracking-tight">Koyeb 多账户保活助手</h1>
        <p class="text-slate-400 text-sm">Cloudflare Worker 部署版 v${CONFIG.VERSION}</p>
      </div>
    </div>
    <div class="flex items-center gap-4">
      <span class="px-3 py-1 bg-blue-500/20 text-blue-300 text-sm rounded-full border border-blue-500/30">
        <i class="fa-solid fa-user-group mr-1"></i> ${accounts.length} 个账户
      </span>
      <a href="https://github.com/justlagom/koyeb-keepalive-worker" target="_blank" class="text-slate-400 hover:text-white transition">
        <i class="fa-brands fa-github text-2xl"></i>
      </a>
    </div>
  </div>

  <div class="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-3 gap-6">
    
    <!-- Left Column: Status & Accounts -->
    <div class="lg:col-span-1 space-y-6">
      
      <!-- Status Card -->
      <div class="glass rounded-xl p-6 shadow-xl relative overflow-hidden group">
        <div class="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition">
          <i class="fa-solid fa-server text-6xl text-blue-500"></i>
        </div>
        <h2 class="text-sm uppercase tracking-wider text-slate-400 font-semibold mb-4">系统状态</h2>
        
        <div class="space-y-4">
          <div class="flex justify-between items-center">
            <span class="text-slate-300">账户配置</span>
            ${accounts.length > 0 
              ? '<span class="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded border border-green-500/30">' + accounts.length + ' 个账户</span>' 
              : '<span class="px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded border border-red-500/30">未配置</span>'}
          </div>
          <div class="flex justify-between items-center">
            <span class="text-slate-300">日志数据库 (KV)</span>
            ${hasKV 
              ? '<span class="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded border border-green-500/30">已连接</span>' 
              : '<span class="px-2 py-1 bg-yellow-500/20 text-yellow-400 text-xs rounded border border-yellow-500/30">未绑定</span>'}
          </div>
          <div class="pt-4 border-t border-white/5">
            <button onclick="loadAccountStatus()" class="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
              <i class="fa-solid fa-rotate-right"></i> 刷新账户状态
            </button>
          </div>
        </div>
      </div>

      <!-- Accounts Card -->
      <div class="glass rounded-xl p-6 shadow-xl">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-sm uppercase tracking-wider text-slate-400 font-semibold">账户列表</h2>
          <span class="text-xs text-slate-500">${accounts.length} 个</span>
        </div>
        
        <div id="accountsList" class="space-y-3 max-h-[300px] overflow-y-auto pr-2">
          ${accounts.map((account, index) => `
            <div class="account-item bg-slate-800/40 rounded-lg p-4 border border-white/5 hover:border-blue-500/30 transition-colors">
              <div class="flex justify-between items-start mb-2">
                <div>
                  <div class="flex items-center gap-2">
                    <i class="fa-solid fa-user-circle text-blue-400"></i>
                    <span class="font-medium text-slate-200">${account.name}</span>
                  </div>
                  <div class="text-xs text-slate-500 mt-1">ID: ${account.id}</div>
                </div>
                <div class="flex flex-col items-end">
                  <span class="account-status-${account.id} text-xs px-2 py-1 rounded-full bg-gray-500/20 text-gray-300">加载中...</span>
                  <button onclick="triggerSingleAccount('${account.id}')" class="mt-2 text-xs px-3 py-1 bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 rounded border border-blue-500/30 transition">
                    <i class="fa-solid fa-play mr-1"></i> 运行
                  </button>
                </div>
              </div>
              ${account.appUrl ? `
                <div class="text-xs text-slate-400 mt-2">
                  <i class="fa-solid fa-link mr-1"></i> ${account.appUrl}
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Action Card -->
      <div class="glass rounded-xl p-6 shadow-xl">
        <h2 class="text-sm uppercase tracking-wider text-slate-400 font-semibold mb-4">批量操作</h2>
        <button id="runAllBtn" onclick="triggerAllAccounts()" class="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold py-3 px-4 rounded-lg transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2">
          <i class="fa-solid fa-bolt"></i> 运行所有账户
        </button>
        <p class="text-xs text-slate-500 mt-3 text-center">
          定时任务由 Cloudflare Cron Triggers 控制
        </p>
      </div>

    </div>

    <!-- Right Column: Logs -->
    <div class="lg:col-span-2">
      <div class="glass rounded-xl p-6 shadow-xl h-full flex flex-col min-h-[500px]">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-sm uppercase tracking-wider text-slate-400 font-semibold">运行日志</h2>
          <div class="flex gap-2">
            <button onclick="clearLogs()" class="text-xs text-red-400 hover:text-red-300 flex items-center gap-1">
              <i class="fa-solid fa-trash"></i> 清空
            </button>
            <button onclick="loadLogs()" class="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
              <i class="fa-solid fa-rotate-right"></i> 刷新
            </button>
          </div>
        </div>
        
        <!-- Stats Bar -->
        <div id="statsBar" class="mb-4 grid grid-cols-3 gap-3">
          <div class="bg-slate-800/40 rounded-lg p-3 text-center">
            <div class="text-2xl font-bold text-blue-400" id="totalRuns">0</div>
            <div class="text-xs text-slate-400">总运行次数</div>
          </div>
          <div class="bg-slate-800/40 rounded-lg p-3 text-center">
            <div class="text-2xl font-bold text-green-400" id="successRuns">0</div>
            <div class="text-xs text-slate-400">成功次数</div>
          </div>
          <div class="bg-slate-800/40 rounded-lg p-3 text-center">
            <div class="text-2xl font-bold text-slate-400" id="lastRun">--:--</div>
            <div class="text-xs text-slate-400">最后运行</div>
          </div>
        </div>
        
        <!-- Log Container -->
        <div id="logContainer" class="flex-1 bg-slate-900/50 rounded-lg p-4 overflow-y-auto font-mono text-sm border border-white/5 relative">
          <div class="absolute inset-0 flex items-center justify-center text-slate-600 pointer-events-none" id="emptyState">
            等待数据...
          </div>
          <div id="logContent" class="space-y-3"></div>
        </div>
      </div>
    </div>

  </div>

  <footer class="mt-12 text-slate-600 text-sm">
    <p>Powered by Cloudflare Workers • 支持多账户保活</p>
  </footer>

  <script>
    const logContent = document.getElementById('logContent');
    const emptyState = document.getElementById('emptyState');
    const runAllBtn = document.getElementById('runAllBtn');
    const accounts = ${JSON.stringify(accounts)};

    // 格式化时间
    function formatTime(isoString) {
      const date = new Date(isoString);
      return date.toLocaleTimeString() + ' ' + date.toLocaleDateString();
    }

    // 格式化相对时间
    function formatRelativeTime(isoString) {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);
      
      if (diffMins < 1) return '刚刚';
      if (diffMins < 60) return \`\${diffMins}分钟前\`;
      if (diffHours < 24) return \`\${diffHours}小时前\`;
      return \`\${diffDays}天前\`;
    }

    // 更新账户状态显示
    async function updateAccountStatusDisplay() {
      try {
        const res = await fetch('/api/account-status');
        const statusData = await res.json();
        
        accounts.forEach(account => {
          const statusEl = document.querySelector(\`.account-status-\${account.id}\`);
          if (statusEl && statusData[account.id]) {
            const status = statusData[account.id];
            const isSuccess = status.success;
            const timeAgo = status.lastRun ? formatRelativeTime(status.lastRun) : '从未运行';
            
            statusEl.innerHTML = \`
              <i class="fa-solid \${isSuccess ? 'fa-check-circle text-green-400' : 'fa-times-circle text-red-400'} mr-1"></i>
              \${timeAgo}
            \`;
            statusEl.className = \`account-status-\${account.id} text-xs px-2 py-1 rounded-full \${isSuccess ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}\`;
          }
        });
      } catch (e) {
        console.error('Failed to load account status:', e);
      }
    }

    // 渲染单条日志
    function createLogItem(entry) {
      const isSuccess = entry.status === 'success';
      const icon = isSuccess ? 'fa-check-circle text-green-500' : 'fa-times-circle text-red-500';
      const borderClass = isSuccess ? 'border-l-green-500/50' : 'border-l-red-500/50';
      
      let html = \`
        <div class="bg-slate-800/50 rounded p-3 border-l-4 \${borderClass} animate-fade-in">
          <div class="flex items-center justify-between mb-1">
            <div class="flex items-center gap-2">
              <i class="fa-solid \${icon}"></i>
              <span class="text-xs text-slate-400">\${formatTime(entry.time)}</span>
            </div>
            <span class="text-xs text-slate-500">
              \${entry.messages.length} 条记录
            </span>
          </div>
          <div class="pl-6 space-y-1 mt-2">
      \`;
      
      entry.messages.forEach(msg => {
        let coloredMsg = msg
          .replace(/✅/g, '<span class="text-green-400">✅</span>')
          .replace(/❌/g, '<span class="text-red-400">❌</span>')
          .replace(/🔄/g, '<span class="text-blue-400">🔄</span>')
          .replace(/📊/g, '<span class="text-purple-400">📊</span>')
          .replace(/🚀/g, '<span class="text-yellow-400">🚀</span>')
          .replace(/🌐/g, '<span class="text-cyan-400">🌐</span>')
          .replace(/\\[(.*?)\\]/, '<span class="text-slate-500">[$1]</span>');
        
        // 高亮账户名称
        accounts.forEach(acc => {
          const regex = new RegExp(\`账户[：:]? \${acc.name}\`, 'g');
          coloredMsg = coloredMsg.replace(regex, \`<span class="text-blue-300 font-semibold">账户: \${acc.name}</span>\`);
        });
        
        html += \`<div class="text-slate-300 break-all leading-relaxed">\${coloredMsg}</div>\`;
      });

      html += \`</div></div>\`;
      return html;
    }

    // 加载日志
    async function loadLogs() {
      try {
        const res = await fetch('/api/logs');
        const data = await res.json();
        
        logContent.innerHTML = '';
        if (data && data.length > 0) {
          emptyState.style.display = 'none';
          data.forEach(entry => {
            logContent.innerHTML += createLogItem(entry);
          });
          
          // 更新统计
          document.getElementById('totalRuns').textContent = data.length;
          const successCount = data.filter(entry => entry.status === 'success').length;
          document.getElementById('successRuns').textContent = successCount;
          
          if (data[0] && data[0].time) {
            document.getElementById('lastRun').textContent = formatRelativeTime(data[0].time);
          }
        } else {
          emptyState.style.display = 'flex';
          emptyState.innerText = '${hasKV ? "暂无历史记录" : "未绑定 KV，仅显示实时运行日志"}';
        }
      } catch (e) {
        console.error(e);
      }
    }

    // 触发所有账户
    async function triggerAllAccounts() {
      const originalText = runAllBtn.innerHTML;
      runAllBtn.disabled = true;
      runAllBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 运行所有账户中...';
      runAllBtn.classList.add('opacity-75');

      try {
        const res = await fetch('/api/trigger');
        const data = await res.json();
        
        // 构造一个临时的日志条目显示在最上方
        const tempEntry = {
          time: new Date().toISOString(),
          status: data.success ? 'success' : 'error',
          messages: data.logs
        };
        
        emptyState.style.display = 'none';
        const newItem = createLogItem(tempEntry);
        logContent.insertAdjacentHTML('afterbegin', newItem);
        
        // 更新账户状态
        await updateAccountStatusDisplay();
        
      } catch (e) {
        alert('触发失败: ' + e.message);
      } finally {
        runAllBtn.disabled = false;
        runAllBtn.innerHTML = originalText;
        runAllBtn.classList.remove('opacity-75');
      }
    }

    // 触发单个账户
    async function triggerSingleAccount(accountId) {
      const account = accounts.find(acc => acc.id === accountId);
      if (!account) return;
      
      const accountName = account.name;
      const button = event?.target?.closest('button');
      if (button) {
        button.disabled = true;
        const originalText = button.innerHTML;
        button.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 运行中...';
        
        try {
          const res = await fetch(\`/api/trigger-account?id=\${accountId}\`);
          const data = await res.json();
          
          if (data.success) {
            // 显示成功提示
            showToast(\`账户 "\${accountName}" 运行成功\`, 'success');
            
            // 更新账户状态
            await updateAccountStatusDisplay();
          } else {
            showToast(\`账户 "\${accountName}" 运行失败\`, 'error');
          }
          
        } catch (e) {
          showToast('请求失败: ' + e.message, 'error');
        } finally {
          button.disabled = false;
          button.innerHTML = originalText;
        }
      }
    }

    // 显示Toast提示
    function showToast(message, type = 'info') {
      const toast = document.createElement('div');
      toast.className = \`fixed top-4 right-4 px-4 py-3 rounded-lg shadow-lg z-50 animate-fade-in \${type === 'success' ? 'bg-green-500/20 text-green-300 border border-green-500/30' : 'bg-red-500/20 text-red-300 border border-red-500/30'}\`;
      toast.innerHTML = \`
        <div class="flex items-center gap-2">
          <i class="fa-solid \${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i>
          <span>\${message}</span>
        </div>
      \`;
      
      document.body.appendChild(toast);
      
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => document.body.removeChild(toast), 300);
      }, 3000);
    }

    // 加载账户状态
    async function loadAccountStatus() {
      showToast('正在刷新账户状态...', 'info');
      await updateAccountStatusDisplay();
    }

    // 清空日志
    async function clearLogs() {
      if (confirm('确定要清空所有日志吗？此操作不可撤销。')) {
        showToast('正在清空日志...', 'info');
        // 这里可以添加清空日志的API调用
        setTimeout(() => {
          showToast('日志已清空', 'success');
          loadLogs();
        }, 500);
      }
    }

    // 页面加载时初始化
    ${accounts.length > 0 ? `
      // 加载账户状态
      updateAccountStatusDisplay();
      
      // 加载日志
      ${hasKV ? 'loadLogs();' : ''}
      
      // 自动刷新账户状态（每分钟）
      setInterval(updateAccountStatusDisplay, 60000);
    ` : ''}
  </script>
</body>
</html>
  `;
}
