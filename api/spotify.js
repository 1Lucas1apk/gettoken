// pages/api/token.js (Next.js API Route)
// Proxy simples para: https://internal.1lucas1apk.fun/api/token
// Sem cache, só repassa a resposta.

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  }

  try {
    const upstream = "https://internal.1lucas1apk.fun/api/token";
    const url = new URL(upstream);
    for (const [k, v] of Object.entries(req.query || {})) {
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
