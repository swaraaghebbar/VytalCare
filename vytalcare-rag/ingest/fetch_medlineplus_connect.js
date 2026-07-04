// ingest/fetch_medlineplus_connect.js
import axios from "axios";
import { codeMappings } from "./code_mappings.js";

const BASE_URL = "https://connect.medlineplus.gov/service";

/**
 * Fetch MedlinePlus Connect results for a plain-language query.
 * Automatically maps the query into ICD-10, LOINC, or RXCUI codes.
 */
export async function fetchFromMedlinePlusConnect(query) {
  const mapping = codeMappings[query.toLowerCase()];

  if (!mapping) {
    console.warn(`⚠️ No code mapping found for: ${query}`);
    return [];
  }

  const { code, system } = mapping;

  const url =
    `${BASE_URL}?` +
    `mainSearchCriteria.v.cs=${encodeURIComponent(system)}` +
    `&mainSearchCriteria.v.c=${encodeURIComponent(code)}` +
    `&informationRecipient.languageCode.c=en` +
    `&knowledgeResponseType=application/json`;

  console.log(`🔎 Querying MedlinePlus Connect for '${query}' → ${code}`);
  console.log("URL:", url);

  try {
    const res = await axios.get(url, { timeout: 8000 });

    const entries = res?.data?.feed?.entry ?? [];
    if (!entries.length) {
      console.warn(`⚠️ No MedlinePlus Connect results for: ${query}`);
      return [];
    }

    return entries.map((entry) => ({
      title: entry?.title ?? "",
      summary: entry?.summary ?? "",
      url: entry?.link?.[0]?.href ?? "",
    }));
  } catch (err) {
    console.error("❌ MedlinePlus Connect request error:", err.message);
    return [];
  }
}
