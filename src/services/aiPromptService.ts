import { supabase } from '../config/database';
import { logger } from '../utils/logger';
import { AIPromptTemplate, AIPromptTemplateType } from '../types';

export class AiPromptService {
    /**
     * Get effective template for a business and type
     */
    async getEffectiveTemplate(
        businessId: string,
        templateType: AIPromptTemplateType,
        pluginId: string = 'cake-cafe'
    ): Promise<string | null> {
        try {
            const { data, error } = await supabase.rpc('get_effective_ai_template', {
                p_business_id: businessId,
                p_template_type: templateType,
                p_plugin_id: pluginId
            });

            if (error) throw error;
            return data as string;
        } catch (error) {
            logger.error('Failed to get effective AI template', { error, businessId, templateType });
            return null;
        }
    }

    /**
     * Render a template by replacing variables
     */
    renderTemplate(template: string, variables: Record<string, string>): string {
        let rendered = template;
        Object.entries(variables).forEach(([key, value]) => {
            const placeholder = new RegExp(`{${key}}`, 'g');
            rendered = rendered.replace(placeholder, value || '');
        });
        return rendered;
    }

    /**
     * CRUD: List templates for a business
     */
    async listTemplates(businessId: string): Promise<AIPromptTemplate[]> {
        try {
            const { data, error } = await supabase
                .from('ai_prompt_templates')
                .select('*')
                .or(`business_id.eq.${businessId},business_id.is.null`)
                .eq('is_active', true);

            if (error) throw error;
            return data as AIPromptTemplate[];
        } catch (error) {
            logger.error('Failed to list templates', { error, businessId });
            throw error;
        }
    }

    /**
     * Get AI settings for a business
     */
    async getSettings(businessId: string) {
        try {
            const { data, error } = await supabase
                .from('businesses')
                .select('ai_personality, ai_greeting_template_id, ai_farewell_template_id, ai_instructions_enabled')
                .eq('id', businessId)
                .single();

            if (error) throw error;
            return data;
        } catch (error) {
            logger.error('Failed to get AI settings', { error, businessId });
            throw error;
        }
    }

    /**
     * Update AI settings for a business
     */
    async updateSettings(businessId: string, settings: any): Promise<void> {
        try {
            const { error } = await supabase
                .from('businesses')
                .update({
                    ...settings,
                    updated_at: new Date().toISOString()
                })
                .eq('id', businessId);

            if (error) throw error;
        } catch (error) {
            logger.error('Failed to update AI settings', { error, businessId });
            throw error;
        }
    }

    /**
     * Create a new template
     */
    async createTemplate(template: Partial<AIPromptTemplate>): Promise<AIPromptTemplate> {
        try {
            const { data, error } = await supabase
                .from('ai_prompt_templates')
                .insert({
                    ...template,
                    created_at: new Date().toISOString()
                })
                .select()
                .single();

            if (error) throw error;
            return data as AIPromptTemplate;
        } catch (error) {
            logger.error('Failed to create template', error);
            throw error;
        }
    }

    /**
     * Update a template
     */
    async updateTemplate(id: string, businessId: string, updates: Partial<AIPromptTemplate>): Promise<void> {
        try {
            const { error } = await supabase
                .from('ai_prompt_templates')
                .update({
                    ...updates,
                    updated_at: new Date().toISOString()
                })
                .eq('id', id)
                .eq('business_id', businessId);

            if (error) throw error;
        } catch (error) {
            logger.error('Failed to update template', { error, id, businessId });
            throw error;
        }
    }

    /**
     * Delete a template
     */
    async deleteTemplate(id: string, businessId: string): Promise<void> {
        try {
            const { error } = await supabase
                .from('ai_prompt_templates')
                .delete()
                .eq('id', id)
                .eq('business_id', businessId);

            if (error) throw error;
        } catch (error) {
            logger.error('Failed to delete template', { error, id, businessId });
            throw error;
        }
    }
}

export const aiPromptService = new AiPromptService();
