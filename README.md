# 迈金 FIT 到 Strava

本目录用于验证并产品化「顽鹿 / 迈金 FIT 导出 -> 修正 FIT 内坐标 -> 输出修正后的 FIT -> 手动导入 Strava」流程。

当前已验证通过的路线是直接修正 FIT 本体坐标，而不是生成 GPX。用户已将修正后的 FIT 手动上传 Strava，确认可以匹配赛段。

当前阶段优先做手机纯前端处理：FIT 在浏览器本地修正，不上传到服务器。手机网页会引导用户下载修正后的 FIT，再打开 Strava 官方上传页手动选择文件。Strava API / OAuth / 自动上传只作为后续增强。

手机网页主界面已收敛为标题、上传 FIT、下载修正 FIT、打开 Strava 上传。处理记录和溯源信息默认折叠；添加到主屏幕后使用自定义路线修正图标。

## 推荐入口

### 手机日常入口

打开部署后的网页，直接在手机浏览器里选择 FIT 文件。页面会在浏览器本地生成：

```text
<原文件名>.wgs84-fixed.fit
<原文件名>.wgs84-fixed.summary.json
```

本地预览：

```bash
cd public
python3 -m http.server 4173
```

访问：

```text
http://127.0.0.1:4173/
```

详细说明见 [日常使用入口](docs/DAILY_ENTRY.md)。

### 命令行入口

单文件修正：

```bash
python3 scripts/fix_fit_coordinates.py /path/to/activity.fit --output-dir outputs
```

批量修正：

```bash
python3 scripts/fix_fit_coordinates.py fixtures-private/fit/*.fit --output-dir outputs
```

输出文件会使用：

```text
<原文件名>.wgs84-fixed.fit
<原文件名>.wgs84-fixed.summary.json
```

默认不会覆盖已有输出；如需重跑，加 `--overwrite`。

## 当前能力

- 读取 FIT header、definition message 和 record message。
- 定位 record message 里的 `position_lat` / `position_long`。
- 对中国大陆范围内的坐标执行 GCJ-02 -> WGS-84。
- 只写回坐标字段，尽量保留原始 FIT 其他数据。
- 重新计算 FIT 文件 CRC。
- 输出不含原始轨迹明细的摘要。

## 已验证结果

匿名化样本结果：

- record message：1709
- 坐标记录：1709
- 修改坐标记录：1709
- 平均坐标位移：约 561.25 米
- 修正后文件 CRC：有效
- 用户手动上传 Strava 后确认可以匹配赛段

## 隐私边界

- 手机网页版本只读取用户主动选择的 FIT 文件。
- 第一版不会上传 FIT、GPX 或 token 到任何服务器。
- 第一版不申请 Strava API、不发起 OAuth、不自动上传真实活动。
- 真实 FIT 样本请放在 `fixtures-private/fit/`，该目录已被 `.gitignore` 忽略。
- 不要把 client secret、access token、refresh token、cookie 或 session 明文写入本目录。

## 下一步

继续按 [FIT 修正产品化说明](docs/FIT_FIX_PRODUCTIZATION.md) 和 [日常使用入口](docs/DAILY_ENTRY.md) 维护本地处理链路。自动上传 Strava 只作为后续增强。
