import os
import time
import requests
import unicodedata
from dotenv import load_dotenv
from pinecone import Pinecone
from langchain_text_splitters import RecursiveCharacterTextSplitter

load_dotenv()
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")

if not PINECONE_API_KEY:
    raise ValueError("❌ Error: Missing PINECONE_API_KEY in .env file.")

# 1. Connect to Pinecone
pc = Pinecone(api_key=PINECONE_API_KEY)
index = pc.Index("medlineplus-index")

def clean_id_to_ascii(text_id):
    normalized = unicodedata.normalize('NFKD', text_id)
    ascii_id = normalized.encode('ascii', 'ignore').decode('ascii')
    return "".join([c for c in ascii_id.replace(' ', '-').replace('/', '-') if c.isalnum() or c in ['-', '_']])

# 2. Fetch Top Medicines from openFDA[cite: 5]
def fetch_fda_drugs(limit=100):
    print(f"📡 Fetching {limit} drug labels from openFDA...")
    url = f"https://api.fda.gov/drug/label.json?limit={limit}"
    response = requests.get(url)
    if response.status_code != 200:
        print("❌ Failed to fetch data from openFDA")
        return []
    
    results = response.json().get('results', [])
    documents = []
    
    for record in results:
        brand_names = record.get('openfda', {}).get('brand_name', [])
        generic_names = record.get('openfda', {}).get('generic_name', [])
        
        if not brand_names:
            continue
            
        brand_name = brand_names[0]
        generic_name = generic_names[0] if generic_names else "Unknown"
        
        # Combine descriptive fields into a structured context block
        purpose = " ".join(record.get('purpose', []))
        indications = " ".join(record.get('indications_and_usage', []))
        dosage = " ".join(record.get('dosage_and_administration', []))
        warnings = " ".join(record.get('warnings', []))
        side_effects = " ".join(record.get('adverse_reactions', []))
        
        context_text = (
            f"Medicine: {brand_name} (Generic: {generic_name})\n"
            f"What it is used for: {indications if indications else purpose}\n"
            f"Dosage: {dosage}\n"
            f"Warnings: {warnings}\n"
            f"Side Effects: {side_effects}"
        )
        
        documents.append({
            "title": brand_name,
            "text": context_text
        })
        
    return documents

# 3. Process, Chunk, and Upload via Cloud Inference API[cite: 5]
drugs = fetch_fda_drugs(limit=100)
text_splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)

final_chunks = []
for drug in drugs:
    splits = text_splitter.split_text(drug['text'])
    for i, split in enumerate(splits):
        clean_id = clean_id_to_ascii(f"drug-{drug['title']}-{i}")
        final_chunks.append({
            "id": clean_id,
            "text": split,
            "title": drug['title']
        })

print(f"🚀 Vectorizing via Cloud & uploading {len(final_chunks)} medicine chunks...")
BATCH_SIZE = 64

for i in range(0, len(final_chunks), BATCH_SIZE):
    batch = final_chunks[i:i + BATCH_SIZE]
    batch_texts = [item['text'] for item in batch]
    
    try:
        # Query Pinecone Inference API for 1024-dimensional vector calculations
        res = pc.inference.embed(
            model="multilingual-e5-large",
            inputs=batch_texts,
            parameters={"input_type": "passage", "truncate": "END"}
        )
        
        vectors_to_upsert = []
        for j, item in enumerate(batch):
            vectors_to_upsert.append({
                "id": item['id'],
                "values": res.data[j].values,
                "metadata": {
                    "title": item['title'],
                    "text": item['text'],
                    "category": "medicine"  # <-- Crucial metadata tag for routing filter![cite: 5]
                }
            })
        
        index.upsert(vectors=vectors_to_upsert)
        print(f"Uploaded batch {i // BATCH_SIZE + 1}...")
        
    except Exception as e:
        print(f"❌ Failed to cloud embed/upload drug batch: {e}")
        time.sleep(2)
        continue

print("🎉 Medicines successfully added to Pinecone Vector Database via Cloud Inference API!")