// Token-based fuzzy search — matches when every whitespace-separated token
// appears somewhere in the haystack, in any order.
// พิมพ์ "ดี สม" เจอ "สมชาย ใจดี" ได้เลย
export const norm = (s) =>
  String(s || "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export const tokens = (q) => norm(q).split(" ").filter(Boolean);

export const matchTokens = (query, ...fields) => {
  const toks = tokens(query);
  if (toks.length === 0) return true;
  const hay = fields.map(norm).join(" ");
  return toks.every((t) => hay.includes(t));
};
