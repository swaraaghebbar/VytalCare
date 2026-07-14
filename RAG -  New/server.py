import os
import sys
import time
import urllib.parse
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from pinecone import Pinecone
from sentence_transformers import SentenceTransformer
from groq import Groq

# ==========================================
# 1. CONFIGURATION
# ==========================================

# Load environment variables from .env
load_dotenv()

PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

if not PINECONE_API_KEY or not GROQ_API_KEY:
    print("[Error] Missing PINECONE_API_KEY or GROQ_API_KEY in .env file.")
    sys.exit(1)

PINECONE_INDEX_NAME = "medlineplus-index"
EMBEDDING_MODEL_NAME = "all-MiniLM-L6-v2"
GROQ_MODEL_NAME = "llama-3.1-8b-instant"

TOP_K = 5
MIN_SIMILARITY_SCORE = 0.35

MAX_RETRIES = 3
RETRY_DELAY = 10

# ==========================================
# 2. INITIALIZATION
# ==========================================

print("[Info] Connecting to services...")

try:
    pc = Pinecone(api_key=PINECONE_API_KEY)
    index = pc.Index(PINECONE_INDEX_NAME)

    embedding_model = SentenceTransformer(
        EMBEDDING_MODEL_NAME
    )

    groq_client = Groq(
        api_key=GROQ_API_KEY
    )

except Exception as e:
    print(f"[Error] Initialization failed: {e}")
    sys.exit(1)

print("[OK] VytalCare is ready.")

# ==========================================
# 3. SESSION REQUEST COUNTER
# ==========================================

request_count = 0

# ==========================================
# 4. BUILD RAG CONTEXT
# ==========================================

def build_context(facts):
    """
    Formats retrieved medical information for the LLM.
    """
    if not facts:
        return None

    context_parts = []
    for i, fact in enumerate(facts, start=1):
        context_parts.append(
            f"[Source {i}]\n{fact}"
        )
    return "\n\n".join(context_parts)

# ==========================================
# 5. QUERY GROQ
# ==========================================

def query_groq_llm(user_question, context):
    """
    Sends the retrieved medical context and user question to Groq.
    Automatically retries after 10 seconds if a rate-limit error occurs.
    """
    global request_count

    system_prompt = """
You are VytalCare, a helpful, accurate, and professional medical information assistant.

Answer the user's question using ONLY the information provided in the retrieved medical context.

RULES:

1. Use only the retrieved medical context to answer the question.
2. Do not add medical facts from your own pretrained knowledge.
3. Do not invent or assume information.
4. If the context does not contain enough information to answer the question, say:
   "I could not find enough information in the medical knowledge base to answer this question."
5. If only part of the question can be answered, answer that part and clearly state that the remaining information was not available.
6. Do not mention Pinecone, embeddings, vector databases, RAG, similarity scores, or implementation details.
7. Do not claim to provide a medical diagnosis.
8. Keep the response clear, professional, helpful, and easy to understand.
"""

    user_prompt = f"""
RETRIEVED MEDICAL CONTEXT:

{context}


USER QUESTION:

{user_question}


Answer the user's question using only the retrieved medical context.
"""

    for attempt in range(MAX_RETRIES + 1):
        try:
            request_count += 1

            response = groq_client.chat.completions.create(
                model=GROQ_MODEL_NAME,
                messages=[
                    {
                        "role": "system",
                        "content": system_prompt
                    },
                    {
                        "role": "user",
                        "content": user_prompt
                    }
                ],
                temperature=0.1,
                max_tokens=700
            )

            return (
                response
                .choices[0]
                .message
                .content
                .strip()
            )

        except Exception as e:
            error_message = str(e)
            is_rate_limit_error = (
                "429" in error_message
                or "rate_limit" in error_message.lower()
                or "rate limit" in error_message.lower()
            )

            if is_rate_limit_error:
                if attempt >= MAX_RETRIES:
                    return (
                        "The service is currently experiencing "
                        "high demand. Please wait and try again later."
                    )

                print(f"[Warning] Rate limit hit... Automatically retrying in {RETRY_DELAY} seconds...")
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
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
    })

@app.route("/api/chat-rag", methods=["POST"])
def chat_rag():
    data = request.get_json() or {}
    user_question = data.get("message")
    
    if not user_question or not isinstance(user_question, str):
        return jsonify({"error": "Missing or invalid 'message' field."}), 400

    # 1. Retrieve relevant facts and titles from Pinecone
    facts = []
    titles = []
    
    try:
        query_vector = embedding_model.encode(user_question).tolist()
        result = index.query(
            vector=query_vector,
            top_k=TOP_K,
            include_metadata=True
        )

        for match in result.get("matches", []):
            metadata = match.get("metadata", {})
            text = (
                metadata.get("text")
                or metadata.get("content")
                or metadata.get("chunk")
                or ""
            )
            score = match.get("score", 0)
            title = metadata.get("title")

            if text and score >= MIN_SIMILARITY_SCORE:
                facts.append(text)
                if title:
                    titles.append(title)
                    
    except Exception as e:
        print(f"[Warning] Knowledge retrieval error: {e}")
        # Proceed with empty facts if Pinecone fails

    # 2. Map titles to unique MedlinePlus search URLs
    unique_titles = []
    for t in titles:
        if t not in unique_titles:
            unique_titles.append(t)
            
    sources = [
        f"https://medlineplus.gov/search.html?query={urllib.parse.quote_plus(t)}"
        for t in unique_titles
    ]

    # 3. If no relevant info was retrieved, do not call the LLM
    if not facts:
        return jsonify({
            "reply": "I could not find enough information in the medical knowledge base to answer this question.",
            "sources": []
        })

    # 4. Build context
    context = build_context(facts)

    # 5. Query Groq
    reply = query_groq_llm(user_question=user_question, context=context)

    return jsonify({
        "reply": reply,
        "sources": sources
    })

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3001))
    print(f"\n[Info] Python Backend running on http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
