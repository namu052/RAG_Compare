import { readFileSync } from "node:fs";

const DEFAULT_SUPABASE_URL = "https://mvukxwqclfmbnllpywpb.supabase.co";

const supabaseUrl = (process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, "");
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY;
const table = process.env.SUPABASE_TABLE || "chunks";
const file = process.env.CHUNKS_FILE || "chunks.json";
const mode = (process.env.IMPORT_MODE || "upsert").toLowerCase();
const rowFormat = (process.env.ROW_FORMAT || (table === "documents" ? "documents" : "chunks")).toLowerCase();
const dryRun = process.env.DRY_RUN === "1";
const resetTable = process.env.RESET_TABLE === "1";
const batchSize = Number.parseInt(process.env.BATCH_SIZE || "500", 10);

if (!supabaseKey && !dryRun) {
  throw new Error(
    "Missing Supabase key. Set SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, or SUPABASE_KEY.",
  );
}

if (!["insert", "upsert"].includes(mode)) {
  throw new Error("IMPORT_MODE must be either insert or upsert.");
}

if (!["chunks", "documents"].includes(rowFormat)) {
  throw new Error("ROW_FORMAT must be either chunks or documents.");
}

if (!Number.isInteger(batchSize) || batchSize < 1) {
  throw new Error("BATCH_SIZE must be a positive integer.");
}

const rawInput = readFileSync(file, "utf8");

function parseRows(input) {
  const trimmed = input.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error("Top-level JSON value must be an array.");
    }
    return parsed;
  }

  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSON on line ${index + 1}: ${error.message}`);
      }
    });
}

const sourceRows = parseRows(rawInput);

function documentId(row, index) {
  if (Number.isInteger(row.chunk_id)) {
    return row.chunk_id;
  }

  if (typeof row.chunk_id === "string") {
    const exactNumber = Number(row.chunk_id);
    if (Number.isInteger(exactNumber)) {
      return exactNumber;
    }

    const suffix = row.chunk_id.match(/(\d+)$/)?.[1];
    if (suffix) {
      return Number.parseInt(suffix, 10);
    }
  }

  return index + 1;
}

const rows = sourceRows.map((row, index) => {
  const id = documentId(row, index);
  if (!Number.isInteger(id)) {
    throw new Error(`Row ${index + 1}: chunk_id must be an integer or end with digits.`);
  }

  const content = row.text ?? row.content;
  if (typeof content !== "string") {
    throw new Error(`Row ${index + 1}: text or content must be a string.`);
  }

  if ("token_count" in row && !Number.isInteger(row.token_count)) {
    throw new Error(`Row ${index + 1}: token_count must be an integer when present.`);
  }

  if (rowFormat === "documents") {
    const { text, content: _content, ...metadata } = row;
    return {
      id,
      content,
      metadata: {
        source: file,
        ...metadata,
      },
    };
  }

  return {
    chunk_id: id,
    text: content,
    token_count: row.token_count,
  };
});

console.log(`Parsed ${rows.length} rows from ${file}.`);
console.log(`Target: ${supabaseUrl}/rest/v1/${table} (${mode}, ${rowFormat} format)`);

if (dryRun) {
  console.log("DRY_RUN=1 set; no rows were uploaded.");
  process.exit(0);
}

if (resetTable) {
  const endpoint = new URL(`${supabaseUrl}/rest/v1/${encodeURIComponent(table)}`);
  endpoint.searchParams.set("id", "not.is.null");

  const response = await fetch(endpoint, {
    method: "DELETE",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: "return=minimal",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to reset ${table}: ${response.status} ${await response.text()}`);
  }

  console.log(`Reset ${table}.`);
}

for (let offset = 0; offset < rows.length; offset += batchSize) {
  const batch = rows.slice(offset, offset + batchSize);
  const endpoint = new URL(`${supabaseUrl}/rest/v1/${encodeURIComponent(table)}`);

  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    "Content-Type": "application/json",
    Prefer: mode === "upsert" ? "resolution=merge-duplicates,return=minimal" : "return=minimal",
  };

  if (mode === "upsert") {
    endpoint.searchParams.set("on_conflict", rowFormat === "documents" ? "id" : "chunk_id");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(batch),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Upload failed for rows ${offset + 1}-${offset + batch.length}: ` +
        `${response.status} ${response.statusText}\n${body}`,
    );
  }

  console.log(`Uploaded rows ${offset + 1}-${offset + batch.length}.`);
}

console.log(`Done. Uploaded ${rows.length} rows.`);
