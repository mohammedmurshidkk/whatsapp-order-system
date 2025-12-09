import axios from 'axios';
import { AI_PROVIDER, GEMINI_MODEL_NAME, OPENROUTER_MODEL_NAME, GROQ_MODEL_NAME } from '../config/constants';
import { logger } from '../utils/logger';
import { OpenRouter } from "@openrouter/sdk";
import Groq from "groq-sdk";


// AI Client Interface
export interface AIClient {
  processMessage(prompt: string): Promise<string | null>;
}

// Gemini Client
class GeminiClient implements AIClient {
  private apiKey: string;
  private apiUrl: string;

  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY!;
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }
    this.apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_NAME}:generateContent`;
  }

  async processMessage(prompt: string): Promise<string | null> {
    try {
      const response = await axios.post(
        `${this.apiUrl}?key=${this.apiKey}`,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 500,
          },
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000,
        }
      );
      return response.data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
    } catch (error) {
      if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
        logger.warn('Gemini API timeout. Retrying...');
        // Simplified retry for brevity
        const retryResponse = await axios.post(
          `${this.apiUrl}?key=${this.apiKey}`,
          { contents: [{ parts: [{ text: prompt }] }] },
          { timeout: 30000 }
        );
        return retryResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
      }
      logger.error('Gemini API error', {
        status: (error as any).response?.status,
        data: (error as any).response?.data,
      });
      throw error;
    }
  }
}

// OpenRouter Client
class OpenRouterClient implements AIClient {
  private openrouter: OpenRouter;

  constructor() {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error('OPENROUTER_API_KEY not configured');
    }
    this.openrouter = new OpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
  }

  async processMessage(prompt: string): Promise<string | null> {
    const stream = await this.openrouter.chat.send({
      model: OPENROUTER_MODEL_NAME,
      messages: [{ role: "user", content: prompt }],
      stream: true,
    });

    let responseText = "";
    for await (const chunk of stream) {
      responseText += chunk.choices[0]?.delta?.content || "";
    }
    return responseText;
  }
}

// Groq Client
class GroqClient implements AIClient {
  private groq: Groq;

  constructor() {
    if (!process.env.GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY not configured');
    }
    this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }

  async processMessage(prompt: string): Promise<string | null> {
    const completion = await this.groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: GROQ_MODEL_NAME,
    });
    return completion.choices[0]?.message?.content || null;
  }
}

// Factory to get the appropriate AI client
export function getAIClient(): AIClient {
  switch (AI_PROVIDER.toUpperCase()) {
    case 'GEMINI':
      logger.info('Using Gemini AI Provider');
      return new GeminiClient();
    case 'OPENROUTER':
      logger.info('Using OpenRouter AI Provider');
      return new OpenRouterClient();
    case 'GROQ':
      logger.info('Using Groq AI Provider');
      return new GroqClient();
    default:
      logger.warn(`Unknown AI_PROVIDER: ${AI_PROVIDER}. Defaulting to Gemini.`);
      return new GeminiClient();
  }
}
