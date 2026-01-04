import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const cache = {
  data: null,
  expiry: 0
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const now = Date.now();
  if (cache.data && now < cache.expiry) {
    return res.status(200).json({
      ...cache.data,
      source: 'cache'
    });
  }

  let browser = null;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    let tokens = {};

    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/api/token')) {
        try {
          const json = await response.json();
          if (json.accessToken) {
            tokens.accessToken = json.accessToken;
            tokens.clientId = json.clientId;
            tokens.accessTokenExpirationTimestampMs = json.accessTokenExpirationTimestampMs;
          }
        } catch (e) {}
      }
      if (url.includes('clienttoken.spotify.com')) {
        try {
          const json = await response.json();
          tokens.clientToken = json.granted_token?.token;
        } catch (e) {}
      }
    });

    await page.goto('https://open.spotify.com', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    let attempts = 0;
    while ((!tokens.accessToken || !tokens.clientToken) && attempts < 20) {
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }

    if (!tokens.accessToken) {
      throw new Error('Falha ao obter tokens do Spotify');
    }

    const result = {
      clientId: tokens.clientId,
      accessToken: tokens.accessToken,
      accessTokenExpirationTimestampMs: tokens.accessTokenExpirationTimestampMs,
      isAnonymous: true
    };

    cache.data = result;
    cache.expiry = tokens.accessTokenExpirationTimestampMs - 60000; // Cache expires 1 minute before token

    return res.status(200).json(result);

  } catch (error) {
    console.error('Erro Spotify:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  } finally {
    if (browser !== null) {
      await browser.close();
    }
  }
}
