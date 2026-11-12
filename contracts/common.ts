// Shared API contract: reusable field schemas.
import { z } from "zod";

/** 8-4-4-4-12 hex id. Loose on purpose: accepts any UUID version. */
export const Id = z.guid();

export const Email = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** International or local phone number; spaces, dashes and brackets are removed. */
export const Phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{7,24}$/, "Enter a valid phone number")
  .transform((value) => value.replace(/[\s()-]/g, ""))
  .pipe(z.string().max(25));

export const HexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #10b981")
  .transform((value) => value.toLowerCase());

export const CurrencyCode = z.string().trim().toUpperCase().pipe(z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code"));

/** Money travels as a decimal string ("2500.00") so no precision is lost. */
export const Money = z.string();

/** Timestamps travel as ISO-8601 strings. */
export const Timestamp = z.iso.datetime({ offset: true });
