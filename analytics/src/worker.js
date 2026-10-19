import { newsRequest, runCollection } from './news.js';
import {siteVisitors,cleanupVisitors} from './site-visitors.js';

const TOOL_IDS = Object.freeze([
  "work-plan",
  "insurance-summary",
  "agenda-merger",
  "meeting-record-writer",
  "construction-photos",
  "pdf-editor",
  "file-compressor",
  "poll-app"
]);

const TOOL_ID_SET = new Set(TOOL_IDS);
const COMMENT_LIMIT = 100;
const COMMENT_NAME_MAX = 30;
const COMMENT_TEXT_MAX = 500;

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

async function listComments(env, toolId, origin) {
  if (!TOOL_ID_SET.has(toolId)) {
    return json({ error: "등록되지 않은 도구입니다." }, 404, origin);
  }

  const result = await env.DB.prepare(
    `SELECT id, author, content, created_at
     FROM tool_comments
     WHERE tool_id = ?1
     ORDER BY created_at DESC, id DESC
     LIMIT ?2`
  ).bind(toolId, COMMENT_LIMIT).all();

  return json({ comments: result.results || [] }, 200, origin);
}

async function hashDeleteToken(token) {
  const value = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function createComment(request, env, toolId, origin) {
  if (!TOOL_ID_SET.has(toolId)) {
    return json({ error: "등록되지 않은 도구입니다." }, 404, origin);
  }

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 5000) {
    return json({ error: "댓글 내용이 너무 깁니다." }, 413, origin);
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: "댓글 내용을 확인해 주세요." }, 400, origin);
  }

  if (typeof input?.website === "string" && input.website.trim()) {
    return json({ ok: true }, 200, origin);
  }

  const author = typeof input?.author === "string" ? input.author.trim() : "";
  const content = typeof input?.content === "string" ? input.content.trim() : "";
  const deleteToken = typeof input?.deleteToken === "string" ? input.deleteToken : "";
  if (!author || author.length > COMMENT_NAME_MAX) {
    return json({ error: `이름은 1~${COMMENT_NAME_MAX}자로 입력해 주세요.` }, 400, origin);
  }
  if (!content || content.length > COMMENT_TEXT_MAX) {
    return json({ error: `댓글은 1~${COMMENT_TEXT_MAX}자로 입력해 주세요.` }, 400, origin);
  }
  if (!/^[0-9a-f-]{36}$/i.test(deleteToken)) {
    return json({ error: "삭제 정보를 만들지 못했습니다. 다시 시도해 주세요." }, 400, origin);
  }

  const deleteTokenHash = await hashDeleteToken(deleteToken);

  const result = await env.DB.prepare(
    `INSERT INTO tool_comments (tool_id, author, content, delete_token_hash)
     VALUES (?1, ?2, ?3, ?4)`
  ).bind(toolId, author, content, deleteTokenHash).run();

  const comment = await env.DB.prepare(
    `SELECT id, author, content, created_at
     FROM tool_comments
     WHERE id = ?1`
  ).bind(result.meta?.last_row_id).first();

  return json({ comment }, 201, origin);
}

async function deleteComment(request, env, toolId, commentId, origin) {
  if (!TOOL_ID_SET.has(toolId)) {
    return json({ error: "등록되지 않은 도구입니다." }, 404, origin);
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: "삭제 정보를 확인해 주세요." }, 400, origin);
  }

  const token = typeof input?.deleteToken === "string" ? input.deleteToken : "";
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return json({ error: "이 브라우저에서 작성한 댓글만 삭제할 수 있어요." }, 403, origin);
  }

  const tokenHash = await hashDeleteToken(token);
  const result = await env.DB.prepare(
    `DELETE FROM tool_comments
     WHERE id = ?1 AND tool_id = ?2 AND delete_token_hash = ?3`
  ).bind(commentId, toolId, tokenHash).run();

  if (!Number(result.meta?.changes)) {
    return json({ error: "삭제 권한이 없거나 댓글을 찾을 수 없습니다." }, 404, origin);
  }

  return json({ ok: true }, 200, origin);
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all([runCollection(env),cleanupVisitors(env)]));
  },
  async fetch(request, env) {
    const origin = allowedOrigin(request, env);
    if (!origin) return json({ error: "허용되지 않은 홈페이지입니다." }, 403, "null");

    if(new URL(request.url).pathname==='/site/visits')return siteVisitors(request,env,origin);

    if (new URL(request.url).pathname === '/news' || new URL(request.url).pathname.startsWith('/news/')) {
      return newsRequest(request, env, origin);
    }

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

      const commentsMatch = pathname.match(/^\/comments\/([a-z0-9-]+)$/);
      if (request.method === "GET" && commentsMatch) {
        return await listComments(env, commentsMatch[1], origin);
      }
      if (request.method === "POST" && commentsMatch) {
        return await createComment(request, env, commentsMatch[1], origin);
      }

      const deleteMatch = pathname.match(/^\/comments\/([a-z0-9-]+)\/(\d+)\/delete$/);
      if (request.method === "POST" && deleteMatch) {
        return await deleteComment(request, env, deleteMatch[1], Number(deleteMatch[2]), origin);
      }

      return json({ error: "요청 경로를 확인해 주세요." }, 404, origin);
    } catch (error) {
      console.error("tool stats error", error);
      return json({ error: "조회수를 처리하지 못했습니다." }, 500, origin);
    }
  }
};
