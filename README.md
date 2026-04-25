# SpotfurryAuth

SpotfurryAuth 是 Spotfurry 手表端 Apple Music 扫码登录的后端骨架。它负责创建一次性配对会话、提供手机扫码授权页，并把 Apple Music 登录结果中转给手表端。

这个项目只做认证中转，不处理 Apple Music 音频下载、解密或缓存。

## 技术选型

- Cloudflare Workers
- Hono
- Durable Objects
- Web Crypto
- MusicKit JS

选择 Durable Objects 的原因是扫码登录需要“手机刚完成授权，手表马上轮询到结果”的强状态同步；Workers KV 的最终一致性不适合作为第一版扫码会话主存储。

## 当前能力

- `POST /api/pairing/start`：手表创建一次性扫码会话
- `GET /apple-music/pair?s=...&p=...`：手机扫码打开 Apple Music 授权页
- `POST /api/pairing/complete`：手机授权完成后提交 `musicUserToken`
- `GET /api/pairing/status?sessionId=...`：手表轮询登录状态
- `GET /api/apple/developer-token`：后端用 Cloudflare Secrets 生成 Apple Music developer token
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
```

启动本地 Worker：

```sh
npm run dev
```

检查代码：

```sh
npm run check
npm run test
```

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

部署：

```sh
npm run deploy
```

部署完成后，把 Spotfurry Android 端配置到这个服务：

```properties
spotfurry.appleMusicAuthBaseUrl=https://你的-worker.workers.dev
```

当前 Android 端还需要下一步改造：进入扫码页时调用 `/api/pairing/start`，使用后端返回的 `pairUrl` 生成二维码，并用 `sessionId + watchSecret` 轮询 `/api/pairing/status`。

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
- 不要把 `APPLE_PRIVATE_KEY` 放进 Android App。
- 不要硬编码或公开滥用第三方 MusicKit token provider。
- 不要记录 `musicUserToken` 日志。
- 配对会话 5 分钟过期。
- `phoneSecret` 和 `watchSecret` 分离，二维码里不包含手表取 token 的凭证。
- 手表取走 token 后会话即删除。
