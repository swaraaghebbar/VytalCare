import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import dotenv from "dotenv";
import chatRagHandler from "./api/chat-rag.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

/* ============================================================
   MIDDLEWARE
============================================================ */

// Security headers (minimal for dev)
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

// Enable gzip compression (20–40% faster responses)
app.use(compression());

// JSON parsing
app.use(express.json({ limit: "2mb" }));

// CORS
app.use(
  cors({
    origin: "*",
    credentials: true,
  })
);

/* ============================================================
   HEALTH CHECK
============================================================ */

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "VytalCare RAG Backend",
    timestamp: new Date().toISOString(),
  });
});

/* ============================================================
   RAG ENDPOINT
============================================================ */

app.post("/api/chat-rag", async (req, res) => {
  try {
    await chatRagHandler(req, res);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({
        error: "Internal server error",
        details: err.message,
      });
    }
  }
});

/* ============================================================
   404 HANDLER
============================================================ */

app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    path: req.path,
    availableRoutes: ["/health", "/api/chat-rag"],
  });
});

/* ============================================================
   START SERVER
============================================================ */

const server = app.listen(PORT, () => {
  console.log(`\n🚀 Backend running on http://localhost:${PORT}`);
});

/* ============================================================
   SERVER TIMEOUT (Prevents port lock)
============================================================ */
server.setTimeout(15000); // 15 seconds safe timeout

/* ============================================================
   CLEAN SHUTDOWN
============================================================ */
process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down...");
  server.close(() => {
    console.log("👋 Server closed gracefully.");
    process.exit(0);
  });
});
