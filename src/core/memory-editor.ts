import fs from "fs";
import path from "path";
import { MessageEntry } from "./jsonl-parser.ts";
export interface MemoryEntry { index: number; content: string; rawLine: string; }
const LIST_ITEM_RE = /^(\s*[-*+]|\s*\d+[.)]) (.+)$/;
export function saveCompactedMessages(memoryFilePath: string, messages: MessageEntry[], label?: string): void { ensureFile(memoryFilePath); const raw = fs.readFileSync(memoryFilePath, "utf-8"); const trimmed = raw.trimEnd(); const headerLine = label ? `\n\n<!-- Saved from compact: ${label} -->` : `\n\n<!-- Saved from compact event -->`; const lines = messages.filter((m: any) => m.role === "user" || m.role === "assistant").map((m: any) => { const prefix = m.role === "user" ? "User" : "Agent"; const text = m.content.slice(0, 300).replace(/\n/g, " ").trim(); return `- [${prefix}] ${text}`; }).join("\n"); fs.writeFileSync(memoryFilePath, `${trimmed}${headerLine}\n${lines}\n`, "utf-8"); }
function ensureFile(filePath: string): void { const dir = path.dirname(filePath); fs.mkdirSync(dir, { recursive: true }); if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, "", "utf-8"); }
