import { execSync } from 'child_process';

const ipCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(',')[0] : req.socket.remoteAddress;

    const now = Date.now();
    if (ipCache.has(ip)) {
      const cachedEntry = ipCache.get(ip);
      
      if (now < cachedEntry.expiry) {
        return res.status(200).json({
          ...cachedEntry.data,
          source: 'cache',
          expires_in_seconds: Math.floor((cachedEntry.expiry - now) / 1000)
        });
      } else {
        ipCache.delete(ip);
      }
    }

    const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    const cmdGetHome = `curl -s -I -A "${userAgent}" "https://www.pandora.com"`;
    const outputHome = execSync(cmdGetHome).toString();

    const csrfMatch = /csrftoken=([a-f0-9]+)/.exec(outputHome);
    if (!csrfMatch || !csrfMatch[1]) {
      throw new Error("Falha ao obter csrftoken da home page.");
    }

    const csrfToken = csrfMatch[1];
    
    const cmdLogin = `curl -s -X POST "https://www.pandora.com/api/v1/auth/anonymousLogin" -H "Content-Type: application/json" -H "Cookie: csrftoken=${csrfToken}" -H "X-CsrfToken: ${csrfToken}" -H "User-Agent: ${userAgent}" -H "Origin: https://www.pandora.com" -H "Referer: https://www.pandora.com/" -d "{}"`;

    const outputLogin = execSync(cmdLogin).toString();
    
    let loginData;
    try {
      loginData = JSON.parse(outputLogin);
    } catch (e) {
      throw new Error("Falha ao parsear resposta do login JSON.");
    }

    if (!loginData.authToken) {
      throw new Error("Resposta do login não contém authToken.");
    }

    const resultData = {
      success: true,
      csrfToken: csrfToken,
      authToken: loginData.authToken,
      method: 'curl-serverless',
      source: 'live'
    };

    ipCache.set(ip, {
      data: resultData,
      expiry: now + CACHE_TTL_MS
    });

    return res.status(200).json(resultData);

  } catch (error) {
    console.error("Erro API:", error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
