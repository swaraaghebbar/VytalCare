import { StateGraph } from "@langchain/langgraph";
import fetch from "node-fetch";
import { QdrantClient } from "@qdrant/js-client-rest";
import dotenv from "dotenv";
dotenv.config();

/* ============================================================
   QDRANT CLIENT
============================================================ */
const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
  checkCompatibility: false,
});

/* ============================================================
   GEMINI HELPERS (REST API v1)
============================================================ */
const GEMINI_MODEL = "models/gemini-2.5-flash";
const GEMINI_URL = (key) =>
  `https://generativelanguage.googleapis.com/v1/${GEMINI_MODEL}:generateContent?key=${key}`;

async function askGemini(prompt) {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
  const response = await fetch(GEMINI_URL(process.env.GEMINI_API_KEY), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    }),
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(json?.error?.message || `Gemini error ${response.status}`);
  }
  return json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function embed(text) {
  if (!process.env.GEMINI_API_KEY)
    throw new Error("GEMINI_API_KEY not set for embeddings");

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/text-embedding-004:embedContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: { parts: [{ text }] } }),
    }
  );

  const json = await resp.json();
  if (!resp.ok) throw new Error(json?.error?.message || "Embedding failed");
  return json.embedding?.values || [];
}

/* ============================================================
   NODE 1 — Analyze
============================================================ */
async function nodeAnalyze(state) {
  const prompt = `
You are a medical pre-screening AI. Analyze the user's message and output structured JSON.

USER MESSAGE:
${state.message}

Respond ONLY in valid JSON:
{
  "category": "symptoms | test_report | general_question",
  "triage": "low | medium | high",
  "needs_doctor": true/false,
  "followup_question": "string"
}
`;

  try {
    const output = await askGemini(prompt);
    const parsed = JSON.parse(output);
    return {
      ...state,
      category: parsed.category || "general_question",
      triage: parsed.triage || "low",
      needs_doctor: Boolean(parsed.needs_doctor),
      followup_question: parsed.followup_question || "",
    };
  } catch {
    return {
      ...state,
      category: "general_question",
      triage: "low",
      needs_doctor: false,
      followup_question: "",
    };
  }
}

/* ============================================================
   NODE 2 — Retrieve
============================================================ */
async function nodeRetrieve(state) {
  try {
    const vec = await embed(state.message);
    const results = await qdrant.search("medical_knowledge", {
      vector: vec,
      limit: 4,
    });

    const context = results
      .map(
        (r, i) => `
[Document ${i + 1}]
TITLE: ${r.payload?.title || "Untitled"}
SUMMARY: ${r.payload?.summary || "(No summary)"}
URL: ${r.payload?.url || "No URL"}
`
      )
      .join("\n");

    const sources = results
      .map((r) => r.payload?.url)
      .filter(Boolean);

    return { ...state, context, sources };
  } catch {
    return { ...state, context: "" };
  }
}

/* ============================================================
   NODE 3 — Final Answer
============================================================ */
async function nodeFinal(state) {
  const prompt = `
You are VytalCare Medical Assistant.

USER QUESTION:
${state.message}

TRIAGE LEVEL:
${state.triage}

FOLLOW-UP QUESTION:
${state.followup_question}

NEEDS DOCTOR:
${state.needs_doctor}

RETRIEVED MEDICAL CONTEXT:
${state.context || "No context available"}

Write a clear, safe medical answer that:
- Uses the context
- Provides correct info
- Does NOT diagnose
- Does NOT prescribe medication

FORMAT:
ANSWER:
(clear explanation in simple language)

WHAT YOU CAN DO:
- practical steps
- home care advice

WHEN TO SEE A DOCTOR:
- warning signs
- emergency symptoms

DISCLAIMER:
This is general information, not a medical diagnosis.
`;

  try {
    const answer = await askGemini(prompt);
    return { ...state, answer };
  } catch {
    return {
      ...state,
      answer: "Sorry, I couldn’t generate a response right now.",
    };
  }
}

/* ============================================================
   LANGGRAPH DEFINITION
============================================================ */
const graph = new StateGraph({
  channels: {
  message: "string",
  category: "string",
  triage: "string",
  needs_doctor: "boolean",
  followup_question: "string",
  context: "string",
  sources: "array",        // ✅ ADD THIS
  answer: "string",
},
});

graph.addNode("analyze", nodeAnalyze);
graph.addNode("retrieve", nodeRetrieve);
graph.addNode("final", nodeFinal);

/* ============================================================
   ✅ FIX — GRAPH EDGES + COMPILE
============================================================ */
graph.addEdge("__start__", "analyze");
graph.addEdge("analyze", "retrieve");
graph.addEdge("retrieve", "final");
graph.addEdge("final", "__end__");

export default graph.compile();
