import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/worker.js";

class FakeStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async all() {
    return {
      results: [...this.database.counts.entries()].map(([tool_id, count]) => ({ tool_id, count }))
    };
  }

  async run() {
    if (this.sql.includes("INSERT INTO tool_counts")) {
      const toolId = this.values[0];
      this.database.counts.set(toolId, (this.database.counts.get(toolId) || 0) + 1);
    }
    return { success: true };
  }

  async first() {
    return { count: this.database.counts.get(this.values[0]) || 0 };
  }
}

class FakeDatabase {
  constructor() {
    this.counts = new Map();
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

function environment() {
  return {
    DB: new FakeDatabase(),
    ALLOWED_ORIGINS: "https://example.com,http://127.0.0.1:8765"
  };
}

function request(path, options = {}) {
  return new Request(`https://stats.example.workers.dev${path}`, {
    headers: { Origin: "https://example.com" },
    ...options
  });
}

test("모든 도구의 초기 조회수를 0으로 반환한다", async () => {
  const response = await worker.fetch(request("/counts"), environment());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(Object.keys(body.counts).length, 7);
  assert.equal(body.counts["work-plan"], 0);
});

test("등록된 도구의 실행 횟수를 누적한다", async () => {
  const env = environment();
  const first = await worker.fetch(request("/count/work-plan", { method: "POST" }), env);
  const second = await worker.fetch(request("/count/work-plan", { method: "POST" }), env);
  assert.equal((await first.json()).count, 1);
  assert.equal((await second.json()).count, 2);
});

test("등록되지 않은 도구는 집계하지 않는다", async () => {
  const response = await worker.fetch(request("/count/unknown-tool", { method: "POST" }), environment());
  assert.equal(response.status, 404);
});

test("허용되지 않은 홈페이지의 요청을 거부한다", async () => {
  const response = await worker.fetch(
    new Request("https://stats.example.workers.dev/counts", { headers: { Origin: "https://wrong.example" } }),
    environment()
  );
  assert.equal(response.status, 403);
});
