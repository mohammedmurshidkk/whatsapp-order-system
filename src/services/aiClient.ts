import axios from 'axios';
import { AI_PROVIDER, GEMINI_MODEL_NAME, OPENROUTER_MODEL_NAME, GROQ_MODEL_NAME } from '../config/constants';
import { logger } from '../utils/logger';
import { OpenRouter } from "@openrouter/sdk";
import Groq from "groq-sdk";


// AI Response with usage metadata
export interface AIUsageResponse {
  text: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
  };
}

// AI Client Interface
export interface AIClient {
  processMessage(prompt: string): Promise<string | null>;
  processMessageWithUsage(prompt: string): Promise<AIUsageResponse>;
  getProvider(): string;
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

  getProvider(): string {
    return 'gemini';
  }

  async processMessage(prompt: string, retryCount = 0): Promise<string | null> {
    const result = await this.processMessageWithUsage(prompt, retryCount);
    return result.text;
  }

  async processMessageWithUsage(prompt: string, retryCount = 0): Promise<AIUsageResponse> {
    const MAX_RETRIES = 2;
    const startTime = Date.now();

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

      const latencyMs = Date.now() - startTime;
      const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || null;

      // Extract token usage from Gemini response
      const usageMetadata = response.data?.usageMetadata || {};
      const inputTokens = usageMetadata.promptTokenCount || Math.ceil(prompt.length / 4);
      const outputTokens = usageMetadata.candidatesTokenCount || Math.ceil((text?.length || 0) / 4);

      // Retry on empty response (Gemini sometimes returns empty)
      if (!text && retryCount < MAX_RETRIES) {
        logger.warn(`Gemini returned empty response. Retry ${retryCount + 1}/${MAX_RETRIES}...`);
        await new Promise(r => setTimeout(r, 500));
        return this.processMessageWithUsage(prompt, retryCount + 1);
      }

      return {
        text,
        usage: { inputTokens, outputTokens, latencyMs },
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const status = (error as any).response?.status;
      const isRetryable = axios.isAxiosError(error) && (
        error.code === 'ECONNABORTED' ||
        !error.response ||
        status === 503 ||
        status === 429 ||
        status === 500
      );

      if (retryCount < MAX_RETRIES && isRetryable) {
        const delay = Math.pow(2, retryCount) * 1000;
        logger.warn(`Gemini API error (${status || 'network'}). Retry ${retryCount + 1}/${MAX_RETRIES} after ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        return this.processMessageWithUsage(prompt, retryCount + 1);
      }

      logger.error('Gemini API error', {
        status: status,
        data: (error as any).response?.data,
      });

      // Return error response with estimated tokens
      return {
        text: null,
        usage: {
          inputTokens: Math.ceil(prompt.length / 4),
          outputTokens: 0,
          latencyMs,
        },
      };
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

  getProvider(): string {
    return 'openrouter';
  }

  async processMessage(prompt: string, retryCount = 0): Promise<string | null> {
    const result = await this.processMessageWithUsage(prompt, retryCount);
    return result.text;
  }

  async processMessageWithUsage(prompt: string, retryCount = 0): Promise<AIUsageResponse> {
    const MAX_RETRIES = 2;
    const startTime = Date.now();

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

      const latencyMs = Date.now() - startTime;

      // Retry on empty response
      if (!responseText && retryCount < MAX_RETRIES) {
        logger.warn(`OpenRouter returned empty response. Retry ${retryCount + 1}/${MAX_RETRIES}...`);
        await new Promise(r => setTimeout(r, 500));
        return this.processMessageWithUsage(prompt, retryCount + 1);
      }

      // Estimate tokens (OpenRouter streaming doesn't return usage)
      return {
        text: responseText || null,
        usage: {
          inputTokens: Math.ceil(prompt.length / 4),
          outputTokens: Math.ceil((responseText?.length || 0) / 4),
          latencyMs,
        },
      };
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      const isRetryable =
        error.code === 'ECONNABORTED' ||
        error.code === 'ETIMEDOUT' ||
        error.status === 503 ||
        error.status === 429 ||
        error.status === 500;

      if (retryCount < MAX_RETRIES && isRetryable) {
        const delay = Math.pow(2, retryCount) * 1000;
        logger.warn(`OpenRouter API error (${error.status || error.code || 'unknown'}). Retry ${retryCount + 1}/${MAX_RETRIES} after ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        return this.processMessageWithUsage(prompt, retryCount + 1);
      }

      logger.error('OpenRouter API error', { status: error.status, message: error.message });

      return {
        text: null,
        usage: {
          inputTokens: Math.ceil(prompt.length / 4),
          outputTokens: 0,
          latencyMs,
        },
      };
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

  getProvider(): string {
    return 'groq';
  }

  async processMessage(prompt: string, retryCount = 0): Promise<string | null> {
    const result = await this.processMessageWithUsage(prompt, retryCount);
    return result.text;
  }

  async processMessageWithUsage(prompt: string, retryCount = 0): Promise<AIUsageResponse> {
    const MAX_RETRIES = 2;
    const startTime = Date.now();

    try {
      const completion = await this.groq.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: GROQ_MODEL_NAME,
        max_tokens: 2048,
      });

      const latencyMs = Date.now() - startTime;
      const responseText = completion.choices[0]?.message?.content || null;

      // Groq returns usage info
      const usage: any = completion.usage || {};
      const inputTokens = usage?.prompt_tokens || Math.ceil(prompt.length / 4);
      const outputTokens = usage?.completion_tokens || Math.ceil((responseText?.length || 0) / 4);

      // Retry on empty response
      if (!responseText && retryCount < MAX_RETRIES) {
        logger.warn(`Groq returned empty response. Retry ${retryCount + 1}/${MAX_RETRIES}...`);
        await new Promise(r => setTimeout(r, 500));
        return this.processMessageWithUsage(prompt, retryCount + 1);
      }

      return {
        text: responseText,
        usage: { inputTokens, outputTokens, latencyMs },
      };
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      const isRetryable =
        error.code === 'ECONNABORTED' ||
        error.code === 'ETIMEDOUT' ||
        error.status === 503 ||
        error.status === 429 ||
        error.status === 500;

      if (retryCount < MAX_RETRIES && isRetryable) {
        const delay = Math.pow(2, retryCount) * 1000;
        logger.warn(`Groq API error (${error.status || error.code || 'unknown'}). Retry ${retryCount + 1}/${MAX_RETRIES} after ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        return this.processMessageWithUsage(prompt, retryCount + 1);
      }

      logger.error('Groq API error', { status: error.status, message: error.message });

      return {
        text: null,
        usage: {
          inputTokens: Math.ceil(prompt.length / 4),
          outputTokens: 0,
          latencyMs,
        },
      };
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
