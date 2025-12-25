
### 步骤 1: 配置 Worker 环境变量

在 Cloudflare Worker 的设置中，您需要配置以下环境变量：

| 变量名 | 描述 | 示例值 |
| :--- | :--- | :--- |
| **`TARGET_URL`** | 您在 Koyeb 部署的服务 URL。 | `https://koyebne-xxxxx.koyeb.app` |
| **`AUTH_TOKEN`** | 用于 Worker 身份验证的密钥。**自行获取koyeb账户所提供的token** | `your-token` |

### 步骤 2: 配置 Worker 定时任务 (Cron Trigger)

在 Cloudflare Worker 的设置中，配置 **Cron Trigger** (定时任务)，例如每隔 **5 分钟** 触发一次。

  * **Cron 表达式示例 (每天一次登录账户保活):** `0 0 * * *`
