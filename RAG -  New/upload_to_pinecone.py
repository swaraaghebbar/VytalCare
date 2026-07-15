import os
import time
import unicodedata
from dotenv import load_dotenv
from pinecone import Pinecone
from sentence_transformers import SentenceTransformer
from parse_data import diagnose_and_parse
from langchain_text_splitters import RecursiveCharacterTextSplitter

def clean_id_to_ascii(text_id):
    """Translates accented characters (like á, ó, ñ) into basic ASCII counterparts (a, o, n) for Pinecone safety."""
    normalized = unicodedata.normalize('NFKD', text_id)
    ascii_id = normalized.encode('ascii', 'ignore').decode('ascii')
    ascii_id = ascii_id.replace(' ', '-').replace('/', '-')
    clean_id = "".join([c for c in ascii_id if c.isalnum() or c in ['-', '_']])
    return clean_id

# 1. Load environment variables & verify API key
load_dotenv()
api_key = os.getenv("PINECONE_API_KEY")

if not api_key or api_key == "your_copied_api_key_here":
    raise ValueError("❌ Error: Please set your PINECONE_API_KEY inside the '.env' file!")

# 2. Re-run our parsing & chunking logic to pull clean data
xml_file = 'mplus_topics_2026-07-14.xml'
documents = diagnose_and_parse(xml_file)

if not documents:
    raise ValueError("❌ Error: No parsed documents found. Ensure the XML file exists.")

# Split text into chunks
text_splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)
final_chunks = []
for doc in documents:
    splits = text_splitter.split_text(doc['text'])
    for i, split in enumerate(splits):
        # Apply our new ASCII-safe ID cleaner
        raw_id = f"{doc['title']}-{i}"
        clean_id = clean_id_to_ascii(raw_id)
        
        final_chunks.append({
            "id": clean_id,
            "text": split,
            "title": doc['title']
        })

print(f"Loaded {len(final_chunks)} chunks for vectorization.")

# 3. Load the 384-dimension embedding model locally
print("⏳ Loading embedding model ('sentence-transformers/all-MiniLM-L6-v2')...")
embed_model = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')
print("✅ Embedding model loaded successfully.")

# 4. Initialize Pinecone client
print("🔌 Connecting to Pinecone...")
pc = Pinecone(api_key=api_key)
index_name = "medlineplus-index"

# Get a handle on your existing index
index = pc.Index(index_name)
print(f"✅ Connected to index '{index_name}' successfully.")

# 5. Batch vectorization and Upload (Upsert)
BATCH_SIZE = 100
total_chunks = len(final_chunks)

print(f"🚀 Starting vectorization & upload of {total_chunks} records (Batches of {BATCH_SIZE})...")

for i in range(0, total_chunks, BATCH_SIZE):
    batch = final_chunks[i:i + BATCH_SIZE]
    
    # Extract only the plain text to generate embeddings
    batch_texts = [item['text'] for item in batch]
    
    # Generate vectors (embeddings)
    embeddings = embed_model.encode(batch_texts).tolist()
    
    # Format vectors for Pinecone's required structure
    vectors_to_upsert = []
    for j, item in enumerate(batch):
        vectors_to_upsert.append({
            "id": item['id'],
            "values": embeddings[j],
            "metadata": {
                "title": item['title'],
                "text": item['text'],
                "category": "disease"
            }
        })
    
    # Upsert to Pinecone
    try:
        index.upsert(vectors=vectors_to_upsert)
        print(f"Uploaded batch {i // BATCH_SIZE + 1}/{(total_chunks + BATCH_SIZE - 1) // BATCH_SIZE} ({min(i + BATCH_SIZE, total_chunks)}/{total_chunks} chunks)")
    except Exception as e:
        print(f"❌ Failed to upload batch starting at index {i}: {e}")
        time.sleep(2)
        continue

print("\n🎉 SUCCESS! All medical knowledge chunks are now embedded and stored in your Pinecone Vector Database!")