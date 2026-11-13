# 云函数部署手册（微信云开发 / 腾讯云 CloudBase）

> 项目：摸鱼资讯 `C:\webapp\happy-work\news`
> 目标：把数据链路跑通。**先看你走哪种模式**，下文第 0~5 节是模式 C 的完整流程。

---

## 三种运行模式（按成本从低到高）

| | 模式 A：纯静态 | 模式 B：云函数直出 | 模式 C：数据库 + 定时 |
|---|---|---|---|
| 数据位置 | 小程序包内 `data/hot.js` | 云函数内存缓存，返回给前端 | 云数据库 `groups` 集合 |
| 云开发 | **不需要**（游客模式也能跑） | 需要（不用建库） | 需要 + 建库 |
| 成本 | 0 | 仅云函数调用 + 出流量 | 云函数 + 数据库读写 + 容量 |
| 内容时效 | **发版才更新** | 5 分钟内 | 5 分钟内 |
| 命令 | `node scripts/build-data.js` | 部署 `getHot` | 部署 `fetchNews` |
| 适用 | 先看效果、内测、演示 | 已上线但不想用数据库 | 需要历史快照/运营后台 |

配置入口：`miniprogram/utils/config.js` 的 `dataMode`

```js
dataMode: 'static'   // 模式 A：不调云函数，只读包内数据
dataMode: 'auto'     // 模式 B/C：先调云函数 getHot，失败静默回落包内数据
```

取数顺序（`utils/data-source.js` 实现，已本地实测通过）：

```
本地 Storage 缓存（10 分钟内，0 请求）
   ↓ 过期/强制刷新
云函数 getHot（实例内存缓存 5 分钟）
   ↓ 失败
包内 data/hot.js（永远可用）
```

> 模式 C 的 `fetchNews` 仍保留在项目里，但前端已不读数据库。要用回数据库模式，需把 `index.js` 的 `loadGroups` 换回数据库查询。

---

## 0. 先明确一件事

**微信云开发 = 腾讯云 CloudBase 的微信侧形态**，底层就是腾讯云，不需要另外注册腾讯云账号、不需要买服务器。

| 方案 | 是否适用本项目 |
|---|---|
| 微信开发者工具里的「云开发」（推荐） | ✅ 直接用，openapi、数据库权限、定时触发器全打通 |
| 腾讯云 CloudBase 控制台 | ✅ 同一套环境，可查看日志/监控/改函数配置，用微信扫码登录 |
| 腾讯云独立 CloudBase（新建环境、非微信授权） | ❌ 不适用，拿不到小程序 openapi 与数据库鉴权 |

---

## 1. 前置检查（项目已具备）

| 文件 | 应有内容 | 状态 |
|---|---|---|
| `project.config.json` | `"cloudfunctionRoot": "cloudfunctions/"` | ✅ 已配 |
| `project.config.json` | `"appid"` 为真实 AppID | ⚠️ 当前是 `touristappid`，需替换 |
| `miniprogram/utils/config.js` | `envId` 填云环境 ID | ⚠️ 当前为空 |
| `cloudfunctions/fetchNews/package.json` | 依赖 `wx-server-sdk` | ✅ 已配 |

---

## 2. 开通云开发环境（一次性）

1. 用**微信开发者工具**打开 `C:\webapp\happy-work\news`
2. 点顶部工具栏 **「云开发」** 按钮
3. 首次会提示开通 → 同意协议 → 选择套餐（基础版/按量付费，**具体计费以控制台公示为准**）
4. 创建环境：填环境名称（如 `news-prod`）→ 创建完成后记下**环境 ID**（形如 `news-prod-8gk1b2c3d`）
5. 回到代码，把环境 ID 填进 `miniprogram/utils/config.js` 的 `envId`

> 想确认能不能在腾讯云侧看到：打开 CloudBase 控制台 → 用微信扫码登录 → 环境列表里会出现「微信小程序」类型的环境。以控制台实际入口为准。

---

## 3. 建数据库集合

云开发控制台 → **数据库** → 新建集合：

| 集合名 | 权限设置 | 用途 |
|---|---|---|
| `groups` | **所有用户可读，仅创建者可写** | 6 条分组文档，前端直接读 |
| `snapshot` | 仅创建者可读写 | 抓取记录，排障用 |

> `groups` 权限必须放开读，否则小程序端 `wx.cloud.database().collection('groups').get()` 会返回空。

---

## 4. 部署云函数

1. 在开发者工具左侧文件树找到 `cloudfunctions/fetchNews`
2. **右键 → 上传并部署：云端安装依赖（不上传 node_modules）**
3. 首次部署会云端装 `wx-server-sdk`，等待 30s～2min
4. 部署成功后控制台提示「上传成功」

**⚠️ 部署后立刻改超时时间**（最容易踩的坑）：

云开发控制台 → 云函数 → `fetchNews` → 配置 → **超时时间改为 20 秒**

默认 3 秒不够：抓 momoyu 接口（76KB）+ 并发写 6 个文档，实测接近或超过 3 秒，超时会直接失败。
同页建议 Node 运行时选 **Node 16 或以上**（以控制台可选版本为准）。

---

## 5. 验证部署

### 5.1 云端测试（不依赖小程序端）

云开发控制台 → 云函数 → `fetchNews` → **云端测试** → 直接执行

期望返回：

```json
{ "ok": true, "groups": 6, "items": 478, "cost": 1200 }
```

- `ok: true` 且 `groups: 6` → 部署成功
- `ok: false` → 看 `error` 字段，对照第 7 节错误表

### 5.2 查数据

数据库 → `groups` → 应出现 **6 条文档**（groupId 1/2/3/4/5/7），每条内含 `categories` 数组。

数据库 → `snapshot` → 应有一条 `ok: true` 记录。

### 5.3 前端验证

开发者工具点「编译」→ 首页应渲染 6 个分组、13 个类目块、4 个广告位。

若显示「暂无数据」，说明云函数还没成功跑过，回到 5.1。

---

## 6. 定时触发器

`cloudfunctions/fetchNews/config.json` 已配置：

```json
{ "triggers": [{ "name": "fetchNewsEvery5Min", "type": "timer", "config": "0 */5 * * * * *" }] }
```

- 上传部署时会被自动读取创建
- 确认路径：云开发控制台 → 云函数 → `fetchNews` → **触发器**，应看到 `fetchNewsEvery5Min`
- 若没有：在该页面手动新建，Cron 填 `0 */5 * * * * *`
- 触发器只在**正式环境**稳定生效；开发环境如需验证，可先手动云端测试

> 云开发定时触发器为 7 段 Cron（秒 分 时 日 月 周 年），最小间隔以控制台为准。

---

## 7. 常见错误对照表

| 报错/现象 | 原因 | 修复 |
|---|---|---|
| `cloudfunctionRoot 未配置` / 右键无部署菜单 | 项目没识别到云函数目录 | 确认 `project.config.json` 的 `cloudfunctionRoot` 为 `cloudfunctions/`，重启开发者工具 |
| `Cannot find module 'wx-server-sdk'` | 用了「上传全部文件」而非云端安装依赖 | 重新右键 → 上传并部署：云端安装依赖 |
| 执行超时 / `Task timed out` | 默认 3 秒 | 控制台把超时改 20 秒 |
| `errCode: -604100` / 环境不存在 | `envId` 没填或填错 | 核对 `utils/config.js` 的 `envId` |
| 前端读库返回空数组 | `groups` 集合权限未放开读 | 权限改「所有用户可读」 |
| `collection not exists` | 没建集合 | 手动新建 `groups`、`snapshot` |
| 首页一直「暂无数据」 | 云函数从未成功执行 | 先做 5.1 云端测试 |
| 定时器不触发 | 触发器未创建 / 环境不对 | 控制台查触发器，确认是当前环境 |

---

## 8. 上线前 checklist

- [ ] `project.config.json` 的 `appid` 已换成真实 AppID（不能再用 `touristappid`）
- [ ] `utils/config.js` 的 `envId` 已填
- [ ] `fetchNews` 超时 ≥ 20s、Node 运行时 ≥ 16
- [ ] `groups` 集合权限为「所有用户可读」
- [ ] 云端测试返回 `ok: true, groups: 6`
- [ ] 触发器 `fetchNewsEvery5Min` 存在
- [ ] 小程序端首页能正常渲染 13 个类目 + 4 个广告位
