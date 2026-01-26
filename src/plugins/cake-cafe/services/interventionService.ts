import { supabase } from '@/config/database';
import { InterventionRequest, InterventionType, InterventionStatus } from '@/types';
import { logger } from '@/utils/logger';

export async function createIntervention(
    businessId: string,
    sessionId: string,
    customerId: string,
    type: InterventionType,
    requestData: Record<string, unknown>,
    aiAnalysis?: Record<string, unknown>
): Promise<InterventionRequest | null> {
    try {
        const { data, error } = await supabase
            .from('admin_intervention_requests')
            .insert({
                business_id: businessId,
                session_id: sessionId,
                customer_id: customerId,
                type,
                status: 'pending',
                request_data: requestData,
                ai_analysis: aiAnalysis,
            })
            .select()
            .single();

        if (error) throw error;

        logger.info(`Created intervention request: ${data.id} (${type})`);
        return data;
    } catch (error) {
        logger.error('Error creating intervention request', { error, businessId, sessionId, type });
        return null;
    }
}

export async function getInterventionById(id: string): Promise<InterventionRequest | null> {
    try {
        const { data, error } = await supabase
            .from('admin_intervention_requests')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;
        return data;
    } catch (error) {
        logger.error('Error getting intervention by ID', { error, id });
        return null;
    }
}

export async function getPendingInterventions(businessId: string): Promise<InterventionRequest[]> {
    try {
        const { data, error } = await supabase
            .from('admin_intervention_requests')
            .select('*')
            .eq('business_id', businessId)
            .eq('status', 'pending')
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data || [];
    } catch (error) {
        logger.error('Error getting pending interventions', { error, businessId });
        return [];
    }
}

export async function getInterventionBySession(sessionId: string): Promise<InterventionRequest[]> {
    try {
        const { data, error } = await supabase
            .from('admin_intervention_requests')
            .select('*')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data || [];
    } catch (error) {
        logger.error('Error getting interventions by session', { error, sessionId });
        return [];
    }
}

export async function updateInterventionStatus(
    id: string,
    status: InterventionStatus,
    adminId?: string
): Promise<InterventionRequest | null> {
    try {
        const updates: any = { status };
        if (adminId && status === 'in_review') {
            // We might want to track who claimed it, but for now just status
        }

        const { data, error } = await supabase
            .from('admin_intervention_requests')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        return data;
    } catch (error) {
        logger.error('Error updating intervention status', { error, id, status });
        return null;
    }
}

export async function resolveIntervention(
    id: string,
    adminResponse: {
        approved: boolean;
        price?: number;
        message?: string;
        notes?: string;
    },
    adminId: string
): Promise<InterventionRequest | null> {
    try {
        const { data, error } = await supabase
            .from('admin_intervention_requests')
            .update({
                status: 'resolved',
                admin_response: adminResponse,
                resolved_by: adminId,
                resolved_at: new Date().toISOString(),
            })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        return data;
    } catch (error) {
        logger.error('Error resolving intervention', { error, id });
        return null;
    }
}

export async function cancelIntervention(id: string): Promise<InterventionRequest | null> {
    try {
        const { data, error } = await supabase
            .from('admin_intervention_requests')
            .update({ status: 'cancelled' })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        return data;
    } catch (error) {
        logger.error('Error cancelling intervention', { error, id });
        return null;
    }
}
