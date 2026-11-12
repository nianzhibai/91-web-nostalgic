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

后端产品发布通过 `frontend.lock.json` 固定前端版本与 SHA-256，安装包及 Docker 镜像都携带已验证的前端。「配置面板 → 前端配置」列出内置、GitHub 安装和本地上传的前端，选择即切换。

前端选择不属于 `config.yaml`，不经过保存配置流程。列表来自 `client.frontend.list()`，每个前端一行；内置前端点击即切换，非内置前端、GitHub 安装（`install`）和上传（`upload`）先确认，因为新前端会接管管理界面。打开页面时 `updates()` 只读取发布信息，当前前端有新版时显示更新按钮。操作成功后打开首页（更新时重新加载当前页），失败时保留当前前端并显示错误。界面不提供版本选择、历史列表或回滚。
