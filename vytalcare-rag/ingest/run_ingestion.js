// ingest/run_ingestion.js

import { fetchFromMedlinePlusConnect } from "./fetch_medlineplus_connect.js";
import { embedAndUpload } from "./embed_and_upload.js";
// Import the mappings file directly
import { codeMappings } from "./code_mappings.js";

async function run() {
  // AUTOMATION: Get all the keys (disease names) from your file automatically
  const queries = Object.keys(codeMappings);

  console.log(`🚀 Starting ingestion for ${queries.length} conditions...`);

  for (const query of queries) {
    console.log(`\n🔍 Fetching medical info for: ${query}`);

    // The rest of your logic remains exactly the same...
    const results = await fetchFromMedlinePlusConnect(query);

    if (!results.length) {
      console.warn(`⚠️ No data found for: ${query}`);
      continue;
    }

    console.log(`📄 Found ${results.length} entries for: ${query}`);

    await embedAndUpload(results, query);
    console.log(`✅ Uploaded embeddings for: ${query}`);
  }

  console.log("\n🎉 Ingestion complete.");
}

run();