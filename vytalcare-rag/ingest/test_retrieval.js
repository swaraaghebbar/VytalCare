import { QdrantClient } from "@qdrant/js-client-rest";
import dotenv from "dotenv";
dotenv.config();

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const genAIKey = process.env.GEMINI_API_KEY;

import { GoogleGenerativeAI } from "@google/generative-ai";
const genAI = new GoogleGenerativeAI(genAIKey);
const embedModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

async function testSearch(query) {
  console.log("🔎 Embedding query:", query);

  const embedding = await embedModel.embedContent(query);
  const vector = embedding.embedding.values;

  const results = await qdrant.search("medical_knowledge", {
    vector,
    limit: 3,
  });

  console.log("📌 Top matches:");
  console.log(JSON.stringify(results, null, 2));
}

testSearch("What is fever?");
