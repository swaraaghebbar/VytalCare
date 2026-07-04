// ingest/retrieve_context.js

import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { QdrantClient } from "@qdrant/js-client-rest";

dotenv.config();

// Gemini embedding model
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embedModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

// Qdrant client
const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

/**
 * Convert user question → embedding → Qdrant search → relevant context
 */
export async function retrieveContext(query, topK = 3) {
  console.log(`🔎 Embedding user query for retrieval: "${query}"`);

  // 1️⃣ Embed the user query
  const embeddingResponse = await embedModel.embedContent(query);
  const queryVector = embeddingResponse.embedding.values;

  // 2️⃣ Search Qdrant for similar medical documents
  const searchResult = await qdrant.search("medical_knowledge", {
    vector: queryVector,
    limit: topK,
  });

  console.log(`📡 Found ${searchResult.length} relevant documents.`);

  // 3️⃣ Extract raw text context
  const context = searchResult
    .map((hit, i) => {
      const p = hit.payload;

      return `
[RESULT ${i + 1}]
TITLE: ${p.title}
URL: ${p.url}

SUMMARY:
${p.summary}
`;
    })
    .join("\n");

  return context.trim();
}
