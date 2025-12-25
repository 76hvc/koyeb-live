一、环境变量配置
1. 必需环境变量
多账户配置（推荐）：
json
KOYEB_TOKENS = [
  {
    "name": "个人账户",
    "token": "your_koyeb_token_1_here",
    "appUrl": "https://your-app-1.koyeb.app"  // 可选
  },
  {
    "name": "工作账户", 
    "token": "your_koyeb_token_2_here",
    "appUrl": "https://your-app-2.koyeb.app"  // 可选
  },
  {
    "name": "备用账户",
    "token": "your_koyeb_token_3_here"
    // 可以不提供 appUrl
  }
]
单个账户配置（向后兼容）：
text
KOYEB_TOKEN = your_koyeb_token_here
KOYEB_APP_URL = https://your-app.koyeb.app  // 可选
2. 可选环境变量
json
KOYEB_APP_URLS = {
  "个人账户": "https://app1.koyeb.app",
  "工作账户": "https://app2.koyeb.app"
}
注意：此配置会覆盖账户配置中的 appUrl

二、Koyeb API Token 获取步骤
登录 Koyeb 控制台

访问：https://app.koyeb.com

进入 API Token 页面

点击右上角头像 → "Account Settings"

左侧菜单选择 "API Tokens"

创建新的 Token

点击 "Create a new token"

输入 Token 名称（如：KeepAlive-Worker）

选择权限（最少需要 user:read 权限）

点击 "Create token"

复制生成的 Token（只显示一次）

重复步骤 3 为每个账户创建独立的 Token

三、Cloudflare Workers 网页端部署步骤
步骤 1：创建 Worker
登录 Cloudflare Dashboard：https://dash.cloudflare.com

左侧菜单点击 "Workers & Pages"

点击 "Create application" → "Create Worker"

输入 Worker 名称（如：koyeb-keepalive）

点击 "Deploy"

步骤 2：配置环境变量
在 Worker 编辑页面，点击 "Settings" 选项卡

左侧选择 "Variables"

添加环境变量：

变量名	变量值	说明
KOYEB_TOKENS	粘贴上面的 JSON 数组	必填，多账户配置
或 KOYEB_TOKEN	单个 Token 字符串	单账户配置（选一种）
步骤 3：创建并绑定 KV 命名空间
创建 KV 命名空间：

左侧菜单点击 "Workers & Pages"

选择 "KV" 选项卡

点击 "Create namespace"

输入名称（如：KOYEB_LOGS）

点击 "Add"

绑定到 Worker：

返回 Worker 编辑页面

"Settings" → "Variables"

滚动到 "KV Namespace Bindings"

点击 "Add binding"

Variable name: LOG_KV

KV namespace: 选择刚才创建的命名空间

点击 "Save"

步骤 4：配置定时触发器（Cron Trigger）
在 Worker 编辑页面，点击 "Triggers" 选项卡

找到 "Cron Triggers" 部分

点击 "Add cron trigger"

推荐配置：

Cron expression: */15 * * * * （每15分钟运行一次）

或 */30 * * * * （每30分钟运行一次）

步骤 5：部署代码
返回 "Quick edit" 或 "Edit code"

清空默认代码

粘贴完整的多账户 Worker 代码

点击 "Save and deploy"

四、验证部署
1. 访问 Dashboard
Worker 部署后，会显示一个域名（如：koyeb-keepalive.your-username.workers.dev）

访问该域名，应该看到多账户 Dashboard 界面

2. 检查账户状态
Dashboard 应该显示配置的账户数量

每个账户的状态应显示为 "从未运行" 或 "加载中..."

3. 测试手动触发
点击 "运行所有账户"

观察日志区域是否显示运行结果

单独点击某个账户的 "运行" 按钮

检查账户状态是否更新

4. 验证定时任务
等待设定的时间间隔（如15分钟）

刷新页面查看是否有新的运行日志

检查账户状态时间戳是否更新
