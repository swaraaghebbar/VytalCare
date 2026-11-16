import os
import sys
import time
import urllib.parse
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from pinecone import Pinecone
import google.generativeai as genai

# ==========================================
# 1. CONFIGURATION
# ==========================================

load_dotenv()

PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if not PINECONE_API_KEY or not GEMINI_API_KEY:
    print("[Error] Missing PINECONE_API_KEY or GEMINI_API_KEY in .env file.")
    sys.exit(1)

PINECONE_INDEX_NAME = "medlineplus-index"
INFERENCE_MODEL_NAME = "multilingual-e5-large"
GEMINI_MODEL_NAME = "gemini-2.5-flash"

TOP_K = 5
MIN_SIMILARITY_SCORE = 0.10

MAX_RETRIES = 3
RETRY_DELAY = 10

# ==========================================
# 2. INITIALIZATION
# ==========================================

print("[Info] Connecting to services...")
try:
    pc = Pinecone(api_key=PINECONE_API_KEY)
    index = pc.Index(PINECONE_INDEX_NAME)
    genai.configure(api_key=GEMINI_API_KEY)
    gemini_client = genai.GenerativeModel(GEMINI_MODEL_NAME)
except Exception as e:
    print(f"[Error] Initialization failed: {e}")
    sys.exit(1)

print("[OK] VytalCare is ready.")

# ==========================================
# 3. CLASSIFY QUERY
# ==========================================

def classify_query(user_question):
    """Classify the user question as medicine, disease, or both."""
    system_prompt = """You are a routing assistant for a medical chatbot.
Determine if the user's query is asking about:
1. A drug, pill, medicine, vaccine, or supplement (return 'medicine')
2. A disease, virus, medical condition, symptom, or syndrome (return 'disease')
3. Both, or if it's a general question combining them (return 'both')

Answer with EXACTLY one of those words: medicine, disease, or both. Do not include punctuation, markdown, or other text."""

    try:
        response = gemini_client.generate_content(
            f"{system_prompt}\n\nQuery: {user_question}",
            generation_config=genai.GenerationConfig(
                temperature=0.0,
                max_output_tokens=10
            )
        )
        classification = response.text.strip().lower()
        classification = classification.replace("*", "").replace(".", "").strip()
        if classification in ["medicine", "disease", "both"]:
            return classification
        return "both"
    except Exception as e:
        print(f"[Warning] Classification failed: {e}. Defaulting to 'both'.")
        return "both"

# ==========================================
# 4. BUILD RAG CONTEXT
# ==========================================

def build_context(facts):
    """Combine retrieved facts into a single context string."""
    if not facts:
        return None
    parts = []
    for i, fact in enumerate(facts, start=1):
        parts.append(f"[Source {i}]\n{fact}")
    return "\n\n".join(parts)

# ==========================================
# 5. QUERY GEMINI
# ==========================================

def query_gemini_llm(user_question, context):
    """Send the context and question to Gemini, with retry on rate limits."""
    system_prompt = """You are VytalCare, a professional, accurate, and compassionate medical information assistant.

Your role is to answer the user's question using ONLY the information provided in the retrieved medical context.

STRICT RULES:
1. Use ONLY the retrieved medical context. Do NOT use your own pretrained knowledge or invent facts.
2. If the context does not contain enough information, respond exactly:
   "I could not find enough information in the medical knowledge base to answer this question."
3. Do NOT mention retrieved documents, sources, references, Pinecone, RAG, or implementation details.
4. Do NOT claim to diagnose medical conditions or replace professional medical advice.
5. If only part of the question can be answered, answer only that portion.

RESPONSE FORMATTING (MANDATORY):
If you have sufficient context, organize your response using this exact structure (bold headings, no ## symbols):

**Overview**
Provide a concise, 1-2 sentence explanation of the topic.

**Key Information**
Here is the key clinical information regarding this topic:
- At least 6 distinct bullet points (use hyphens "-", NOT numbers).

**How to Use**
Follow these steps:
1. First step.
2. Second step.
3. Third step.

**Possible Side Effects**
- List side effects (hyphens only).

**Warnings**
- Warning bullet point.
- Another warning bullet point.

Only include a section if the context contains information for it."""

    full_prompt = f"""{system_prompt}

RETRIEVED MEDICAL CONTEXT:
{context}

USER QUESTION:
{user_question}

Answer the user's question using only the retrieved medical context."""

    for attempt in range(MAX_RETRIES + 1):
        try:
            response = gemini_client.generate_content(
                full_prompt,
                generation_config=genai.GenerationConfig(
                    temperature=0.1,
                    max_output_tokens=700
                )
            )
            return response.text.strip()
        except Exception as e:
            err = str(e).lower()
            if "429" in err or "quota" in err or "rate" in err:
                if attempt >= MAX_RETRIES:
                    return "The service is currently experiencing high demand. Please wait and try again later."
                print(f"[Warning] Rate limit hit... retrying in {RETRY_DELAY}s")
                time.sleep(RETRY_DELAY)
                continue
            return f"❌ Error communicating with the AI service: {e}"
    return "❌ Unable to generate a response."

# ==========================================
# 6. FLASK SERVER SETUP & ROUTES
# ==========================================

app = Flask(__name__)
CORS(app)

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "service": "VytalCare RAG Backend",
        "model": GEMINI_MODEL_NAME,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
    })

@app.route("/api/chat-rag", methods=["POST"])
def chat_rag():
    data = request.get_json() or {}
    user_question = data.get("message")
    if not user_question or not isinstance(user_question, str):
        return jsonify({"error": "Missing or invalid 'message' field."}), 400

    channel = classify_query(user_question)
    print(f"🧭 Routed query '{user_question[:30]}...' to channel: {channel}")
    pinecone_filter = {"category": channel} if channel in {"medicine", "disease"} else {}

    # Retrieve facts from Pinecone
    facts = []
    titles = []
    try:
        res = pc.inference.embed(
            model=INFERENCE_MODEL_NAME,
            inputs=[user_question],
            parameters={"input_type": "query"}
        )
        query_vector = res.data[0].values
        result = index.query(
            vector=query_vector,
            top_k=TOP_K,
            filter=pinecone_filter,
            include_metadata=True
        )
        print(f"DEBUG: Pinecone returned {len(result.get('matches', []))} raw matches.")
        for match in result.get("matches", []):
            metadata = match.get("metadata", {})
            text = metadata.get("text") or metadata.get("content") or metadata.get("chunk") or ""
            score = match.get("score", 0)
            title = metadata.get("title")
            if text and score >= MIN_SIMILARITY_SCORE:
                facts.append(text)
                if title:
                    titles.append(title)
    except Exception as e:
        print(f"[Warning] Knowledge retrieval error: {e}")

    if not facts:
        return jsonify({
            "reply": "I could not find enough information in the medical knowledge base to answer this question.",
            "sources": []
        })

    context = build_context(facts)
    reply = query_gemini_llm(user_question=user_question, context=context)

    unique_titles = []
    for t in titles:
        if t not in unique_titles:
            unique_titles.append(t)
    sources = [f"https://medlineplus.gov/search.html?query={urllib.parse.quote_plus(t)}" for t in unique_titles]

    return jsonify({"reply": reply, "sources": sources})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3001))
    print(f"\n[Info] Python Backend running on http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
