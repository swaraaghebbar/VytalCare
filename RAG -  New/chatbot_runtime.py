import os
import sys
import time

from dotenv import load_dotenv
from pinecone import Pinecone
from sentence_transformers import SentenceTransformer
import google.generativeai as genai

# ==========================================
# 1. CONFIGURATION
# ==========================================

load_dotenv()

PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if not PINECONE_API_KEY or not GEMINI_API_KEY:
    print("❌ Error: Missing PINECONE_API_KEY or GEMINI_API_KEY in .env file.")
    sys.exit(1)

PINECONE_INDEX_NAME = "medlineplus-index"
EMBEDDING_MODEL_NAME = "all-MiniLM-L6-v2"
GEMINI_MODEL_NAME = "gemini-3.5-flash-lite"

TOP_K = 5
MIN_SIMILARITY_SCORE = 0.35

MAX_RETRIES = 3
RETRY_DELAY = 10

# ==========================================
# 2. INITIALIZATION
# ==========================================

print("🔌 Connecting to services...")

try:
    pc = Pinecone(api_key=PINECONE_API_KEY)
    index = pc.Index(PINECONE_INDEX_NAME)

    embedding_model = SentenceTransformer(
        EMBEDDING_MODEL_NAME
    )

    genai.configure(api_key=GEMINI_API_KEY)
    gemini_client = genai.GenerativeModel(GEMINI_MODEL_NAME)

except Exception as e:
    print(f"❌ Initialization failed: {e}")
    sys.exit(1)

print("✅ VytalCare is ready.")

# ==========================================
# 3. SESSION REQUEST COUNTER
# ==========================================

request_count = 0

# ==========================================
# 4. RETRIEVE RELEVANT CONTEXT
# ==========================================

def retrieve_facts(query, top_k=TOP_K):
    """
    Converts the user's question into an embedding
    and retrieves relevant medical information from Pinecone.
    """
    try:
        query_vector = embedding_model.encode(query).tolist()

        result = index.query(
            vector=query_vector,
            top_k=top_k,
            include_metadata=True
        )

        retrieved_facts = []

        for match in result.get("matches", []):
            metadata = match.get("metadata", {})
            text = (
                metadata.get("text")
                or metadata.get("content")
                or metadata.get("chunk")
                or ""
            )
            score = match.get("score", 0)

            if text and score >= MIN_SIMILARITY_SCORE:
                retrieved_facts.append(text)

        return retrieved_facts

    except Exception as e:
        print(f"❌ Pinecone query failed: {e}")
        return []

# ==========================================
# 5. BUILD CONTEXT STRING
# ==========================================

def build_context(facts):
    """Combines retrieved facts into a single structured string."""
    if not facts:
        return None

    context_parts = []
    for i, fact in enumerate(facts, start=1):
        context_parts.append(f"[Source {i}]\n{fact}")

    return "\n\n".join(context_parts)

# ==========================================
# 6. QUERY GEMINI LLM
# ==========================================

def query_gemini(user_question, context):
    """Sends the context and question to Gemini 2.5 Flash."""
    global request_count

    system_prompt = """You are VytalCare, a professional, accurate, and compassionate medical information assistant.

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
If and ONLY if you have sufficient medical context, organize your response using this exact structure:

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
*(Use standard numbers "1.", "2.", "3." ONLY under this heading).*

**Possible Side Effects**
Be aware of the following potential side effects mentioned in the context:
- Bullet list of side effects (use hyphens "-", NEVER use numbers here).

**Warnings**
Please note the following important warnings and precautions:
- Warning bullet point (use hyphens "-", NEVER use numbers here).
- Another warning bullet point (use hyphens "-", NEVER use numbers here).

*Note: Only include a section if the context contains information for it.*"""

    full_prompt = f"""{system_prompt}

RETRIEVED MEDICAL CONTEXT:
{context}

USER QUESTION:
{user_question}

Answer the user's question using only the retrieved medical context."""

    for attempt in range(MAX_RETRIES + 1):
        try:
            request_count += 1
            response = gemini_client.generate_content(
                full_prompt,
                generation_config=genai.GenerationConfig(
                    temperature=0.1,
                    max_output_tokens=2048
                )
            )
            return response.text.strip()

        except Exception as e:
            err = str(e).lower()
            if "429" in err or "quota" in err or "rate" in err:
                if attempt >= MAX_RETRIES:
                    return (
                        "The service is currently experiencing "
                        "high demand. Please wait and try again later."
                    )
                print(f"⚠️ Rate limit hit. Retrying in {RETRY_DELAY} seconds...")
                time.sleep(RETRY_DELAY)
                continue

            return f"❌ Error communicating with the AI service: {e}"

    return "❌ Unable to generate a response."

# ==========================================
# 7. MAIN INTERACTIVE LOOP
# ==========================================

def run_chatbot():
    print("=" * 50)
    print("🏥 Welcome to VytalCare Medical Assistant")
    print("=" * 50)
    print("Ask any medical question. Type 'exit' or 'quit' to end.\n")

    while True:
        try:
            user_question = input("User: ").strip()

            if not user_question:
                continue

            if user_question.lower() in ["exit", "quit"]:
                print("\n👋 Stay healthy! Goodbye.")
                break

            print("\n🔍 Searching medical knowledge base...")
            facts = retrieve_facts(user_question)

            if not facts:
                print(
                    "\nVytalCare: I could not find enough information "
                    "in the medical knowledge base to answer this question.\n"
                )
                continue

            print("🧠 Generating response with Gemini 2.5 Flash...")
            context = build_context(facts)
            answer = query_gemini(user_question, context)

            print(f"\nVytalCare:\n{answer}\n")
            print("-" * 50)

        except KeyboardInterrupt:
            print("\n\n👋 Session ended. Goodbye.")
            break
        except Exception as e:
            print(f"\n❌ Unexpected error: {e}\n")


if __name__ == "__main__":
    run_chatbot()
