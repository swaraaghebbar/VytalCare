// /api/chat-rag.js
import dotenv from "dotenv";
import medicalGraph from "../workflow/medical-graph.js";

dotenv.config();

// Helper: timeout wrapper (prevents long Gemini waits)
function timeoutPromise(ms) {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Request timed out")), ms)
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  try {
    const { message, history } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Missing or invalid 'message' field.",
      });
    }

    // Call LangGraph with timeout (prevents free-tier hangs)
    const result = await Promise.race([
      medicalGraph.invoke({
        message,
        history: Array.isArray(history) ? history : [],
      }),
      timeoutPromise(10000), // 10s
    ]);

    const reply =
      result?.answer ||
      "I'm sorry — no response was generated. (Empty LangGraph output)";

    return res.status(200).json({
      reply,
      sources: result?.sources || [],
    });
  } catch (err) {
    // Fallback: return a graceful message instead of 500 so frontend still shows a reply
    return res.status(200).json({
      reply: "I’m sorry, I couldn’t process that request right now. Please try again in a moment.",
      sources: [],
      error: "Backend RAG request failed via LangGraph",
      details: err.message,
    });
  }
}
