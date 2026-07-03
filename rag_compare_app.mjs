import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";

const SUPABASE_URL = (process.env.SUPABASE_URL || "https://mvukxwqclfmbnllpywpb.supabase.co").replace(
  /\/$/,
  "",
);
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const COHERE_API_KEY = process.env.COHERE_API_KEY;
const COHERE_EMBED_MODEL = process.env.COHERE_EMBED_MODEL || "embed-v4.0";
const COHERE_CHAT_MODEL = process.env.COHERE_CHAT_MODEL || "command-a-plus-05-2026";
const COHERE_OUTPUT_DIMENSION = Number.parseInt(process.env.COHERE_OUTPUT_DIMENSION || "1536", 10);
const PORT = Number.parseInt(process.env.PORT || "8787", 10);

const SOURCES = [
  {
    key: "naive",
    label: "Naive RAG",
    table: "documents",
  },
  {
    key: "hierarchical",
    label: "계층형 RAG",
    table: "documents_test",
  },
];

const html = String.raw`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>RAG 비교</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f7f5;
      --panel: #ffffff;
      --line: #d8d8d2;
      --text: #20221f;
      --muted: #62665f;
      --green: #1f7a58;
      --amber: #9a5b00;
      --ink: #111411;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, "Malgun Gothic", sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    header {
      border-bottom: 1px solid var(--line);
      background: #fbfbfa;
    }
    .wrap {
      width: min(1320px, calc(100% - 32px));
      margin: 0 auto;
    }
    .top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      min-height: 64px;
    }
    h1 {
      margin: 0;
      font-size: 22px;
      letter-spacing: 0;
    }
    .status {
      min-width: 160px;
      color: var(--muted);
      font-size: 13px;
      text-align: right;
    }
    main {
      padding: 20px 0 28px;
    }
    .querybar {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 12px;
      align-items: stretch;
      margin-bottom: 16px;
    }
    textarea {
      width: 100%;
      min-height: 84px;
      resize: vertical;
      padding: 12px 13px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: white;
      color: var(--ink);
      font-size: 15px;
      line-height: 1.45;
    }
    .controls {
      display: grid;
      grid-template-columns: 96px 132px;
      gap: 8px;
      align-content: stretch;
    }
    label {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 12px;
      color: var(--muted);
    }
    select, button {
      height: 40px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: white;
      color: var(--text);
      font: inherit;
    }
    button {
      grid-column: 1 / -1;
      height: 42px;
      border-color: #176246;
      background: var(--green);
      color: white;
      font-weight: 700;
      cursor: pointer;
    }
    button:disabled {
      opacity: .65;
      cursor: wait;
    }
    .toggle {
      flex-direction: row;
      align-items: center;
      height: 40px;
      padding: 0 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: white;
      color: var(--text);
      white-space: nowrap;
    }
    input[type="checkbox"] {
      width: 16px;
      height: 16px;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      align-items: start;
    }
    .panel {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      min-width: 0;
      overflow: hidden;
    }
    .panelHead {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--line);
      background: #fbfbfa;
    }
    h2 {
      margin: 0;
      font-size: 17px;
      letter-spacing: 0;
    }
    .tableName {
      color: var(--muted);
      font-size: 12px;
    }
    .answer {
      padding: 14px;
      border-bottom: 1px solid var(--line);
      min-height: 96px;
      white-space: pre-wrap;
      line-height: 1.55;
      font-size: 14px;
    }
    .answer.empty {
      color: var(--muted);
    }
    .evidence {
      display: grid;
      gap: 0;
    }
    .hit {
      padding: 12px 14px;
      border-bottom: 1px solid var(--line);
    }
    .hit:last-child {
      border-bottom: 0;
    }
    .hitMeta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-bottom: 7px;
      color: var(--muted);
      font-size: 12px;
    }
    .rank {
      color: white;
      background: var(--amber);
      border-radius: 999px;
      padding: 2px 7px;
      font-size: 12px;
    }
    .score {
      font-variant-numeric: tabular-nums;
    }
    .path {
      overflow-wrap: anywhere;
    }
    .snippet {
      margin: 0;
      color: var(--text);
      font-size: 13px;
      line-height: 1.5;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .error {
      margin: 0 0 14px;
      padding: 12px 14px;
      border: 1px solid #bf6b6b;
      border-radius: 8px;
      background: #fff6f5;
      color: #832828;
      display: none;
      white-space: pre-wrap;
    }
    @media (max-width: 860px) {
      .querybar, .grid {
        grid-template-columns: 1fr;
      }
      .controls {
        grid-template-columns: 1fr 1fr;
      }
      button {
        grid-column: auto;
      }
      .status {
        text-align: left;
      }
      .top {
        align-items: flex-start;
        flex-direction: column;
        padding: 14px 0;
      }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap top">
      <h1>RAG 비교</h1>
      <div id="status" class="status">대기</div>
    </div>
  </header>
  <main class="wrap">
    <form id="queryForm" class="querybar">
      <textarea id="question" name="question" placeholder="민원 처리 기준, 절차, 권리 등에 대해 질문하세요.">민원 처리 담당자는 민원을 어떻게 처리해야 하나요?</textarea>
      <div class="controls">
        <label>Top K
          <select id="topK" name="topK">
            <option value="3">3</option>
            <option value="5" selected>5</option>
            <option value="8">8</option>
          </select>
        </label>
        <label class="toggle">
          <input id="generate" name="generate" type="checkbox" checked />
          답변 생성
        </label>
        <button id="submitBtn" type="submit">비교 실행</button>
      </div>
    </form>
    <pre id="error" class="error"></pre>
    <section class="grid">
      <article class="panel" id="naivePanel">
        <div class="panelHead">
          <h2>Naive RAG</h2>
          <span class="tableName">documents</span>
        </div>
        <div class="answer empty" data-answer>결과 없음</div>
        <div class="evidence" data-evidence></div>
      </article>
      <article class="panel" id="hierarchicalPanel">
        <div class="panelHead">
          <h2>계층형 RAG</h2>
          <span class="tableName">documents_test</span>
        </div>
        <div class="answer empty" data-answer>결과 없음</div>
        <div class="evidence" data-evidence></div>
      </article>
    </section>
  </main>
  <script>
    const form = document.getElementById("queryForm");
    const statusEl = document.getElementById("status");
    const errorEl = document.getElementById("error");
    const submitBtn = document.getElementById("submitBtn");
    const panels = {
      naive: document.getElementById("naivePanel"),
      hierarchical: document.getElementById("hierarchicalPanel"),
    };

    function setStatus(text) {
      statusEl.textContent = text;
    }

    function setError(text) {
      errorEl.textContent = text || "";
      errorEl.style.display = text ? "block" : "none";
    }

    function escapeHtml(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function renderPanel(key, result) {
      const panel = panels[key];
      const answer = panel.querySelector("[data-answer]");
      const evidence = panel.querySelector("[data-evidence]");
      answer.classList.toggle("empty", !result.answer);
      answer.textContent = result.answer || "답변 생성을 끈 상태입니다.";
      evidence.innerHTML = result.hits.map((hit, index) => {
        const meta = hit.metadata || {};
        const path = meta.source_path || [meta.chapter, meta.article_no, meta.article_title].filter(Boolean).join(" > ");
        return [
          '<div class="hit">',
          '<div class="hitMeta">',
          '<span class="rank">' + (index + 1) + '</span>',
          '<span class="score">' + hit.score.toFixed(4) + '</span>',
          '<span class="path">' + escapeHtml(path || "경로 없음") + '</span>',
          '</div>',
          '<p class="snippet">' + escapeHtml(hit.content) + '</p>',
          '</div>',
        ].join("");
      }).join("");
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      setError("");
      setStatus("실행 중");
      submitBtn.disabled = true;

      try {
        const response = await fetch("/api/compare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: document.getElementById("question").value,
            topK: Number(document.getElementById("topK").value),
            generate: document.getElementById("generate").checked,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "요청 실패");
        }
        renderPanel("naive", data.results.naive);
        renderPanel("hierarchical", data.results.hierarchical);
        setStatus(data.elapsedMs + "ms");
      } catch (error) {
        setError(error.message);
        setStatus("오류");
      } finally {
        submitBtn.disabled = false;
      }
    });
  </script>
</body>
</html>`;

if (!SUPABASE_KEY) {
  console.warn("Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_KEY.");
}

if (!COHERE_API_KEY) {
  console.warn("Missing COHERE_API_KEY.");
}

function jsonResponse(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(data));
}

function textResponse(response, statusCode, content, type = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, {
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  response.end(content);
}

function requireConfig() {
  if (!SUPABASE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY 또는 SUPABASE_KEY가 필요합니다.");
  }
  if (!COHERE_API_KEY) {
    throw new Error("COHERE_API_KEY가 필요합니다.");
  }
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    ...extra,
  };
}

function cohereHeaders() {
  return {
    Authorization: `Bearer ${COHERE_API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function cohereEmbed(texts, inputType) {
  const response = await fetch("https://api.cohere.com/v2/embed", {
    method: "POST",
    headers: cohereHeaders(),
    body: JSON.stringify({
      model: COHERE_EMBED_MODEL,
      texts,
      input_type: inputType,
      output_dimension: COHERE_OUTPUT_DIMENSION,
      embedding_types: ["float"],
    }),
  });

  if (!response.ok) {
    throw new Error(`Cohere embed 실패: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const embeddings = Array.isArray(data.embeddings) ? data.embeddings : data.embeddings?.float;

  if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
    throw new Error("Cohere embed 응답 형식이 예상과 다릅니다.");
  }

  return embeddings;
}

async function cohereAnswer(question, label, hits) {
  const context = hits
    .map((hit, index) => {
      const metadata = hit.metadata || {};
      const path =
        metadata.source_path ||
        [metadata.chapter, metadata.article_no, metadata.article_title].filter(Boolean).join(" > ");
      return `[${index + 1}] ${path}\n${hit.content}`;
    })
    .join("\n\n");

  const response = await fetch("https://api.cohere.com/v2/chat", {
    method: "POST",
    headers: cohereHeaders(),
    body: JSON.stringify({
      model: COHERE_CHAT_MODEL,
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        {
          role: "system",
          content:
            "너는 한국 법령 문서 기반 RAG 답변기다. 제공된 근거만 사용하고, 부족하면 부족하다고 말한다. 답변 끝에 사용한 근거 번호를 괄호로 표시한다.",
        },
        {
          role: "user",
          content: `${label}\n\n질문:\n${question}\n\n근거:\n${context}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Cohere chat 실패: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  if (Array.isArray(data.message?.content)) {
    return data.message.content.map((part) => part.text || "").join("").trim();
  }
  if (typeof data.text === "string") {
    return data.text.trim();
  }
  return JSON.stringify(data);
}

async function fetchRows(table) {
  const rows = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const endpoint = new URL(`${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}`);
    endpoint.searchParams.set("select", "id,content,metadata,embedding");
    endpoint.searchParams.set("order", "id.asc");

    const response = await fetch(endpoint, {
      headers: supabaseHeaders({
        Range: `${offset}-${offset + pageSize - 1}`,
      }),
    });

    if (!response.ok) {
      throw new Error(`${table} 조회 실패: ${response.status} ${await response.text()}`);
    }

    const page = await response.json();
    rows.push(...page);

    if (page.length < pageSize) {
      return rows;
    }
  }
}

function parseEmbedding(value) {
  if (Array.isArray(value)) {
    return value.map(Number);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "[]") {
      return null;
    }
    return trimmed
      .replace(/^\[/, "")
      .replace(/\]$/, "")
      .split(",")
      .map((part) => Number(part.trim()));
  }
  return null;
}

function cosine(a, b) {
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  const length = Math.min(a.length, b.length);

  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    aNorm += a[i] * a[i];
    bNorm += b[i] * b[i];
  }

  if (!aNorm || !bNorm) {
    return 0;
  }

  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

async function retrieve(source, queryEmbedding, topK) {
  const rows = await fetchRows(source.table);
  let missing = 0;
  const scored = rows
    .map((row) => {
      const embedding = parseEmbedding(row.embedding);
      if (!embedding) {
        missing += 1;
        return null;
      }
      return {
        id: row.id,
        content: row.content || "",
        metadata: row.metadata || {},
        score: cosine(queryEmbedding, embedding),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return { hits: scored, rowCount: rows.length, missing };
}

async function compare(request, response) {
  requireConfig();

  const started = Date.now();
  const body = JSON.parse(await readBody(request) || "{}");
  const question = String(body.question || "").trim();
  const topK = Math.max(1, Math.min(10, Number(body.topK || 5)));
  const generate = body.generate !== false;

  if (!question) {
    throw new Error("질문을 입력하세요.");
  }

  const [queryEmbedding] = await cohereEmbed([question], "search_query");
  const output = {};

  for (const source of SOURCES) {
    const retrieved = await retrieve(source, queryEmbedding, topK);
    if (retrieved.hits.length === 0) {
      output[source.key] = {
        answer: "",
        hits: [],
        rowCount: retrieved.rowCount,
        missing: retrieved.missing,
      };
      continue;
    }

    output[source.key] = {
      answer: generate ? await cohereAnswer(question, source.label, retrieved.hits) : "",
      hits: retrieved.hits,
      rowCount: retrieved.rowCount,
      missing: retrieved.missing,
    };
  }

  jsonResponse(response, 200, {
    elapsedMs: Date.now() - started,
    results: output,
  });
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/") {
      textResponse(response, 200, html, "text/html; charset=utf-8");
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/compare") {
      await compare(request, response);
      return;
    }

    textResponse(response, 404, "Not found");
  } catch (error) {
    jsonResponse(response, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(PORT, () => {
  console.log(`RAG compare app: http://localhost:${PORT}`);
});
