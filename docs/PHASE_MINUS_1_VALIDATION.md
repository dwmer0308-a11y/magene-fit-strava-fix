# Phase -1 技术验真计划

完成信号：`PHASE_MINUS_1_PLAN_READY`

> 当前状态：旧的 GPX 下载 / 分享路线已暂停。真实样本验证表明，主路线应改为「修正 FIT 本体坐标并输出修正后的 FIT」。下一阶段已改为手机纯前端网页：浏览器本地修正 FIT 并下载。

## 目标

先验证关键风险，不直接进入完整后端开发：

1. 手机端是否能选择顽鹿 / 迈金导出的 `.fit` 文件。
2. 浏览器是否能解析 FIT definition / record message。
3. 浏览器是否能直接修正 FIT 内 `position_lat` / `position_long`。
4. 浏览器是否能重算 FIT CRC，并生成 Strava 可接受的修正 FIT。
5. 后续 Strava OAuth / `/uploads` 是否值得进入自动上传增强。

第一版优先交付「FIT -> 浏览器本地坐标修正 -> 修正 FIT 下载」。自动上传只作为增强能力。

## 阶段 A：手机纯前端 FIT 修正验证

允许动作：

- 打开 `public/index.html`。
- 选择本地 `.fit` 文件。
- 浏览器本地解析、修正 FIT 坐标并重算 CRC。
- 下载或系统分享修正后的 FIT。

不允许动作：

- 第一版不上传 FIT 到远端服务。
- 第一版不调用 Strava API。
- 保存认证明文。

通过标准：

| 验证项 | 通过标准 |
|---|---|
| 手机文件选择 | iPhone Safari 或 Chrome 能选择 `.fit` 文件 |
| FIT header | 能识别 `.FIT` 文件签名和数据区大小 |
| record 解析 | 能定位 record message 中的 `position_lat` / `position_long` |
| 坐标修正 | 中国大陆范围内可应用 GCJ-02 -> WGS-84 修正 |
| CRC | 输出 FIT 的文件 CRC 有效 |
| 下载 | 能生成可下载的 `*.wgs84-fixed.fit` 文件 |
| 分享 | 支持 Web Share API 时能调起系统分享；不支持时保留下载 |

需要用户提供：

- 5 个左右真实 FIT 样本，覆盖：
  - 有心率和踏频。
  - 无心率或无踏频。
  - 长距离或大文件。
  - 无 GPS 或室内活动。
  - 异常或导出失败文件。

样本放置建议：

```text
/Users/zhangliang/Documents/迈金上传Strava/fixtures-private/fit/
```

真实样本不提交公开仓库。后续只保存匿名化摘要，例如记录点数、时间范围、字段覆盖，不保存原始轨迹明细。

## 阶段 B：Strava 权限验证

触发条件：

- 阶段 A 至少 1 个真实 FIT 样本可生成修正后的 FIT。
- 用户确认可以开始 Strava 权限验证。

操作前确认门：

1. 用户手动创建或确认 Strava API Application。
2. 用户确认 callback domain / redirect URI。
3. 用户确认发起 OAuth。
4. 不在文档、日志或终端输出中保存 client secret、access token、refresh token、cookie。

通过标准：

| 验证项 | 通过标准 |
|---|---|
| OAuth 返回 scope | 实际返回 scope 包含 `activity:write` |
| token 交换 | 能换取短期 access token 和 refresh token，但不打印明文 |
| scope 记录 | 只记录是否包含 `activity:write`，不记录 token |

失败处理：

- 如果 scope 不含 `activity:write`，停止 Worker 自动上传开发。
- 继续交付纯前端 FIT 修正下载 MVP。

## 阶段 C：Strava `/uploads` 验证

触发条件：

- 阶段 B 通过。
- 用户明确确认允许上传一个最小测试 FIT 到 Strava。

操作计划：

1. 使用已验证通过的修正 FIT。
2. 调用 `POST /api/v3/uploads`，`data_type=fit`。
3. 记录 upload id 和状态类型，不记录 token。
4. 查询 upload status。
5. 如果生成了测试活动，由用户确认是否保留或删除。

通过标准：

| 验证项 | 通过标准 |
|---|---|
| 上传响应 | Strava 返回 upload id |
| 状态查询 | 能查询 processing / success / failed |
| 错误处理 | 能识别权限缺失、重复 external_id、限流、文件错误 |

失败处理：

- 不进入 Worker 自动上传开发。
- 保持第一版为手动 FIT 导入链路。

## 阶段 D：Worker 自动上传可行性结论

只有 A、B、C 都通过，才进入后续 Worker OAuth/session 设计。

后续 Worker 方案必须满足：

- OAuth callback 校验 `state`。
- 使用 HttpOnly + Secure + SameSite=Lax session cookie。
- 不使用前端可伪造的 `X-User-ID`。
- KV token bundle 保存 scope 和 refresh token 轮换结果。
- `/upload` 限制 Origin，并做 FIT 大小和内容基本校验。

## 当前验收记录

| 日期 | 项目 | 状态 | 备注 |
|---|---|---|---|
| 2026-07-06 | Phase -1 计划 | ready | 已创建本地验证包，等待真实 FIT 样本和 Strava 操作确认 |
| 2026-07-06 | 历史 GPX smoke test | passed | 最小合法 FIT buffer 可解析 2 个轨迹点，并生成含心率扩展的 GPX；该路线现已降级 |
| 2026-07-06 | Strava 手动导入反馈 | needs diagnosis | 用户反馈首次 GPX 上传到 Strava 后坐标没有修正；页面已改为坐标模式诊断版，需用同一 FIT 对比 `GCJ-02 转 WGS-84`、`原样导出`、`WGS-84 转 GCJ-02` 三种结果 |
| 2026-07-06 | FIT 本体修正验证 | passed | 修改原始 FIT 内 record 坐标并重算 CRC 后，用户手动上传 Strava，确认地图 / 赛段可以匹配 |
| 2026-07-06 | FIT 修正批处理入口 | passed | `scripts/fix_fit_coordinates.py` 支持多输入文件和 `--output-dir`，保留旧单文件 `--output/--summary` 调用 |
| 2026-07-06 | 手机纯前端 FIT 修正 | passed | `public/app.js` 可在浏览器本地修正 FIT。真实样本验证中，浏览器版输出 FIT 与 Python 版输出 SHA-256 完全一致，写出 CRC 有效 |

## 坐标修正诊断流程

如果上传 Strava 后仍然偏移，先不要进入自动上传开发。按同一个 FIT 样本做 FIT 本体诊断：

1. 用 Python CLI 修正同一个原始 FIT，确认写出 CRC 有效。
2. 用手机网页修正同一个原始 FIT，确认写出 CRC 有效。
3. 对比 Python 输出和网页输出的 SHA-256；如果一致，说明网页移植无偏差。
4. 若输出一致但 Strava 仍偏移，检查原始 FIT 是否已经是 WGS-84、是否为非中国坐标、是否存在 BD-09 或厂商特殊字段。
5. 若输出不一致，停止发布网页版本，回到 `public/app.js` 的 FIT 写回逻辑排查。

判断规则：

| 现象 | 说明 | 下一步 |
|---|---|---|
| 网页输出和 Python 输出 SHA-256 一致 | 前端移植正确 | 优先排查原始坐标系或 Strava 显示 |
| `changed_records` 为 0 | 文件坐标不在中国范围，或无有效 GPS 坐标 | 检查活动地点和样本类型 |
| 写出 CRC 无效 | FIT 写回或 CRC 重算异常 | 停止发布，修复核心逻辑 |
