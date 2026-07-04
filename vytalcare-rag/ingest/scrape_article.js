import axios from "axios";
import * as cheerio from "cheerio";

export async function scrapeFullArticle(url) {
  const res = await axios.get(url);
  const $ = cheerio.load(res.data);

  // collect paragraphs
  let text = "";
  $("p").each((_, el) => {
    text += $(el).text() + "\n";
  });

  return text.trim();
}
