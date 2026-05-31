# 美发工具调研 · 后端部署指南

## 项目结构

```
survey-backend/
├── server.js          # Express 后端
├── package.json       # 依赖配置
├── data/
│   └── responses.json # 回复数据（自动生成）
└── public/
    └── survey.html    # 问卷前端（4语言）
```

---

## 快速启动（本地测试）

```bash
# 1. 安装依赖
npm install

# 2. 启动服务
npm start

# 3. 访问
# 问卷：http://localhost:3000/survey
# 后台：http://localhost:3000/admin?password=survey2024
```

---

## 线上部署方案

### 方案 A：Railway（推荐，免费额度够用）

1. 注册 https://railway.app
2. 点击 「New Project → Deploy from GitHub」
3. 上传本项目文件夹到 GitHub
4. Railway 自动检测 Node.js 并部署
5. 在 Railway 的 Variables 里设置：
   ```
   PORT=3000
   ADMIN_PASSWORD=你的管理密码
   ```
6. 部署完成后获得域名，如：`https://your-app.railway.app`
7. 问卷地址：`https://your-app.railway.app/survey`

### 方案 B：Render（免费）

1. 注册 https://render.com
2. New → Web Service → Connect Repository
3. Build Command: `npm install`
4. Start Command: `npm start`
5. 设置环境变量 `ADMIN_PASSWORD`

### 方案 C：VPS（阿里云/腾讯云等）

```bash
# 服务器上安装 Node.js 和 PM2
npm install -g pm2

# 上传文件后
npm install
pm2 start server.js --name survey
pm2 save
pm2 startup

# 配置 Nginx 反代（可选）
# 或直接开放 3000 端口
```

---

## 管理后台功能

| 功能 | 地址 |
|------|------|
| 问卷页面 | `/survey` |
| 管理后台 | `/admin?password=YOUR_PASSWORD` |
| 导出 CSV | `/api/export.csv?password=YOUR_PASSWORD` |
| 统计数据（JSON） | `/api/stats?password=YOUR_PASSWORD` |
| 全部回复（JSON） | `/api/responses?password=YOUR_PASSWORD` |

---

## 修改管理密码

默认密码：`survey2024`

部署时设置环境变量：
```
ADMIN_PASSWORD=你的新密码
```

或直接修改 server.js 第 8 行：
```js
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '你的新密码';
```

---

## CSV 导出字段说明

| 字段 | 说明 |
|------|------|
| `id` | 唯一回复 ID |
| `lang` | 语言（zh/en/ar/ru） |
| `submittedAt` | 提交时间（ISO 格式） |
| `ip` | 用户 IP |
| `S1` | 筛选题答案（0-3，3=不符合条件被拦截） |
| `Q1`–`Q25` | 各题答案（数字=选项序号，对象=矩阵/排序） |

**注意**：多选题的值为数组（如 `[0,2,4]`），矩阵题为对象（如 `{"0":1,"1":3}`），CSV 中用 `|` 分隔。

---

## 数据备份

回复数据保存在 `data/responses.json`。
建议定期下载备份，或通过 `/api/export.csv` 导出 Excel 可读的 CSV 文件。
