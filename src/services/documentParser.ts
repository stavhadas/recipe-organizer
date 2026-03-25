import mammoth from 'mammoth';

/**
 * Extract plain text from a .docx file buffer using mammoth.
 */
export async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}
