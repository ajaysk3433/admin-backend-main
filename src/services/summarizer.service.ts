import fs from "fs/promises";
import { LLMFactory } from "../interface_imp/factory/LLMFactory.ts";
import type { Message } from "../interface/strategy/LLMStrategy.ts";


/* ─────────────────────────────────────────────────────────────
   PROMPTS
───────────────────────────────────────────────────────────── */
const SUMMARY_PROMPT_MAXLENGTH = (language: string, maxlength: number): string => `
You are an intelligent AI summarisation assistant designed to help students revise study material quickly.

Read the provided content carefully and generate structured revision notes.

Generate the response completely in **${language} language**.

The total length of the response must be within approximately ${maxlength} words. Keep it concise while covering all important points.

Use the following structure:

INTRODUCTION
Short overview of the topic.

KEY CONCEPTS
Use bullet points.

IMPORTANT FORMULAS
Include formulas if present.

IMPORTANT EXAM POINTS
Important facts or rules useful for exams.

QUICK SUMMARY
Short revision recap.

Guidelines:
- Use simple student friendly language.
- Preserve formulas exactly.
- Do not add information outside the content.
- Prioritize the most important points to stay within the word limit.
`;

const SUMMARY_PROMPT = (language: string): string => `
You are an intelligent AI summarisation assistant designed to help students revise study material quickly.

Read the provided content carefully and generate structured revision notes.

Generate the response completely in **${language} language**.

Use the following structure:

INTRODUCTION
Short overview of the topic.

KEY CONCEPTS
Use bullet points.

IMPORTANT FORMULAS
Include formulas if present.

IMPORTANT EXAM POINTS
Important facts or rules useful for exams.

QUICK SUMMARY
Short revision recap.

Guidelines:
- Use simple student friendly language.
- Preserve formulas exactly.
- Do not add information outside the content.
`;

/* ─────────────────────────────────────────────────────────────
   INTERFACES
───────────────────────────────────────────────────────────── */
interface SummarizeFileInput {
  language: string;
  maxlength?: number;
  filePath: string;
  mimeType: string;
  originalname?: string;
}

interface ParsedNotes {
  short_notes: string | null;
}

/* ─────────────────────────────────────────────────────────────
   SERVICE
───────────────────────────────────────────────────────────── */
export class SummarizerService {

  async summarizeFile({ language, maxlength, filePath, mimeType }: SummarizeFileInput): Promise<string> {
    try {
      const systemPrompt = maxlength
        ? SUMMARY_PROMPT_MAXLENGTH(language, maxlength)
        : SUMMARY_PROMPT(language);

      const messages: Message[] = [
        { role: "system", content: systemPrompt },
      ];

      // ✅ Provider reads + extracts the file itself via fileResponse()
      const llm = LLMFactory.create("openai");
      return await llm.fileResponse(messages, filePath, mimeType);
    } catch (error: any) {
      console.error("AI Summarization Error:", error.message);
      throw error;
    } finally {
      if (filePath) {
        try {
          await fs.unlink(filePath);
        } catch (err: any) {
          console.error("File cleanup failed:", err.message);
        }
      }
    }
  }

  parseNotes(rawText: string): ParsedNotes {
    if (!rawText || typeof rawText !== "string") {
      return { short_notes: null };
    }

    let cleaned = rawText;

    cleaned = cleaned.replace(/^#{1,6}\s*/gm, "");
    cleaned = cleaned.replace(/^-{3,}/gm, "");
    cleaned = cleaned.replace(/^\s*\d+\.\s+/gm, "• ");
    cleaned = cleaned.replace(/^\s*[\*\-]\s+/gm, "• ");
    cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1");
    cleaned = cleaned
      .replace(/\r/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+\n/g, "\n")
      .trim();

    return { short_notes: cleaned };
  }

  async generateSummary({ language, maxlength, filePath, mimeType, originalname }: {
    language: string;
    maxlength?: number;
    filePath: string;
    mimeType: string;
    originalname: string;
  }): Promise<{ file: string; summary: string }> {
    if (!language) throw new Error("language is required");
    if (!filePath) throw new Error("file is required");

    const aiText = await this.summarizeFile({ language, maxlength, filePath, mimeType });
    const parsed = this.parseNotes(aiText);

    if (!parsed.short_notes) {
      throw new Error(`AI summarization failed for ${originalname}`);
    }

    return { file: originalname, summary: parsed.short_notes };
  }
}

export const summarizerService = new SummarizerService();