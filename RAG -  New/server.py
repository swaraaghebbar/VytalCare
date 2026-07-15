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

def classify_query(user_question):
    """
    Uses Groq to quickly classify if the query is about 
    medicines, diseases, or both.
    """
    system_prompt = """
You are a routing assistant for a medical chatbot.
Determine if the user's query is asking about:
1. A drug, pill, medicine, vaccine, or supplement (return 'medicine')
2. A disease, virus, medical condition, symptom, or syndrome (return 'disease')
3. Both, or if it's a general question combining them (e.g., "What medicine treats diabetes?") (return 'both')

Answer with EXACTLY one of those words: medicine, disease, or both. Do not include punctuation, markdown, or other text.
"""
    try:
        response = groq_client.chat.completions.create(
            model=GROQ_MODEL_NAME, # Uses your fast llama model
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Query: {user_question}"}
            ],
            temperature=0.0, # Zero temperature ensures strict consistency
            max_tokens=10
        )
        classification = response.choices[0].message.content.strip().lower()
        
        # Guardrail check
        # Clean up asterisks, periods, and whitespace
        classification = response.choices[0].message.content.strip().lower()
        classification = classification.replace("*", "").replace(".", "").strip()

        if classification in ["medicine", "disease", "both"]:
            return classification
        return "both" # Fallback if LLM deviates
    except Exception as e:
        print(f"[Warning] Classification failed: {e}. Defaulting to 'both'.")
        return "both" # Fallback to prevent app crash
    
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
You are VytalCare, a professional, accurate, and compassionate medical information assistant.

Your role is to answer the user's question using ONLY the information provided in the retrieved medical context.

STRICT RULES:
1. Use ONLY the retrieved medical context to answer the user's question. Do NOT use your own pretrained knowledge or invent facts.
2. If the context does not contain enough information to answer, respond exactly:
   "I could not find enough information in the medical knowledge base to answer this question."
   Do NOT generate any headings, bullet points, or empty sections if you do not have enough information.
3. Do NOT mention retrieved documents, sources, references, Pinecone, RAG, similarity scores, or implementation details. Present every response as if VytalCare is naturally generating the answer.
4. Do NOT claim to diagnose medical conditions or replace professional medical advice.
5. If only part of the question can be answered, answer only that portion and state that the remaining information was not available.

RESPONSE FORMATTING (MANDATORY):
If and ONLY if you have sufficient medical context, organize your response using this exact structure. 
Do NOT use "##" or any other heading markdown symbols. Instead, use bold text (e.g., **Heading**) on its own line for headings.

**Overview**
Provide a concise, 1-2 sentence explanation of the topic based on the context.

**Key Information**
Here is the key clinical information regarding this topic:
- Provide at least 6 distinct, detailed bullet points (use hyphens "-", NEVER use numbers here) about uses, precautions, or key facts mentioned in the context.

**How to Use**
Follow these steps for proper administration and usage:
1. First step.
2. Second step.
3. Third step.
*(Use standard numbers "1.", "2.", "3." ONLY under this heading. This ensures it always starts fresh at 1).*

**Possible Side Effects**
Be aware of the following potential side effects mentioned in the context:
- Bullet list of side effects (use hyphens "-", NEVER use numbers here).

**Warnings**
Please note the following important warnings and precautions:
- Warning bullet point (use hyphens "-", NEVER use numbers here).
- Another warning bullet point (use hyphens "-", NEVER use numbers here).

*Note: Only include a section if the context contains information for it. Do not create empty sections or write "no information available."*
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

    # 1. Classify which medical channel to route to
    channel = classify_query(user_question)
    print(f"🧭 Routed query '{user_question[:30]}...' to channel: {channel}")

    # 2. Build the Pinecone metadata filter based on the routed channel
    pinecone_filter = {}
    if channel == "medicine":
        pinecone_filter = {"category": "medicine"}
    elif channel == "disease":
        pinecone_filter = {"category": "disease"}
    # If the channel is 'both', pinecone_filter remains empty to search the entire database[cite: 3]

    # 3. Retrieve relevant facts from Pinecone with the filter active
    facts = []
    titles = []
    
    try:
        query_vector = embedding_model.encode(user_question).tolist()
        result = index.query(
            vector=query_vector,
            top_k=TOP_K,
            filter=pinecone_filter, # 👈 Crucial: Only matches records matching the filter[cite: 3]
            include_metadata=True
        )
        print(f"DEBUG: Pinecone returned {len(result.get('matches', []))} raw matches.")
        for idx, match in enumerate(result.get("matches", [])):
            print(f"   Match {idx}: Score={match.get('score')}, Metadata={match.get('metadata')}")


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

    # 4. Map titles to unique MedlinePlus search URLs[cite: 3]
    unique_titles = []
    for t in titles:
        if t not in unique_titles:
            unique_titles.append(t)
            
    sources = [
        f"https://medlineplus.gov/search.html?query={urllib.parse.quote_plus(t)}"
        for t in unique_titles
    ]

# 5. If no relevant info was retrieved, stop immediately BEFORE calling the LLM!
    if not facts:
        return jsonify({
            "reply": "I could not find enough information in the medical knowledge base to answer this question.",
            "sources": []
        })

    # 6. Build RAG context and query Groq only if we have facts
    context = build_context(facts)
    reply = query_groq_llm(user_question=user_question, context=context)

    return jsonify({
        "reply": reply,
        "sources": sources
    })

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3001))
    print(f"\n[Info] Python Backend running on http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
