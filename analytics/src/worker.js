const TOOL_IDS = Object.freeze([
  "work-plan",
  "insurance-summary",
  "agenda-merger",
  "meeting-record-writer",
  "construction-photos",
  "pdf-editor",
  "file-compressor"
]);

const TOOL_ID_SET = new Set(TOOL_IDS);

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  const configured = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!origin) return "*";
  if (configured.includes("*") || configured.includes(origin)) return origin;
  return null;
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin"
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(origin)
  });
}

async function allCounts(env, origin) {
  const result = await env.DB.prepare(
    "SELECT tool_id, count FROM tool_counts ORDER BY tool_id"
  ).all();
  const counts = Object.fromEntries(TOOL_IDS.map((toolId) => [toolId, 0]));

  for (const row of result.results || []) {
    if (TOOL_ID_SET.has(row.tool_id)) counts[row.tool_id] = Number(row.count) || 0;
  }

  return json({ counts }, 200, origin);
}

async function incrementCount(env, toolId, origin) {
  if (!TOOL_ID_SET.has(toolId)) {
    return json({ error: "등록되지 않은 도구입니다." }, 404, origin);
  }

  await env.DB.prepare(
    `INSERT INTO tool_counts (tool_id, count, updated_at)
     VALUES (?1, 1, unixepoch())
     ON CONFLICT(tool_id) DO UPDATE SET
       count = count + 1,
       updated_at = unixepoch()`
  ).bind(toolId).run();

  const row = await env.DB.prepare(
    "SELECT count FROM tool_counts WHERE tool_id = ?1"
  ).bind(toolId).first();

  return json({ toolId, count: Number(row?.count) || 0 }, 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request, env);
    if (!origin) return json({ error: "허용되지 않은 홈페이지입니다." }, 403, "null");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const { pathname } = new URL(request.url);

    try {
      if (request.method === "GET" && pathname === "/health") {
        return json({ ok: true }, 200, origin);
      }

      if (request.method === "GET" && pathname === "/counts") {
        return await allCounts(env, origin);
      }

      const match = pathname.match(/^\/count\/([a-z0-9-]+)$/);
      if (request.method === "POST" && match) {
        return await incrementCount(env, match[1], origin);
      }

      return json({ error: "요청 경로를 확인해 주세요." }, 404, origin);
    } catch (error) {
      console.error("tool stats error", error);
      return json({ error: "조회수를 처리하지 못했습니다." }, 500, origin);
    }
  }
};
