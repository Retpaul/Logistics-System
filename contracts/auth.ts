// Shared API contract: authentication and session.
import { z } from "zod";
import { Email, Id } from "./common.js";
import { Role } from "./enums.js";

export const Password = z.string().min(8, "Use at least 8 characters").max(128);

export const SignupRequest = z.object({
  fullName: z.string().trim().min(2, "Enter your full name").max(160),
  orgName: z.string().trim().min(2, "Enter your organisation name").max(150),
  email: Email,
  password: Password,
});
export type SignupRequest = z.input<typeof SignupRequest>;

export const LoginRequest = z.object({
  email: Email,
  password: z.string().min(1, "Enter your password").max(128),
  /** Required only when the same email belongs to several organisations (409 TENANT_REQUIRED). */
  tenantSlug: z.string().trim().min(1).max(63).optional(),
});
export type LoginRequest = z.input<typeof LoginRequest>;

export const TenantSummary = z.object({
  id: Id,
  name: z.string(),
  slug: z.string(),
  tagline: z.string().nullable(),
  logoUrl: z.string().nullable(),
  brandColor: z.string().nullable(),
  secondaryColor: z.string().nullable(),
  currency: z.string(),
});
export type TenantSummary = z.infer<typeof TenantSummary>;

export const SessionUser = z.object({
  id: Id,
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  role: Role,
});
export type SessionUser = z.infer<typeof SessionUser>;

/** GET /auth/me */
export const MeResponse = z.object({ user: SessionUser, tenant: TenantSummary });
export type MeResponse = z.infer<typeof MeResponse>;

/** POST /auth/signup and /auth/login. The refresh token is set as an httpOnly cookie, never in the body. */
export const AuthResponse = MeResponse.extend({ accessToken: z.string() });
export type AuthResponse = z.infer<typeof AuthResponse>;

/** POST /auth/refresh */
export const RefreshResponse = z.object({ accessToken: z.string() });
export type RefreshResponse = z.infer<typeof RefreshResponse>;

/** `details` of a 409 TENANT_REQUIRED login response. */
export const TenantChoices = z.object({ tenants: z.array(z.object({ slug: z.string(), name: z.string() })) });
export type TenantChoices = z.infer<typeof TenantChoices>;
