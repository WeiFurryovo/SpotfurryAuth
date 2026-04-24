export function renderHomePage(): string {
  return layout({
    title: "Spotfurry Auth",
    body: `
      <main class="card">
        <p class="eyebrow">Spotfurry Auth</p>
        <h1>Apple Music 扫码登录后端</h1>
        <p>
          这个 Worker 负责创建手表配对会话、展示手机授权页，并把 Apple Music
          的登录结果安全地中转回手表。
        </p>
        <p class="hint">
          请从手表端二维码进入授权页面。这个首页不会显示任何密钥或 token。
        </p>
      </main>
    `
  });
}

export function renderAppleMusicPairPage(params: {
  sessionId?: string;
  phoneSecret?: string;
  code?: string;
}): string {
  if (!params.sessionId || !params.phoneSecret) {
    return layout({
      title: "无法配对",
      body: `
        <main class="card">
          <p class="eyebrow danger">配对链接无效</p>
          <h1>缺少扫码参数</h1>
          <p>请回到 Spotfurry 手表端刷新二维码，然后重新扫码。</p>
        </main>
      `
    });
  }

  return layout({
    title: "连接 Apple Music",
    body: `
      <main class="card">
        <p class="eyebrow">Apple Music</p>
        <h1>连接到 Spotfurry</h1>
        <p>
          确认配对码与手表显示一致，然后在手机上完成 Apple Music 授权。
        </p>
        <div class="code">${escapeHtml(params.code ?? "---- ----")}</div>
        <button id="connect-button" type="button">连接 Apple Music</button>
        <p id="status" class="status">等待操作</p>
      </main>
      <script src="https://js-cdn.music.apple.com/musickit/v1/musickit.js"></script>
      <script>
        const sessionId = ${JSON.stringify(params.sessionId)};
        const phoneSecret = ${JSON.stringify(params.phoneSecret)};
        const statusNode = document.getElementById("status");
        const connectButton = document.getElementById("connect-button");

        function setStatus(message, failed = false) {
          statusNode.textContent = message;
          statusNode.classList.toggle("failed", failed);
        }

        connectButton.addEventListener("click", async () => {
          connectButton.disabled = true;
          setStatus("正在请求 Apple Music 授权...");

          try {
            const tokenResponse = await fetch("/api/apple/developer-token");
            const tokenPayload = await tokenResponse.json();

            if (!tokenResponse.ok) {
              throw new Error(tokenPayload.error || "后端尚未配置 Apple Music developer token");
            }

            await MusicKit.configure({
              developerToken: tokenPayload.developerToken,
              app: {
                name: "Spotfurry",
                build: "0.1.0"
              }
            });

            const music = MusicKit.getInstance();
            const musicUserToken = await music.authorize();

            const completeResponse = await fetch("/api/pairing/complete", {
              method: "POST",
              headers: {
                "content-type": "application/json"
              },
              body: JSON.stringify({
                sessionId,
                phoneSecret,
                musicUserToken
              })
            });
            const completePayload = await completeResponse.json();

            if (!completeResponse.ok) {
              throw new Error(completePayload.error || "无法完成手表配对");
            }

            setStatus("登录成功，可以回到手表。");
          } catch (error) {
            connectButton.disabled = false;
            setStatus(error instanceof Error ? error.message : "登录失败", true);
          }
        });
      </script>
    `
  });
}

function layout(params: {
  title: string;
  body: string;
}): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(params.title)}</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: ui-rounded, "SF Pro Rounded", "MiSans", "Noto Sans CJK SC", system-ui, sans-serif;
        background: #050505;
        color: #f4f4f4;
      }

      * {
        box-sizing: border-box;
      }

      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        padding: 24px;
        background:
          radial-gradient(circle at top, rgba(105, 255, 157, 0.18), transparent 34rem),
          linear-gradient(145deg, #070707, #000);
      }

      .card {
        width: min(100%, 430px);
        border: 1px solid rgba(255, 255, 255, 0.11);
        border-radius: 30px;
        padding: 28px;
        background: rgba(17, 17, 17, 0.82);
        box-shadow: 0 24px 70px rgba(0, 0, 0, 0.42);
        backdrop-filter: blur(18px);
      }

      .eyebrow {
        width: fit-content;
        margin: 0 0 16px;
        padding: 6px 11px;
        border: 1px solid rgba(129, 255, 169, 0.32);
        border-radius: 999px;
        color: #8dffaf;
        background: rgba(129, 255, 169, 0.10);
        font-size: 13px;
        font-weight: 700;
      }

      .eyebrow.danger {
        border-color: rgba(255, 123, 123, 0.34);
        color: #ffb2b2;
        background: rgba(255, 95, 95, 0.10);
      }

      h1 {
        margin: 0;
        font-size: clamp(30px, 10vw, 46px);
        line-height: 0.98;
        letter-spacing: -0.06em;
      }

      p {
        margin: 18px 0 0;
        color: #b9b9b9;
        line-height: 1.65;
      }

      .hint {
        color: #858585;
        font-size: 14px;
      }

      .code {
        margin: 24px 0;
        padding: 18px;
        border-radius: 22px;
        background: #f5f5f5;
        color: #090909;
        font-size: clamp(28px, 12vw, 44px);
        font-weight: 850;
        letter-spacing: 0.04em;
        text-align: center;
      }

      button {
        width: 100%;
        border: 0;
        border-radius: 999px;
        padding: 15px 18px;
        color: #041007;
        background: #8dffaf;
        font: inherit;
        font-weight: 850;
        cursor: pointer;
      }

      button:disabled {
        cursor: wait;
        opacity: 0.65;
      }

      .status {
        min-height: 1.65em;
        color: #8dffaf;
        font-weight: 700;
      }

      .status.failed {
        color: #ffb2b2;
      }
    </style>
  </head>
  <body>${params.body}</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}
