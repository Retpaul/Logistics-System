import { UpdateTenantRequest, type TenantResponse } from "../contracts/index.js";
import { notFound } from "../lib/errors.js";
import { tenantsRepository } from "../repositories/index.js";
import { toTenantSummary } from "./mappers.js";

export async function getTenant(tenantId: string): Promise<TenantResponse> {
  const tenant = await tenantsRepository.findById(tenantId);
  if (!tenant) throw notFound("Organisation");
  return toTenantSummary(tenant);
}

export async function updateTenant(tenantId: string, input: unknown): Promise<TenantResponse> {
  const changes = UpdateTenantRequest.parse(input);
  return toTenantSummary(await tenantsRepository.update(tenantId, changes));
}
