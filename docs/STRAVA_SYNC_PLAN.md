# Strava 一键同步实施方案

核对日期：2026-07-07

## 结论

如果用户接受 Strava API app / 后端，推荐下一阶段采用：

```text
GitHub Pages 前端继续本地修正 FIT
-> 用户看到修正结果并手动点“同步到 Strava”
-> Cloudflare Worker 负责 OAuth、token refresh、上传转发和状态轮询
-> Strava 返回 activity_id 后，前端展示 Strava 活动链接或错误原因
```

不要把 Strava `client_secret`、`access_token`、`refresh_token`、cookie 或 session 放进 GitHub Pages 前端、公开仓库、日志、聊天或 `THREAD.md`。

## 官方文档核对

- Strava 新建 API app 默认是 Single Player Mode，只允许自己的 Strava 账号授权使用；创建 app 需要 Strava subscription。
  - https://developers.strava.com/docs/getting-started/
  - https://developers.strava.com/docs/rate-limits/
- OAuth 需要把用户跳转到 Strava 授权页，请求 scope 后用授权码换取 refresh token 和短期 access token。
  - https://developers.strava.com/docs/authentication/
- 上传活动需要 `activity:write` scope。
  - https://developers.strava.com/docs/uploads/
- access token 约 6 小时过期；refresh token 每次刷新后都可能轮换，必须保存最新 refresh token。
  - https://developers.strava.com/docs/authentication/
- `/uploads` 是异步接口；上传成功只代表进入处理队列，需要轮询 upload status，成功后才拿到 `activity_id`。
  - https://developers.strava.com/docs/uploads/
- Strava 支持 FIT 上传，且会读取 FIT record 里的 `position_lat` / `position_long` 等字段。
  - https://developers.strava.com/docs/uploads/

## 用户前置确认清单

按顺序确认，不跳步：

1. Strava 账号是否有 subscription。
2. 是否能打开 `https://www.strava.com/settings/api`。
3. 是否能创建 API app，并看到 `Client ID`、`Client Secret`、`Authorization Callback Domain`。
4. 这个功能是否只给用户本人使用。
   - 如果只给本人使用，Single Player Mode 足够。
   - 如果要给多人使用，需要先评估 app review 和 athlete capacity，不进入最小版本。
5. 是否接受使用 Cloudflare Worker 作为小后端。
6. 是否接受后端保存 refresh token。
   - 最小个人版可以只保存一个用户的 token 记录。
   - 后续多用户版再设计用户表、加密和撤销授权。
7. callback domain 采用哪一个。
   - 推荐最小版：先用 Cloudflare Worker 的公开域名，例如 `*.workers.dev`。
   - 如果后续绑定自定义域名，再把 Strava app 的 callback domain 改成该域名。

## 推荐后端

推荐 Cloudflare Worker，而不是直接在 GitHub Pages 或 Vercel 里先做。

原因：

- 当前项目已经是纯静态 GitHub Pages，前端不适合保存 secret，也不能安全执行 token refresh。
- Worker 可以用 secrets 保存 `STRAVA_CLIENT_SECRET`，用 KV 保存 refresh token 和授权状态。
- Worker 很适合这个项目的小型 API：OAuth callback、上传转发、轮询状态、撤销授权。
- Cloudflare Worker 的部署形态比引入完整 Next/Vercel 项目更轻，不需要重构现有前端。

Vercel Function 也可行，尤其是以后想做完整 Web app 或管理后台时。但对当前“手机网页 + 一个小上传代理”的最小版本来说，Cloudflare Worker 更贴合。

## 安全架构

### 前端继续负责

- 用户选择 `.fit` 文件。
- 浏览器本地执行 GCJ-02 -> WGS-84 修正。
- 展示修正摘要：坐标记录、修正记录、平均位移、CRC 状态。
- 保留“下载修正 FIT”。
- 用户手动点“同步到 Strava”后，才把修正后的 FIT 发给后端。

### 后端只负责

- `/auth/start`：生成 Strava OAuth URL，带 `activity:write` scope 和 `state`。
- `/auth/callback`：接收授权码，调用 Strava token exchange。
- `/auth/status`：告诉前端当前是否已连接 Strava，不返回 token。
- `/upload`：接收修正后的 FIT，刷新 access token，调用 Strava `/uploads`。
- `/upload/:id`：轮询 Strava upload status，返回 `activity_id`、Strava 链接或错误原因。
- `/disconnect`：撤销授权并删除本地 token 记录。

### 后端必须避免

- 不向前端返回 access token 或 refresh token。
- 不在日志里打印 token、secret、authorization code、FIT 原始内容。
- 不把真实 FIT 文件持久化到 KV、R2、GitHub 或日志。
- 不在没有用户点击确认时上传。

## 最小可用版本

### Phase 0：能力确认

完成条件：

- 用户确认有 Strava subscription。
- 用户确认能创建 API app。
- 用户确认使用 Cloudflare Worker。
- 用户确认 callback domain。
- 用户确认 token 存储边界。

### Phase 1：后端骨架

产物：

- `worker/` 或独立 `strava-worker/`。
- Worker secrets：`STRAVA_CLIENT_ID`、`STRAVA_CLIENT_SECRET`。
- KV namespace：保存 refresh token、scope、athlete id、更新时间。

完成条件：

- `/auth/start` 能生成 Strava 授权 URL。
- `/auth/status` 能返回未连接状态。
- 不发起真实 OAuth，直到用户确认。

### Phase 2：连接 Strava

完成条件：

- 用户点击“连接 Strava”。
- Strava 授权页请求 `activity:write`。
- callback 交换 token 成功。
- 后端只保存 refresh token 和必要元数据。
- 前端显示“已连接 Strava”。

### Phase 3：一键同步

完成条件：

- 前端转换 FIT 后展示确认按钮。
- 用户点击“同步到 Strava”后才上传。
- 后端调用 `POST https://www.strava.com/api/v3/uploads`，`data_type=fit`。
- 后端轮询 `GET https://www.strava.com/api/v3/uploads/:id`，最短间隔不低于 1 秒。
- 成功时返回 `activity_id` 和 `https://www.strava.com/activities/<activity_id>`。
- 失败时返回 Strava error/status，不吞掉错误。

### Phase 4：小范围真实验证

完成条件：

- 仅使用用户明确选定的一条真实活动测试。
- 验证 Strava 页面活动轨迹、时间、距离、功率/心率等是否正常。
- 验证重复上传时能清楚显示 duplicate 或相关错误。
- 验证撤销授权后不能继续上传。

## UI 交互建议

转换完成后，按钮区保持两个出口：

```text
下载修正 FIT
同步到 Strava
```

同步前弹出或展示一次确认：

```text
将上传：<文件名>
活动时间：<start> - <end>
坐标记录：<n>
CRC：有效/异常

确认同步到 Strava
```

异常提示要直接可行动：

- 未连接 Strava：显示“先连接 Strava”。
- 缺少 `activity:write`：显示“重新授权并勾选写入权限”。
- token 失效：显示“重新连接 Strava”。
- 重复活动：显示“Strava 判断为重复上传；请检查是否已存在”。
- 处理失败：显示 Strava 返回的 status/error。

## 暂不做

- 不做多人 SaaS。
- 不做 public app review。
- 不保存真实 FIT 文件。
- 不做后台自动同步。
- 不做 webhook；最小版用上传状态轮询即可。
- 不把前端迁出 GitHub Pages，除非后续托管策略改变。

## 下一步确认问题

进入实施前，用户只需要先回答：

1. 你的 Strava 账号现在是否有 subscription？
2. 你能否打开 `https://www.strava.com/settings/api` 并看到创建 API app 的入口？
3. 是否同意第一版用 Cloudflare Worker 做小后端？
4. 第一版是否只服务你自己的 Strava 账号？

完成信号：`STRAVA_SYNC_PLAN_READY`

## 无会员替代路线：网页手动上传辅助

如果用户不想为创建 Strava API app 购买 Strava subscription，当前更稳的路线是：

```text
GitHub Pages 前端本地修正 FIT
-> 用户点一次“下载并打开 Strava 上传”
-> 页面触发下载修正后的 FIT，并打开 https://www.strava.com/upload/select
-> 用户在 Strava 网页里手动选择修正 FIT 并保存
```

这条路线不使用 Strava API，不需要创建 API app，不需要 OAuth，不需要后端保存 token。限制是浏览器安全机制不允许脚本自动填充 Strava 页面里的文件选择框，所以无法做到真正“一键上传”；最后选择文件和确认保存必须由用户手动完成。
