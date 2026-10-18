import { z } from "zod";
import { isDisposableEmailDomain } from "../lib/disposable-domains";

// ─── Register ───────────────────────────────────────────────
export const registerSchema = z.object({
  email: z
    .string()
    .email()
    .max(255)
    .toLowerCase()
    .trim()
    .refine((e) => !isDisposableEmailDomain(e), "Please use a valid, non-disposable email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128)
    .regex(/[A-Z]/, "Password must contain an uppercase letter")
    .regex(/[a-z]/, "Password must contain a lowercase letter")
    .regex(/[0-9]/, "Password must contain a number")
    .regex(/[^A-Za-z0-9]/, "Password must contain a special character"),
  firstName: z.string().min(1).max(50).trim().optional(),
  lastName: z.string().min(1).max(50).trim().optional(),
  phone: z
    .string()
    .regex(/^\+?[0-9]\d{7,14}$/, "Invalid phone number")
    .optional(),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores")
    .trim()
    .optional(),
  referralCode: z.string().max(20).trim().optional(),
});

// ─── Login ──────────────────────────────────────────────────
export const loginSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
  password: z.string().min(1).max(128),
});

// ─── PIN ────────────────────────────────────────────────────
export const setPinSchema = z.object({
  pin: z
    .string()
    .length(4, "PIN must be exactly 4 digits")
    .regex(/^\d{4}$/, "PIN must be 4 digits"),
});

export const verifyPinSchema = z.object({
  pin: z
    .string()
    .length(4, "PIN must be exactly 4 digits")
    .regex(/^\d{4}$/, "PIN must be 4 digits"),
});

export const changePinSchema = z.object({
  currentPin: z
    .string()
    .length(4, "PIN must be exactly 4 digits")
    .regex(/^\d{4}$/, "PIN must be 4 digits"),
  newPin: z
    .string()
    .length(4, "PIN must be exactly 4 digits")
    .regex(/^\d{4}$/, "PIN must be 4 digits"),
});

// ─── Email Verification ────────────────────────────────────
export const verifyEmailSchema = z.object({
  code: z
    .string()
    .length(6, "Code must be 6 digits")
    .regex(/^\d{6}$/, "Code must be 6 digits"),
});

export const resendVerificationSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
});

// ─── Password Reset ────────────────────────────────────────
export const requestPasswordResetSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
});

export const confirmPasswordResetSchema = z.object({
  email: z.string().email().max(255).toLowerCase().trim(),
  code: z
    .string()
    .length(6, "Code must be 6 digits")
    .regex(/^\d{6}$/, "Code must be 6 digits"),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128)
    .regex(/[A-Z]/, "Password must contain an uppercase letter")
    .regex(/[a-z]/, "Password must contain a lowercase letter")
    .regex(/[0-9]/, "Password must contain a number")
    .regex(/[^A-Za-z0-9]/, "Password must contain a special character"),
});

// ─── PIN Reset ─────────────────────────────────────────────
export const requestPinResetSchema = z.object({});

export const confirmPinResetSchema = z.object({
  code: z
    .string()
    .length(6, "Code must be 6 digits")
    .regex(/^\d{6}$/, "Code must be 6 digits"),
  newPin: z
    .string()
    .length(4, "PIN must be exactly 4 digits")
    .regex(/^\d{4}$/, "PIN must be 4 digits"),
});

// ─── Change Password ───────────────────────────────────────
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128)
    .regex(/[A-Z]/, "Password must contain an uppercase letter")
    .regex(/[a-z]/, "Password must contain a lowercase letter")
    .regex(/[0-9]/, "Password must contain a number")
    .regex(/[^A-Za-z0-9]/, "Password must contain a special character"),
});

// ─── Biometric ─────────────────────────────────────────────
export const enableBiometricSchema = z.object({
  enabled: z.boolean(),
});

// ─── Refresh Token ─────────────────────────────────────────
export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});
