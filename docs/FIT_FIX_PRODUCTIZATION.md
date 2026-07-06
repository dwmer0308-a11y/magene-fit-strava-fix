# FIT 坐标修正产品化说明

## 当前结论

已验证通过的主路线是：

```text
迈金 / 顽鹿 FIT -> 修正 FIT 内坐标 GCJ-02 到 WGS-84 -> 输出修正后的 FIT -> 用户手动上传 Strava
```

不要继续优先推进旧的 GPX 页面路线。GPX 可作为备选导出，但不是下一阶段主产物。

## 命令行用法

单文件：

```bash
python3 scripts/fix_fit_coordinates.py input.fit --output-dir outputs
```

多文件：

```bash
python3 scripts/fix_fit_coordinates.py fixtures-private/fit/*.fit --output-dir outputs
```

兼容旧的显式输出路径：

```bash
python3 scripts/fix_fit_coordinates.py input.fit \
  --output outputs/input.wgs84-fixed.fit \
  --summary outputs/input.wgs84-fixed.summary.json
```

默认输出：

```text
<原文件名>.wgs84-fixed.fit
<原文件名>.wgs84-fixed.summary.json
```

默认不覆盖已有输出；需要重跑时加：

```bash
--overwrite
```

## 摘要边界

摘要 JSON 只记录：

- 输入 / 输出文件路径。
- FIT header 和数据区大小。
- 原始文件 CRC 是否有效。
- 修正后文件 CRC 是否有效。
- record message 数量。
- 坐标记录数量。
- 被修改坐标记录数量。
- 平均 / 最大位移。
- 活动起止时间戳。

摘要不保存原始轨迹点列表，不保存 token、cookie、refresh token、client secret。

## 兼容性矩阵

下一阶段建议至少覆盖：

| 样本类型 | 预期 |
|---|---|
| 普通户外骑行，有 GPS / 心率 / 踏频 / 功率 | 坐标修正，保留原始非坐标数据，CRC 有效 |
| 无功率或无踏频 | 坐标修正，摘要正常 |
| 长距离 / 大文件 | 可完成，不白屏，不截断 |
| 室内骑行 / 无 GPS | 不修改坐标，给出 coordinate_records 为 0 或 changed_records 为 0 |
| 非中国坐标 | 不修改坐标，skipped_outside_china 增加 |
| 损坏 FIT / CRC 错误 | 明确报告 original_file_crc_ok 为 false 或直接失败 |
| 厂商扩展 / developer fields | 保留字段，只改 record 坐标 |

## 后续产品形态

优先级建议：

1. 手机纯前端网页：当前推荐日常入口，手机浏览器本地读取和修正 FIT，下载修正 FIT。
2. 本地 CLI 批处理：稳定备用入口，适合 Mac 上一次处理多个文件。
3. GitHub Pages 部署：把 `public/` 发布成手机可访问网页。
4. iOS 快捷指令：后续可包装网页或上传入口，减少手机操作步骤。
5. 自动上传 Strava：增强能力，必须单独验证 OAuth、`activity:write`、`/uploads`，并严格保护 token。

## 日常入口

已新增纯前端手机网页：

```text
public/index.html
public/app.js
public/styles.css
```

本地预览：

```bash
cd /Users/zhangliang/Documents/迈金上传Strava/public
python3 -m http.server 4173
```

GitHub Pages 工作流：

```text
.github/workflows/deploy-pages.yml
```

详细使用方式见：

```text
docs/DAILY_ENTRY.md
```

## 禁止项

- 不要把真实 FIT 样本提交到公开仓库。
- 不要上传真实活动到 Strava，除非用户明确要求。
- 不要保存、打印或写入 client secret、access token、refresh token、cookie。
- 不要在未确认前申请 Strava API、发起 OAuth、部署 Cloudflare Worker。
