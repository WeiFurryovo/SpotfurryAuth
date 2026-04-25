# SpotfurryAuth

SpotfurryAuth 是 Spotfurry 手表端 Apple Music / Spotify 扫码登录的后端骨架。它负责创建一次性配对会话、提供手机扫码授权页，并把音乐服务登录结果中转给手表端。

这个项目只做认证中转，不处理 Apple Music 或 Spotify 音频下载、解密或缓存。

## 技术选型

- Cloudflare Workers
- Hono
- Durable Objects
- Web Crypto
- MusicKit JS
- Spotify OAuth Authorization Code Flow

选择 Durable Objects 的原因是扫码登录需要“手机刚完成授权，手表马上轮询到结果”的强状态同步；Workers KV 的最终一致性不适合作为第一版扫码会话主存储。

## 当前能力

- `POST /api/pairing/start`：手表创建一次性扫码会话
- `GET /apple-music/pair?s=...&p=...`：手机扫码打开 Apple Music 授权页
- `POST /api/pairing/complete`：手机授权完成后提交 `musicUserToken`
- `GET /api/pairing/status?sessionId=...`：手表轮询登录状态
- `GET /api/apple/developer-token`：后端用 Cloudflare Secrets 生成 Apple Music developer token
- `POST /api/spotify/pairing/start`：手表创建 Spotify 一次性扫码会话
- `GET /spotify/pair?s=...&p=...`：手机扫码打开 Spotify 授权页
- `GET /spotify/login?s=...&p=...`：手机跳转 Spotify OAuth 授权
- `GET /spotify/callback`：接收 Spotify OAuth code 并换取短期 access token
- `GET /api/spotify/pairing/status?sessionId=...`：手表轮询 Spotify 登录状态
- `GET /api/health`：检查服务和 Apple 密钥配置状态
- 可选 `MUSICKIT_TOKEN_PROVIDER_URL`：不配置 Apple `.p8` 时，从外部 MusicKit developer token provider 获取 token

## 本地开发

先安装依赖：

```sh
npm install
```

如果你在 Flatpak VSCodium 里，本机命令可能需要通过宿主执行：

```sh
flatpak-spawn --host npm install
```

复制环境变量示例：

```sh
cp .dev.vars.example .dev.vars
```

`.dev.vars` 只能留在本地，不要提交。真实值格式如下：

```env
PUBLIC_BASE_URL=http://localhost:8787
APPLE_TEAM_ID=你的 Apple Team ID
APPLE_KEY_ID=你的 Apple MusicKit Key ID
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
MUSICKIT_TOKEN_PROVIDER_URL=
MUSICKIT_TOKEN_PROVIDER_AUTHORIZATION=
SPOTIFY_CLIENT_ID=你的 Spotify Client ID
SPOTIFY_CLIENT_SECRET=你的 Spotify Client Secret
SPOTIFY_REDIRECT_URI=http://localhost:8787/spotify/callback
SPOTIFY_SCOPES=streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state
```

启动本地 Worker：

```sh
npm run dev
```

检查代码：

```sh
npm run check
npm run test
npm run dry-run
```

`dry-run` 会让 Wrangler 打包 Worker，但不会部署到 Cloudflare。

## 部署

Cloudflare Secrets 不要写入 Git：

```sh
npx wrangler secret put APPLE_TEAM_ID
npx wrangler secret put APPLE_KEY_ID
npx wrangler secret put APPLE_PRIVATE_KEY
npx wrangler secret put PUBLIC_BASE_URL
```

如果只是做 Cider-like 的外部 token provider 实验，也可以不配置 Apple `.p8`，改为设置：

```sh
npx wrangler secret put MUSICKIT_TOKEN_PROVIDER_URL
npx wrangler secret put MUSICKIT_TOKEN_PROVIDER_AUTHORIZATION
```

`MUSICKIT_TOKEN_PROVIDER_AUTHORIZATION` 是可选项，只在你的 token provider 需要 `Authorization` 请求头时填写。不要把第三方 provider 地址硬编码到源码里，只使用你有权使用的 provider。

Spotify Web Playback SDK 需要 Spotify Premium 账号。先在 Spotify Developer Dashboard 创建应用，并把回调地址加入 Redirect URI allowlist，例如：

```text
https://spotfurry-auth.weifurry-c80.workers.dev/spotify/callback
```

然后设置 Worker Secrets：

```sh
npx wrangler secret put SPOTIFY_CLIENT_ID
npx wrangler secret put SPOTIFY_CLIENT_SECRET
npx wrangler secret put SPOTIFY_REDIRECT_URI
```

`SPOTIFY_SCOPES` 可选，默认值为：

```text
streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state
```

部署：

```sh
npm run deploy
```

部署完成后，把 Spotfurry Android 端配置到这个服务：

```properties
spotfurry.appleMusicAuthBaseUrl=https://你的-worker.workers.dev
spotfurry.spotifyAuthBaseUrl=https://你的-worker.workers.dev
```

Android 端进入扫码页时调用对应的 `/api/.../pairing/start`，使用后端返回的 `pairUrl` 生成二维码，并用 `sessionId + watchSecret` 轮询对应的 `/api/.../pairing/status`。

## API 约定

### 创建扫码会话

```http
POST /api/pairing/start
```

返回：

```json
{
  "sessionId": "session-id",
  "watchSecret": "only-watch-knows-this",
  "code": "ABCD-1234",
  "pairUrl": "https://auth.example.com/apple-music/pair?s=...&p=...&code=ABCD-1234",
  "expiresAt": 1770000000000,
  "pollAfterMs": 2000
}
```

二维码里只包含 `sessionId`、`phoneSecret` 和显示用短码，不包含 `watchSecret`。

### 轮询登录状态

```http
GET /api/pairing/status?sessionId=...
Authorization: Bearer <watchSecret>
```

未完成：

```json
{
  "status": "pending",
  "expiresAt": 1770000000000
}
```

完成：

```json
{
  "status": "authorized",
  "musicUserToken": "apple-music-user-token",
  "developerToken": "apple-developer-token",
  "expiresAt": 1770000000
}
```

手表第一次拿到 token 后，Durable Object 会立即删除该会话，避免重复读取。

### Spotify 创建扫码会话

```http
POST /api/spotify/pairing/start
```

返回：

```json
{
  "sessionId": "session-id",
  "watchSecret": "only-watch-knows-this",
  "code": "ABCD-1234",
  "pairUrl": "https://auth.example.com/spotify/pair?s=...&p=...&code=ABCD-1234",
  "expiresAt": 1770000000000,
  "pollAfterMs": 2000
}
```

手机扫码后会跳转 Spotify OAuth。Worker 使用 Authorization Code Flow 在服务端交换 token，不会把 `SPOTIFY_CLIENT_SECRET` 下发给手表或浏览器。

### Spotify 轮询登录状态

```http
GET /api/spotify/pairing/status?sessionId=...
Authorization: Bearer <watchSecret>
```

未完成：

```json
{
  "status": "pending",
  "expiresAt": 1770000000000
}
```

完成：

```json
{
  "status": "authorized",
  "accessToken": "spotify-access-token",
  "expiresIn": 3600,
  "tokenType": "Bearer",
  "scope": "streaming user-read-email user-read-private"
}
```

后端不会把 Spotify `refresh_token` 返回给手表。短期 access token 过期后，第一版策略是让用户重新扫码授权。

### 手机提交授权结果

```http
POST /api/pairing/complete
Content-Type: application/json
```

```json
{
  "sessionId": "session-id",
  "phoneSecret": "phone-secret-from-qr",
  "musicUserToken": "apple-music-user-token"
}
```

## 安全边界

- 不要提交 `.dev.vars`。
- 不要提交 Apple `.p8` 私钥。
- 不要提交 Spotify Client Secret。
- 不要把 `APPLE_PRIVATE_KEY` 放进 Android App。
- 不要把 `SPOTIFY_CLIENT_SECRET` 放进 Android App。
- 不要硬编码或公开滥用第三方 MusicKit token provider。
- 不要记录 `musicUserToken` 日志。
- 不要记录 Spotify `accessToken` 或 OAuth `code` 日志。
- 配对会话 5 分钟过期。
- `phoneSecret` 和 `watchSecret` 分离，二维码里不包含手表取 token 的凭证。
- Spotify OAuth `state` 使用单独随机值绑定配对会话，不把 `phoneSecret` 发给 Spotify。
- 手表取走 token 后会话即删除。
- `/api/*` 默认不开放跨源 CORS；手机授权页与 API 走同源调用，Android 手表端不依赖浏览器 CORS。
- 高频 API 有基础速率限制，避免公开 Worker 被反复创建配对会话或刷 developer token。
- Worker 内部转发到 Durable Object 时使用 `Authorization: Bearer <watchSecret>`，避免把手表取 token 凭证写入内部 URL。

## 自动验证

仓库包含 GitHub Actions 工作流：

- 文件位置：`.github/workflows/worker-ci.yml`
- 触发方式：`push 到 main`、`pull request`、手动 `workflow_dispatch`
- 验证内容：`npm ci`、`npm run check`、`npm run test`、`npm run dry-run`
