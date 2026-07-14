import os
import re
from lxml import etree
from langchain_text_splitters import RecursiveCharacterTextSplitter

def clean_html(text):
    """Remove HTML tags like <p>, <a>, etc., from the text."""
    clean = re.compile('<.*?>')
    return re.sub(clean, '', text).strip()

def diagnose_and_parse(file_path):
    if not os.path.exists(file_path):
        print(f"❌ Error: The file '{file_path}' does not exist.")
        return []

    print(f"🔍 Analyzing '{file_path}'...")
    
    parser = etree.XMLParser(recover=True, remove_blank_text=True)
    tree = etree.parse(file_path, parser)
    root = tree.getroot()
    
    topics = root.xpath("//*[local-name()='health-topic']")
    print(f"Found {len(topics)} '<health-topic>' elements.")
    
    raw_documents = []
    
    for topic in topics:
        title = topic.get('title')
        summary_elements = topic.xpath(".//*[local-name()='full-summary' or local-name()='summary']")
        
        if summary_elements:
            # Join text, keeping any HTML strings temporarily for thorough parsing
            summary_html = "".join(summary_elements[0].itertext()).strip()
            # Clean HTML tags out
            summary_clean = clean_html(summary_html)
            
            # Create a clean, structural representation of our data
            context = f"Topic: {title}\nSummary: {summary_clean}"
            raw_documents.append({"title": title, "text": context})
            
    return raw_documents

# --- RUNNING PARSER & CHUNKER ---

file_name = 'mplus_topics_2026-07-14.xml' # Matches your exact filename!
documents = diagnose_and_parse(file_name)

if documents:
    print(f"✅ Successfully parsed {len(documents)} health topics!")
    
    # Initialize the LangChain Text Splitter
    # Chunk size: 500 characters (~100 words), Overlap: 50 characters
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=500,
        chunk_overlap=50,
        length_function=len
    )
    
    final_chunks = []
    for doc in documents:
        # Split the text
        splits = text_splitter.split_text(doc['text'])
        for i, split in enumerate(splits):
            final_chunks.append({
                "title": doc['title'],
                "chunk_id": f"{doc['title'].replace(' ', '_')}_{i}",
                "text": split
            })
            
    print(f"✂️ Split {len(documents)} topics into {len(final_chunks)} smaller chunks!")
    print("\n--- Sample Chunk Extracted ---")
    print(f"ID: {final_chunks[0]['chunk_id']}")
    print(f"Text:\n{final_chunks[0]['text']}")