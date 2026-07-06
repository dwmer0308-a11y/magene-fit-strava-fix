# 日常使用入口

## 推荐方案

当前推荐使用纯前端手机网页：

```text
手机打开网页 -> 选择 FIT -> 浏览器本地修正坐标 -> 下载修正后的 FIT -> 手动上传 Strava
```

这条路线不需要电脑在身边，不需要局域网服务，也不需要把 FIT 上传给服务器。网页只能读取你主动选择的 `.fit` 文件，不能扫描手机文件、相册或其它隐私内容。

## 手机使用

1. 用手机打开部署后的网页。
2. 点“选择 FIT 文件”。
3. 选择从迈金 / 顽鹿导出的一个或多个 `.fit` 文件。
4. 页面在浏览器本地完成 GCJ-02 -> WGS-84 坐标修正，并重算 FIT CRC。
5. 下载 `*.wgs84-fixed.fit`。
6. 手动上传修正后的 FIT 到 Strava。

## 本地预览

直接打开也可以：

```text
/Users/zhangliang/Documents/迈金上传Strava/public/index.html
```

也可以启动一个静态服务预览：

```bash
cd /Users/zhangliang/Documents/迈金上传Strava/public
python3 -m http.server 4173
```

然后访问：

```text
http://127.0.0.1:4173/
```

## GitHub Pages 部署

项目已准备 GitHub Pages 工作流：

```text
.github/workflows/deploy-pages.yml
```

后续把仓库推到 GitHub 后，在仓库 Settings -> Pages 中选择 GitHub Actions，即可把 `public/` 发布成手机可访问网页。

## 输出文件

浏览器会生成：

```text
<原文件名>.wgs84-fixed.fit
<原文件名>.wgs84-fixed.summary.json
```

摘要 JSON 只记录文件大小、record 数、坐标记录数、修正记录数、平均 / 最大位移和 CRC 状态，不包含原始轨迹点列表。

## 命令行备用入口

如果只在 Mac 上批量处理，可以继续使用：

```bash
cd /Users/zhangliang/Documents/迈金上传Strava
python3 scripts/fix_fit_coordinates.py /path/to/*.fit --output-dir outputs
```

## 安全边界

- 第一版不调用 Strava API。
- 第一版不发起 OAuth。
- 第一版不上传 FIT 到服务器。
- 第一版不保存、打印或写入 client secret、access token、refresh token、cookie。
- 真实 FIT 样本和输出 FIT 不进公开仓库。

## 后续增强

后续可以继续做 Strava OAuth 和自动上传，但必须单独设计 token 存储、refresh token 轮换、上传状态查询和撤销授权流程。自动上传不影响当前纯前端下载版。
