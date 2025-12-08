import { supabase } from '../config/database';
import { Customer } from '../types';
import { logger } from '../utils/logger';

export async function findOrCreateCustomer(phone: string, businessId: string): Promise<Customer> {
  // Try to find existing customer for this business
  const { data: existingCustomer, error: findError } = await supabase
    .from('customers')
    .select('*')
    .eq('phone', phone)
    .eq('business_id', businessId)
    .single();

  if (existingCustomer && !findError) {
    logger.debug(`Customer found: ${existingCustomer.id} for business ${businessId}`);
    return existingCustomer as Customer;
  }

  // Customer not found, create new one
  const { data: newCustomer, error: createError } = await supabase
    .from('customers')
    .insert({
      phone,
      business_id: businessId,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (createError) {
    logger.error('Failed to create customer', createError);
    throw new Error('Failed to create customer');
  }

  logger.info(`New customer created: ${newCustomer.id} for business ${businessId}`);
  return newCustomer as Customer;
}

export async function updateCustomerName(
  customerId: string,
  name: string
): Promise<void> {
  const { error } = await supabase
    .from('customers')
    .update({ name })
    .eq('id', customerId);

  if (error) {
    logger.error('Failed to update customer name', error);
    throw new Error('Failed to update customer name');
  }

  logger.debug(`Customer ${customerId} name updated to: ${name}`);
}

export async function getCustomerById(customerId: string): Promise<Customer | null> {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .single();

  if (error) {
    logger.debug(`Customer not found: ${customerId}`);
    return null;
  }

  return data as Customer;
}
