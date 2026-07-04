import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { QdrantClient } from "@qdrant/js-client-rest";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Embedding model does NOT use the "generative model" API structure
const embedModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

// -------- SUMMARY CLEANER ----------
function extractSummaryText(summary) {
  if (!summary) return "";

  // If it's already a string
  if (typeof summary === "string") {
    return summary.replace(/<[^>]*>/g, "").trim();
  }

  // If summary is an array of summary blocks
  if (Array.isArray(summary)) {
    return summary
      .map(item => extractSummaryText(item))
      .join("\n")
      .trim();
  }

  // If it's an object with nested content
  if (typeof summary === "object") {
    // MedlinePlus Connect usually formats like:
    // { "div": { "p": [ "...", "..." ] } }
    if (summary.content) return extractSummaryText(summary.content);

    const collected = [];

    for (const key in summary) {
      const value = summary[key];
      collected.push(extractSummaryText(value));
    }

    return collected.join("\n").trim();
  }

  return "";
}

// -------- ENTRY → PLAIN TEXT ----------
function entryToText(entry) {
  const cleanSummary = extractSummaryText(entry.summary);

  return `
TITLE: ${entry.title?._value || entry.title}
URL: ${entry.url}

SUMMARY:
${cleanSummary}
  `.trim();
}


// -------- EMBED + UPLOAD ----------
export async function embedAndUpload(entries, term) {
  for (const entry of entries) {
    const text = entryToText(entry);

    // CORRECT embedding request for Gemini
    const embeddingResponse = await embedModel.embedContent(text);

    const vector = embeddingResponse.embedding.values;

    await qdrant.upsert("medical_knowledge", {
      points: [
        {
          id: Date.now() + Math.floor(Math.random() * 10000),
          vector,
          payload: {
            term,
            title: entry.title,
            summary: extractSummaryText(entry.summary),
            url: entry.url,
          },
        },
      ],
    });

    console.log(`✅ Uploaded embedding for: ${entry.title}`);
  }
}
