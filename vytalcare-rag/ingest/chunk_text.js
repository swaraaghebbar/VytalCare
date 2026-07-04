export function chunkText(text, chunkSize = 800) {
  const sentences = text.split(/(?<=[.?!])\s+/);
  const chunks = [];

  let current = "";

  for (let sentence of sentences) {
    if (current.length + sentence.length > chunkSize) {
      chunks.push(current);
      current = "";
    }
    current += sentence + " ";
  }

  if (current.trim().length > 0) {
    chunks.push(current.trim());
  }

  return chunks;
}
