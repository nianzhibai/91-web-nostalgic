# 91-web-nostalgic

怀旧版视频前台与管理后台：功能与 `nianzhibai/91-web` 保持一致，视觉沿用主题重设计之前（`91` 仓库提交 `3939455e`）的暖橙暗色和樱花粉亮色。

| 后端主题 | 怀旧版外观 |
| --- | --- |
| `dark` | 暗黑 + 暖橙 |
| `light` | 奶油白 + 樱花粉 |

旧版的星空蓝主题及星星动图未保留，因为后端只支持 `dark` 和 `light`。浏览器里保存的旧 `pink`、`sky` 值按 `light` 显示。

## 开发

使用 `.nvmrc` 和 `package.json` 指定的 Node/npm 版本：

```bash
npm ci
BACKEND_PORT=9192 npm run dev
```

后端单独运行。Vite 将 API、媒体和备份迁移请求代理到本机 `BACKEND_PORT`；浏览器侧保持同源。生产页面仍使用后端 Cookie 登录。

本地验证生产构建：

```bash
npm run build
BACKEND_PORT=9192 npm run preview
```

页面入口仍是 `/`，可直接打开或刷新 `/login`、`/admin/settings` 等深链接。预览服务同时提供构建中的版本化资源路径，缺失资源返回 404，API 和媒体路径保持原样转发。

SDK 使用 `vendor/91-client-1.0.0.tgz` 中固定的 `@91/client` 包，因此不需要旁边存在 `91` 源码。更新 SDK 时，在后端仓库运行 `npm pack ./sdk`，复制新包并更新依赖及锁文件。该包包含类型声明和源码，现有源码断言测试只检查这个已安装的依赖。

## 校验和发布

```bash
npm run check
npm run package
```

产物为 `release/frontend.tar.gz` 和 `release/frontend.tar.gz.sha256`。压缩包根目录包含 `frontend.json`、`index.html` 和资源目录。

`package.json` 决定前端版本，`frontend-package.json` 声明名称和支持的 API 范围。资源地址带名称和版本，例如 `/_frontend/91-web-nostalgic/1.0.0/assets/...`；页面路由仍从 `/` 开始。每次改变发布内容都应增加版本，避免旧页面读取到其他版本的资源。

推送与包版本一致的 `vX.Y.Z` 标签会触发测试、构建和 GitHub Release。已发布版本不能覆盖。GitHub 自动生成的源码压缩包不能用于安装前端。

后端产品发布通过 `frontend.lock.json` 固定前端版本与 SHA-256，安装包及 Docker 镜像都携带已验证的前端。自定义前端可在后台「配置面板 → 前端配置」填写完整 GitHub 仓库链接，保存后安装并启用最新正式发布。

前端仓库保存在 `config.yaml` 的 `frontend.repository`，与其他配置共用可视化编辑、源码编辑和差异确认。安装直接读取已保存配置，后端校验最新发布包后启用，页面自动打开首页。当前仓库与已启用前端一致时显示「检查更新」，查询 `/admin/api/frontend/update` 后显示「更新并启用」或提示「已是最新版本」。检查失败可以重试，切换仓库会丢弃旧检查结果。界面不提供版本选择、历史列表、刷新、回滚或恢复默认操作。
