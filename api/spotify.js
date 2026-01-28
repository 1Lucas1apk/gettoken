import crypto from 'crypto';

// Variáveis globais para cache do segredo TOTP (dentro da instância serverless quente)
let currentTotpSecret = null;
let currentTotpVersion = null;
let lastSecretFetchTime = 0;
const SECRET_FETCH_INTERVAL = 60 * 60 * 1000; // 1 hora

const SECRETS_URL = "https://raw.githubusercontent.com/xyloflake/spot-secrets-go/refs/heads/main/secrets/secretDict.json";
const USER_AGENT_MOBILE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  }

  const { productType } = req.query;

  // --- Lógica Mobile / TOTP (Se solicitado explicitamente) ---
  if (productType === 'mobile-web-player') {
      const spDc = process.env.SP_DC;
      if (!spDc) {
        return res.status(500).json({ success: false, error: "SP_DC env variable not configured on server for mobile token generation" });
      }

      try {
        await ensureTotpSecrets();
        const serverTimeMs = await getServerTime(spDc);
        const serverTimeSec = Math.floor(serverTimeMs / 1000);
        const localTimeSec = Math.floor(Date.now() / 1000);

        const totpLocal = generateTOTP(currentTotpSecret, localTimeSec);
        const totpServer = generateTOTP(currentTotpSecret, serverTimeSec);

        const tokenUrl = new URL("https://open.spotify.com/api/token");
        
        tokenUrl.searchParams.append("reason", "transport");
        tokenUrl.searchParams.append("productType", "mobile-web-player"); 
        tokenUrl.searchParams.append("totp", totpLocal);
        tokenUrl.searchParams.append("totpVer", currentTotpVersion || "19");
        tokenUrl.searchParams.append("totpServer", totpServer);

        const spotifyRes = await fetch(tokenUrl.toString(), {
          method: "GET",
          headers: {
            "User-Agent": USER_AGENT_MOBILE,
            "Origin": "https://open.spotify.com/",
            "Referer": "https://open.spotify.com/",
            "Cookie": `sp_dc=${spDc}`,
          },
        });

        if (!spotifyRes.ok) {
            const errorText = await spotifyRes.text();
            console.error("Spotify Mobile Auth Error:", errorText);
            return res.status(spotifyRes.status).json({ success: false, error: "Failed to get mobile token", details: errorText });
        }

        const data = await spotifyRes.json();
        return res.status(200).json(data);

      } catch (error) {
        console.error("Mobile Token Generation Error:", error);
        return res.status(500).json({ success: false, error: error.message || "Internal Server Error" });
      }
  }

  // --- Lógica Padrão (Proxy para internal.1lucas1apk.fun) ---
  try {
    const upstream = "https://internal.1lucas1apk.fun/api/token";
    const url = new URL(upstream);
    for (const [k, v] of Object.entries(req.query || {})) {
      // Repassa todos os params, exceto se quiséssemos filtrar algo
      url.searchParams.set(k, Array.isArray(v) ? v.join(",") : String(v));
    }

    const upstreamRes = await fetch(url.toString(), {
      method: "GET",
      headers: {
        ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    });

    const contentType = upstreamRes.headers.get("content-type") || "";

    res.status(upstreamRes.status);
    res.setHeader("Content-Type", contentType.includes("application/json") ? "application/json" : "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, max-age=0");

    if (contentType.includes("application/json")) {
      const data = await upstreamRes.json();
      return res.json(data);
    }

    const text = await upstreamRes.text();
    return res.send(text);
  } catch (error) {
    console.error("Erro Proxy:", error?.message || error);
    return res.status(502).json({
      success: false,
      error: error?.message || "Bad Gateway",
    });
  }
}

// --- Funções Auxiliares (Mobile) ---

async function ensureTotpSecrets() {
    const now = Date.now();
    if (currentTotpSecret && (now - lastSecretFetchTime < SECRET_FETCH_INTERVAL)) return;

    try {
        const res = await fetch(SECRETS_URL);
        if (!res.ok) throw new Error("Failed to fetch secrets");
        const secrets = await res.json();
        const versions = Object.keys(secrets).map(Number);
        const newestVersion = Math.max(...versions).toString();
        const secretData = secrets[newestVersion];
        const mappedData = secretData.map((value, index) => value ^ ((index % 33) + 9));
        
        currentTotpSecret = Buffer.from(mappedData).toString('hex');
        currentTotpVersion = newestVersion;
        lastSecretFetchTime = now;
    } catch (e) {
        console.error("Error fetching secrets, using fallback:", e);
        if (!currentTotpSecret) {
             const fallbackData = [99, 111, 47, 88, 49, 56, 118, 65, 52, 67, 50, 104, 117, 101, 55, 94, 95, 75, 94, 49, 69, 36, 85, 64, 74, 60];
             const mapped = fallbackData.map((value, index) => value ^ ((index % 33) + 9));
             currentTotpSecret = Buffer.from(mapped).toString('hex');
             currentTotpVersion = "19";
        }
    }
}

async function getServerTime(spDc) {
    try {
        const res = await fetch("https://open.spotify.com/api/server-time", {
            headers: { "User-Agent": USER_AGENT_MOBILE, "Cookie": `sp_dc=${spDc}` }
        });
        if (!res.ok) throw new Error("Failed to get time");
        const data = await res.json();
        return data.serverTime;
    } catch {
        return Date.now();
    }
}

function generateTOTP(secretHex, timeSec) {
    const step = 30;
    const counter = Math.floor(timeSec / step);
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(BigInt(counter));
    const hmac = crypto.createHmac('sha1', Buffer.from(secretHex, 'hex'));
    hmac.update(buf);
    const digest = hmac.digest();
    const offset = digest[digest.length - 1] & 0xf;
    const code = (((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff)) % 1000000;
    return code.toString().padStart(6, '0');
}
