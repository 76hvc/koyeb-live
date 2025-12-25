
### 步骤 1: 配置 Worker 环境变量

在 Cloudflare Worker 的设置中，您需要配置以下环境变量：
// 多账户配置（3个账户）
KOYEB_TOKENS = [
  {
    "name": "个人博客",
    "token": "koyeb_v1_your_token_123456",
    "appUrl": "https://my-blog.koyeb.app"
  },
  {
    "name": "在线商店",
    "token": "koyeb_v1_another_token_789012",
    "appUrl": "https://shop.koyeb.app"
  },
  {
    "name": "测试环境",
    "token": "koyeb_v1_test_token_345678"
  }
]

// 可选：KV 绑定已在界面配置，变量名LOG_KV

### 步骤 2: 配置 Worker 定时任务 (Cron Trigger)

在 Cloudflare Worker 的设置中，配置 **Cron Trigger** (定时任务)，例如每隔 **5 分钟** 触发一次。

  * **Cron 表达式示例 (每天一次登录账户保活):** `0 0 * * *`
