export type Message = {
  role: "user" | "system" | "assistant";
  content: string;
};
import type { Response } from "express";
export interface LLMStrategy {
  streamResponse(messages: Message[], res: Response): Promise<void>;
  normalResponse(messages: Message[]): Promise<string>;
  /**
   * Accepts a file from disk directly.
   * The provider handles extraction (PDF text, plain text, etc.)
   * and appends the content to the messages before calling the LLM.
   */
  fileResponse(messages: Message[], filePath: string, mimeType: string): Promise<string>;
  // structuredResponse(messages: any[], schema: any): Promise<any>;
}