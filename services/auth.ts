import { randomBytes, randomUUID } from "node:crypto";
import type { Tenant, User } from "@prisma/client";
import { LoginRequest, SignupRequest, type AuthResponse, type MeResponse } from "../contracts/index.js";
import { config } from "../config/index.js";
import { AppError, unauthenticated } from "../lib/errors.js";
import { burnPasswordCheck, hashPassword, verifyPassword } from "../lib/password.js";
import { hashToken, newRefreshToken, signAccessToken, type AuthContext } from "../lib/tokens.js";
import { refreshTokensRepository, tenantsRepository, usersRepository } from "../repositories/index.js";
import { prisma } from "../startup/db.js";
import { toSessionUser, toTenantSummary } from "./mappers.js";

/** A session is the JSON body plus the refresh token the controller puts in an httpOnly cookie. */
export type IssuedSession = { body: AuthResponse; refreshToken: string };

const invalidCredentials = () => new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");

export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return slug || "org";
}

async function uniqueSubdomain(orgName: string): Promise<string> {
  const base = slugify(orgName);
  if (!(await tenantsRepository.subdomainTaken(base))) return base;
  for (let i = 2; i <= 20; i++) {
    const candidate = `${base}-${i}`;
    if (!(await tenantsRepository.subdomainTaken(candidate))) return candidate;
  }
  return `${base}-${randomBytes(3).toString("hex")}`;
}

async function issueSession(user: User & { tenant: Tenant }, familyId: string = randomUUID()): Promise<IssuedSession> {
  const { token, hash } = newRefreshToken();
  await refreshTokensRepository.create(user.tenantId, {
    userId: user.id,
    familyId,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + config.auth.refreshTtlDays * 86_400_000),
  });
  const accessToken = signAccessToken({ userId: user.id, tenantId: user.tenantId, role: user.role });
  return { body: { accessToken, user: toSessionUser(user), tenant: toTenantSummary(user.tenant) }, refreshToken: token };
}

/** Creates the organisation (tenant) and its OWNER account in one transaction. */
export async function signup(input: unknown): Promise<IssuedSession> {
  const { fullName, orgName, email, password } = SignupRequest.parse(input);
  const [firstName, ...rest] = fullName.split(/\s+/);
  const subdomain = await uniqueSubdomain(orgName);
  const passwordHash = await hashPassword(password);

  const user = await prisma.$transaction(async (tx) => {
    const tenant = await tenantsRepository.create({ name: orgName, subdomain }, tx);
    return usersRepository.create(
      tenant.id,
      { email, passwordHash, firstName: firstName.slice(0, 80), lastName: rest.join(" ").slice(0, 80), role: "OWNER" },
      tx,
    );
  });
  return issueSession(user);
}

export async function login(input: unknown): Promise<IssuedSession> {
  const { email, password, tenantSlug } = LoginRequest.parse(input);
  const candidates = (await usersRepository.findAllByEmail(email)).filter(
    (u) => !tenantSlug || u.tenant.subdomain === tenantSlug,
  );
  if (candidates.length === 0) {
    await burnPasswordCheck(password);
    throw invalidCredentials();
  }

  const matches: typeof candidates = [];
  for (const user of candidates) {
    if (await verifyPassword(password, user.passwordHash)) matches.push(user);
  }
  if (matches.length === 0) throw invalidCredentials();
  if (matches.length > 1) {
    throw new AppError(409, "TENANT_REQUIRED", "This email belongs to more than one organisation. Choose one to continue.", {
      tenants: matches.map((u) => ({ slug: u.tenant.subdomain, name: u.tenant.name })),
    });
  }
  return issueSession(matches[0]);
}

/** Rotates the refresh token. Reusing a rotated token (outside the grace window) ends the whole session family. */
export async function refresh(token: string | undefined): Promise<IssuedSession> {
  if (!token) throw unauthenticated("Please sign in");
  const record = await refreshTokensRepository.findByHash(hashToken(token));
  if (!record || record.expiresAt.getTime() <= Date.now()) throw unauthenticated("Your session has expired");

  if (record.revokedAt) {
    if (Date.now() - record.revokedAt.getTime() > config.auth.refreshReuseGraceMs) {
      await refreshTokensRepository.revokeFamily(record.familyId);
      throw unauthenticated("Your session has expired");
    }
  } else {
    await refreshTokensRepository.revoke(record.id);
  }

  const user = await usersRepository.findById(record.tenantId, record.userId);
  if (!user) throw unauthenticated();
  return issueSession(user, record.familyId);
}

export async function logout(token: string | undefined): Promise<void> {
  if (!token) return;
  const record = await refreshTokensRepository.findByHash(hashToken(token));
  if (record) await refreshTokensRepository.revokeFamily(record.familyId);
}

export async function me(auth: AuthContext): Promise<MeResponse> {
  const user = await usersRepository.findById(auth.tenantId, auth.userId);
  if (!user) throw unauthenticated();
  return { user: toSessionUser(user), tenant: toTenantSummary(user.tenant) };
}
