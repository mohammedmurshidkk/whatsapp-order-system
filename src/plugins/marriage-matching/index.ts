// src/plugins/marriage-matching/index.ts

import {
  BusinessPlugin,
  PluginIntent,
  ConversationContext,
  IntentResult,
  PluginPromptContext,
  ValidationResult,
  PluginId,
  WelcomePayload,
} from '../types';
import { Business } from '../../types';
import { getSystemPrompt, MarriagePromptContext } from './prompts/systemPrompt';
import { getProfiles } from './services/profileService';
import { findOrCreateSeeker } from './services/seekerService';
import { getHandler, hasHandler } from './handlers/registry';
import { MarriageIntentContext } from './handlers/types';
import { logger } from '../../utils/logger';

export const MarriageMatchingPlugin: BusinessPlugin = {
  id: PluginId.MARRIAGE_MATCHING,
  name: 'Marriage Matching',
  version: '1.0.0',

  getSystemPrompt(business: Business, context: PluginPromptContext): string {
    // Profiles are loaded separately and passed via extended context
    const profiles = (context as any).profiles ?? [];
    const seeker = (context as any).seeker ?? null;

    const marriageContext: MarriagePromptContext = {
      business,
      profiles,
      seeker,
    };
    return getSystemPrompt(marriageContext);
  },

  async getWelcomePayload(business: Business, lang: string): Promise<WelcomePayload> {
    const name = business.name || 'Marriage Matching';
    return {
      message: `Hi! I'm the AI assistant for *${name}*.\n\nI can help you search for profiles or register as a seeker.\n\nType *search* to browse profiles, or *register* to create your profile.`,
      buttons: [
        { id: 'marriage_search', title: '🔍 Search Profiles' },
        { id: 'marriage_register', title: '📝 Register' },
      ],
    };
  },

  getIntents(): PluginIntent[] {
    return [
      { name: 'search_profiles', description: 'Seeker searches by preference', examples: ['Muslim girl age 25-30 Dubai', 'Show me profiles'] },
      { name: 'show_profile', description: 'Seeker requests a specific profile', examples: ['#M042', 'Show #F010'] },
      { name: 'express_interest', description: 'Seeker expresses interest in a profile', examples: ['interested #M042', 'I like #F010'] },
      { name: 'register_seeker', description: 'Seeker wants to register', examples: ['register', 'I want to register'] },
      { name: 'collect_seeker_info', description: 'Collecting registration info step by step', examples: [] },
      { name: 'no_results_found', description: 'No profiles matched search', examples: [] },
      { name: 'smalltalk', description: 'General conversation', examples: ['Hello', 'Hi', 'Thanks'] },
    ];
  },

  async handleIntent(intent: string, context: ConversationContext): Promise<IntentResult> {
    const seeker = await findOrCreateSeeker(context.business.id, context.phone);

    if (!hasHandler(intent)) {
      logger.warn(`MarriageMatchingPlugin: No handler for intent: ${intent}`);
      return { response: context.aiResponse.reply || "I'm not sure how to help with that. Try searching for profiles or type _register_." };
    }

    const intentContext: MarriageIntentContext = {
      phone: context.phone,
      businessId: context.business.id,
      business: context.business,
      seeker,
      message: context.message,
      aiResponse: context.aiResponse as any,
      sendMessage: context.messaging.sendWhatsAppMessage as any,
    };

    const handler = getHandler(intent)!;
    const result = await handler(intentContext);

    return {
      response: result.reply ?? '',
      skipResponse: result.reply === null,
    };
  },

  validateBusinessConfig(business: Business): ValidationResult {
    const errors: string[] = [];
    if (!business.name) errors.push('Business name is required');
    return { valid: errors.length === 0, errors, warnings: [] };
  },
};

export default MarriageMatchingPlugin;
