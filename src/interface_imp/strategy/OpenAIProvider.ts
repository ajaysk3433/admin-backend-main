import OpenAI from "openai";
import fs from "fs/promises";
import pdf from "@cedrugs/pdf-parse";
import { LLMStrategy, Message } from "../../interface/strategy/LLMStrategy.ts";

import type { Response } from "express";
import { OpenAIStreamAdapter } from "../adapter/OpenAIStreamAdapter.ts";

export class OpenAIProvider implements LLMStrategy {
  declare _client;
  constructor() {
    if (!this._client) {
      this._client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
  }

  async normalResponse(messages: Message[]): Promise<string> {
    const response = await this._client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messages,
    });
    return response.choices[0].message.content as string;
  }

  async streamResponse(messages: Message[], res: Response) {
    const stream = await this._client.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      stream: true,
      max_tokens: 1200,
    });

    const openAIToSSEAdapter = new OpenAIStreamAdapter(stream);
    openAIToSSEAdapter.pipeTo(res);
  }

  /**
   * Reads a file from disk, extracts its text content,
   * appends it as a user message, then calls the LLM.
   * Supports: PDF, plain text / other UTF-8 formats.
   */
  async fileResponse(
    messages: Message[],
    filePath: string,
    mimeType: string,
  ): Promise<string> {
    const fileText = await this._extractFileText(filePath, mimeType);

    const enrichedMessages: Message[] = [
      ...messages,
      {
        role: "user",
        content: `Here is the document content:\n\n${fileText}`,
      },
    ];

    return this.normalResponse(enrichedMessages);
  }

  // ─── Private helpers ────────────────────────────────────────────

  private async _extractFileText(filePath: string, mimeType: string): Promise<string> {
    const buffer = await fs.readFile(filePath);

    if (mimeType === "application/pdf") {
      const pdfData = await pdf(buffer);
      if (pdfData.text && pdfData.text.trim().length > 50) {
        return pdfData.text.trim();
      }
      throw new Error("Empty or insufficient PDF text — cannot summarize");
    }

    // Plain text / other UTF-8 formats
    return buffer.toString("utf-8");
  }
}
