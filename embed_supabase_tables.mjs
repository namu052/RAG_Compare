const SUPABASE_URL = (process.env.SUPABASE_URL || "https://mvukxwqclfmbnllpywpb.supabase.co").replace(
  /\/$/,
  "",
);
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const COHERE_API_KEY = process.env.COHERE_API_KEY;
const COHERE_EMBED_MODEL = process.env.COHERE_EMBED_MODEL || "embed-v4.0";
const COHERE_OUTPUT_DIMENSION = Number.parseInt(process.env.COHERE_OUTPUT_DIMENSION || "1536", 10);
const TABLES = (process.env.SUPABASE_TABLES || "documents,documents_test")
  .split(",")
  .map((table) => table.trim())
  .filter(Boolean);
const BATCH_SIZE = Number.parseInt(process.env.BATCH_SIZE || "20", 10);
const FORCE_REEMBED = process.env.FORCE_REEMBED === "1";

if (!SUPABASE_KEY) {
  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_KEY.");
}

if (!COHERE_API_KEY) {
  throw new Error("Missing COHERE_API_KEY.");
}

if (!Number.isInteger(COHERE_OUTPUT_DIMENSION) || COHERE_OUTPUT_DIMENSION < 1) {
  throw new Error("COHERE_OUTPUT_DIMENSION must be a positive integer.");
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
      throw new Error(`Failed to fetch ${table}: ${response.status} ${await response.text()}`);
    }

    const page = await response.json();
    rows.push(...page);

    if (page.length < pageSize) {
      return rows;
    }
  }
}

async function embedTexts(texts, inputType) {
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
    throw new Error(`Cohere embed failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const embeddings = Array.isArray(data.embeddings) ? data.embeddings : data.embeddings?.float;

  if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
    throw new Error(`Unexpected Cohere embed response: ${JSON.stringify(data).slice(0, 500)}`);
  }

  return embeddings;
}

async function patchEmbedding(table, id, embedding) {
  const endpoint = new URL(`${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}`);
  endpoint.searchParams.set("id", `eq.${id}`);

  let response = await fetch(endpoint, {
    method: "PATCH",
    headers: supabaseHeaders({
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    }),
    body: JSON.stringify({ embedding }),
  });

  if (response.ok) {
    return;
  }

  const firstError = await response.text();

  response = await fetch(endpoint, {
    method: "PATCH",
    headers: supabaseHeaders({
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    }),
    body: JSON.stringify({ embedding: `[${embedding.join(",")}]` }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to update ${table}.${id}: ${response.status} ${await response.text()}\n` +
        `First attempt: ${firstError}`,
    );
  }
}

function hasEmbedding(row) {
  if (row.embedding == null) {
    return false;
  }
  if (Array.isArray(row.embedding)) {
    return row.embedding.length === COHERE_OUTPUT_DIMENSION;
  }
  if (typeof row.embedding === "string") {
    return row.embedding.length > 2;
  }
  return true;
}

function buildEmbeddingInput(table, row) {
  if (table === "documents_test") {
    const metadata = row.metadata || {};
    return [
      metadata.document_title && `문서: ${metadata.document_title}`,
      metadata.chapter && `장: ${metadata.chapter}`,
      metadata.section && `절: ${metadata.section}`,
      metadata.major_section && `대분류: ${metadata.major_section}`,
      metadata.item_title && `항목: ${metadata.item_title}`,
      metadata.subitem_title && `세부항목: ${metadata.subitem_title}`,
      (metadata.article_no || metadata.article_title) &&
        `조문: ${[metadata.article_no, metadata.article_title].filter(Boolean).join(" ")}`,
      metadata.title && `제목: ${metadata.title}`,
      metadata.chunk_type && `청크유형: ${metadata.chunk_type}`,
      metadata.source_path && `경로: ${metadata.source_path}`,
      `내용: ${row.content || ""}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  return row.content || "";
}

for (const table of TABLES) {
  const rows = await fetchRows(table);
  const targets = rows.filter((row) => FORCE_REEMBED || !hasEmbedding(row));
  console.log(`${table}: ${rows.length} rows, ${targets.length} rows to embed.`);

  for (let offset = 0; offset < targets.length; offset += BATCH_SIZE) {
    const batch = targets.slice(offset, offset + BATCH_SIZE);
    const embeddings = await embedTexts(
      batch.map((row) => buildEmbeddingInput(table, row)),
      "search_document",
    );

    for (let i = 0; i < batch.length; i += 1) {
      await patchEmbedding(table, batch[i].id, embeddings[i]);
    }

    console.log(`${table}: embedded ${offset + 1}-${offset + batch.length}.`);
  }
}

console.log("Embedding update complete.");
