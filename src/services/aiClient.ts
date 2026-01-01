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

  async processMessage(prompt: string, retryCount = 0): Promise<string | null> {
    const MAX_RETRIES = 2;

    try {
      const response = await axios.post(
        `${this.apiUrl}?key=${this.apiKey}`,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 2048,
          },
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000,
        }
      );

      const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || null;

      // Retry on empty response (Gemini sometimes returns empty)
      if (!text && retryCount < MAX_RETRIES) {
        logger.warn(`Gemini returned empty response. Retry ${retryCount + 1}/${MAX_RETRIES}...`);
        await new Promise(r => setTimeout(r, 500)); // Small delay before retry
        return this.processMessage(prompt, retryCount + 1);
      }

      return text;
    } catch (error) {
      const status = (error as any).response?.status;
      const isRetryable = axios.isAxiosError(error) && (
        error.code === 'ECONNABORTED' ||  // Timeout
        !error.response ||                  // Network error
        status === 503 ||                   // Model overloaded
        status === 429 ||                   // Rate limited
        status === 500                      // Server error
      );

      // Retry with exponential backoff
      if (retryCount < MAX_RETRIES && isRetryable) {
        const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
        logger.warn(`Gemini API error (${status || 'network'}). Retry ${retryCount + 1}/${MAX_RETRIES} after ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        return this.processMessage(prompt, retryCount + 1);
      }

      logger.error('Gemini API error', {
        status: status,
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
    this.openrouter = new OpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
      timeoutMs: 30000,
    });
  }

  async processMessage(prompt: string, retryCount = 0): Promise<string | null> {
    const MAX_RETRIES = 2;

    try {
      const stream = await this.openrouter.chat.send({
        model: OPENROUTER_MODEL_NAME,
        messages: [{ role: "user", content: prompt }],
        stream: true,
        maxTokens: 2048
      });

      let responseText = "";
      for await (const chunk of stream) {
        responseText += chunk.choices[0]?.delta?.content || "";
      }

      // Retry on empty response
      if (!responseText && retryCount < MAX_RETRIES) {
        logger.warn(`OpenRouter returned empty response. Retry ${retryCount + 1}/${MAX_RETRIES}...`);
        await new Promise(r => setTimeout(r, 500));
        return this.processMessage(prompt, retryCount + 1);
      }

      return responseText || null;
    } catch (error: any) {
      const isRetryable =
        error.code === 'ECONNABORTED' ||
        error.code === 'ETIMEDOUT' ||
        error.status === 503 ||
        error.status === 429 ||
        error.status === 500;

      // Retry with exponential backoff
      if (retryCount < MAX_RETRIES && isRetryable) {
        const delay = Math.pow(2, retryCount) * 1000;
        logger.warn(`OpenRouter API error (${error.status || error.code || 'unknown'}). Retry ${retryCount + 1}/${MAX_RETRIES} after ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        return this.processMessage(prompt, retryCount + 1);
      }

      logger.error('OpenRouter API error', { status: error.status, message: error.message });
      throw error;
    }
  }
}

// Groq Client
class GroqClient implements AIClient {
  private groq: Groq;

  constructor() {
    if (!process.env.GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY not configured');
    }
    this.groq = new Groq({
      apiKey: process.env.GROQ_API_KEY,
      timeout: 30000,
    });
  }

  async processMessage(prompt: string, retryCount = 0): Promise<string | null> {
    const MAX_RETRIES = 2;

    try {
      const completion = await this.groq.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: GROQ_MODEL_NAME,
        max_tokens: 2048,
      });

      const responseText = completion.choices[0]?.message?.content || null;

      // Retry on empty response
      if (!responseText && retryCount < MAX_RETRIES) {
        logger.warn(`Groq returned empty response. Retry ${retryCount + 1}/${MAX_RETRIES}...`);
        await new Promise(r => setTimeout(r, 500));
        return this.processMessage(prompt, retryCount + 1);
      }

      return responseText;
    } catch (error: any) {
      const isRetryable =
        error.code === 'ECONNABORTED' ||
        error.code === 'ETIMEDOUT' ||
        error.status === 503 ||
        error.status === 429 ||
        error.status === 500;

      // Retry with exponential backoff
      if (retryCount < MAX_RETRIES && isRetryable) {
        const delay = Math.pow(2, retryCount) * 1000;
        logger.warn(`Groq API error (${error.status || error.code || 'unknown'}). Retry ${retryCount + 1}/${MAX_RETRIES} after ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        return this.processMessage(prompt, retryCount + 1);
      }

      logger.error('Groq API error', { status: error.status, message: error.message });
      throw error;
    }
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
