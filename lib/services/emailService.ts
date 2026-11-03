import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

type EmailProvider = "smtp" | "resend";

interface SendVerificationResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface SendVerificationInput {
  email: string;
  code: string;
  expiresAt: Date;
}

interface SendStaffInviteInput {
  email: string;
  firstName: string;
  verifyUrl: string;
  expiresAt: Date;
}

interface SendStaffInviteResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface SendCompanyEmployeeInviteInput {
  email: string;
  companyName: string;
  inviterName: string;
  acceptUrl: string;
  expiresAt: Date;
}

interface SendCompanyEmployeeInviteResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface SendCompanyJoinConfirmationInput {
  email: string;
  companyName: string;
  dashboardUrl: string;
}

interface SendCompanyJoinConfirmationResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatInviteExpiryLabel(expiresAt: Date): string {
  const msRemaining = Math.max(0, expiresAt.getTime() - Date.now());
  const hours = Math.max(1, Math.ceil(msRemaining / (60 * 60 * 1000)));
  if (hours >= 24) {
    const days = Math.max(1, Math.ceil(hours / 24));
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

function resolveTransactionalFromAddress(provider: EmailProvider): string | null {
  const configured =
    process.env.EMAIL_FROM_ADDRESS?.trim() ||
    process.env.SMTP_FROM?.trim() ||
    (provider === "smtp" ? process.env.SMTP_USER?.trim() : undefined);
  if (!configured || /@example\.com$/i.test(configured)) {
    return null;
  }
  return configured;
}

function resolveAppBaseUrlForEmail(): string | null {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    process.env.FRONTEND_URL?.trim() ||
    "";
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

function buildTransactionalMailHeaders(fromAddress: string): Record<string, string> {
  const replyTo = process.env.EMAIL_REPLY_TO?.trim() || fromAddress;
  const headers: Record<string, string> = {
    "Reply-To": replyTo,
  };
  const baseUrl = resolveAppBaseUrlForEmail();
  if (baseUrl) {
    headers["List-Unsubscribe"] = `<${baseUrl}/user/settings>`;
  }
  return headers;
}

function formatFromHeader(fromName: string, fromAddress: string): string {
  const safeName = fromName.replace(/[\r\n"<>]/g, "").trim() || "OnTap Team";
  return `"${safeName}" <${fromAddress}>`;
}

function createSmtpTransporter(): Transporter {
  const host = getRequiredEnv("SMTP_HOST");
  const user = getRequiredEnv("SMTP_USER");
  const pass = getRequiredEnv("SMTP_PASS");
  const port = Number(process.env.SMTP_PORT || "587");
  const secure = process.env.SMTP_SECURE === "true" || port === 465;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    requireTLS: !secure && port === 587,
    disableFileAccess: true,
    disableUrlAccess: true,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
}

function isEmailDeliveryConfigured(provider: EmailProvider): boolean {
  if (provider === "resend") {
    return Boolean(process.env.RESEND_API_KEY?.trim());
  }

  return Boolean(
    process.env.SMTP_HOST?.trim() &&
      process.env.SMTP_USER?.trim() &&
      process.env.SMTP_PASS?.trim()
  );
}

function buildVerificationHtml(code: string, expiresAt: Date): string {
  const expiresInMinutes = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 60000));

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Verify your email</title>
</head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#f3f4f6;margin:0;padding:24px;color:#111827;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;border:1px solid #e5e7eb;">
    <h1 style="margin:0 0 16px;font-size:24px;color:#1f2937;">Verify your email address</h1>
    <p style="margin:0 0 16px;line-height:1.5;color:#374151;">Use this verification code to complete your account setup.</p>
    <div style="font-size:36px;font-weight:700;letter-spacing:8px;text-align:center;color:#1d4ed8;margin:20px 0;">${code}</div>
    <p style="margin:0 0 8px;line-height:1.5;color:#374151;">This code expires in ${expiresInMinutes} minutes.</p>
    <p style="margin:0;line-height:1.5;color:#6b7280;font-size:13px;">Never share this code with anyone.</p>
  </div>
</body>
</html>`;
}

function buildStaffInviteHtml(firstName: string, verifyUrl: string, expiresAt: Date): string {
  const safeName = firstName.trim() || "there";
  const expiresInHours = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / (60 * 60 * 1000)));

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Verify your staff account</title>
</head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#f3f4f6;margin:0;padding:24px;color:#111827;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;border:1px solid #e5e7eb;">
    <h1 style="margin:0 0 16px;font-size:24px;color:#1f2937;">Welcome to OnTap Staff</h1>
    <p style="margin:0 0 16px;line-height:1.5;color:#374151;">Hi ${safeName},</p>
    <p style="margin:0 0 20px;line-height:1.5;color:#374151;">
      Your staff account has been created. Click the button below to verify your account and set your password.
    </p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${verifyUrl}"
         style="display:inline-block;background:linear-gradient(135deg,#2A4792 0%,#4785B8 100%);color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 28px;border-radius:10px;">
        Verify Account
      </a>
    </div>
    <p style="margin:0 0 12px;line-height:1.5;color:#374151;font-size:14px;">
      Or copy and paste this link into your browser:
    </p>
    <p style="margin:0 0 20px;line-height:1.5;color:#2A4792;font-size:13px;word-break:break-all;">${verifyUrl}</p>
    <p style="margin:0;line-height:1.5;color:#6b7280;font-size:13px;">
      This link expires in ${expiresInHours} hour${expiresInHours === 1 ? "" : "s"}. If you did not expect this invitation, you can ignore this email.
    </p>
  </div>
</body>
</html>`;
}

function buildCompanyEmployeeInviteHtml(
  companyName: string,
  inviterName: string,
  acceptUrl: string,
  expiresAt: Date,
): string {
  const safeCompany = escapeHtml(companyName.trim() || "a company");
  const safeInviter = escapeHtml(inviterName.trim() || "A company admin");
  const safeAcceptUrl = escapeHtml(acceptUrl);
  const expiryLabel = formatInviteExpiryLabel(expiresAt);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Company invitation</title>
</head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#f3f4f6;margin:0;padding:24px;color:#111827;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;border:1px solid #e5e7eb;">
    <h1 style="margin:0 0 16px;font-size:24px;color:#1f2937;">You're invited to join ${safeCompany}</h1>
    <p style="margin:0 0 16px;line-height:1.5;color:#374151;">${safeInviter} has invited you to join their company on OnTap.</p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${safeAcceptUrl}"
         style="display:inline-block;background:linear-gradient(135deg,#2A4792 0%,#4785B8 100%);color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 28px;border-radius:10px;">
        Accept Invitation
      </a>
    </div>
    <p style="margin:0 0 12px;line-height:1.5;color:#374151;font-size:14px;">
      Or copy and paste this link into your browser:
    </p>
    <p style="margin:0 0 20px;line-height:1.5;color:#2A4792;font-size:13px;word-break:break-all;">${safeAcceptUrl}</p>
    <p style="margin:0;line-height:1.5;color:#6b7280;font-size:13px;">
      This link expires in ${expiryLabel}. If you did not expect this invitation, you can ignore this email.
    </p>
  </div>
</body>
</html>`;
}

function buildCompanyJoinConfirmationHtml(
  companyName: string,
  dashboardUrl: string,
): string {
  const safeCompany = escapeHtml(companyName.trim() || "your company");
  const safeDashboardUrl = escapeHtml(dashboardUrl);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Welcome to ${safeCompany}</title>
</head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#f3f4f6;margin:0;padding:24px;color:#111827;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;border:1px solid #e5e7eb;">
    <h1 style="margin:0 0 16px;font-size:24px;color:#1f2937;">Welcome to the team</h1>
    <p style="margin:0 0 16px;line-height:1.5;color:#374151;">
      You have successfully joined <strong>${safeCompany}</strong> on OnTap.
    </p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${safeDashboardUrl}"
         style="display:inline-block;background:linear-gradient(135deg,#2A4792 0%,#4785B8 100%);color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 28px;border-radius:10px;">
        Open Dashboard
      </a>
    </div>
    <p style="margin:0;line-height:1.5;color:#6b7280;font-size:13px;">
      If you did not join this company, contact your company administrator.
    </p>
  </div>
</body>
</html>`;
}

export class EmailService {
  private static instance: EmailService;

  private readonly provider: EmailProvider;

  private constructor() {
    const configured = (process.env.EMAIL_PROVIDER || "smtp").toLowerCase();
    this.provider = configured === "resend" ? "resend" : "smtp";
  }

  static getInstance(): EmailService {
    if (!EmailService.instance) {
      EmailService.instance = new EmailService();
    }
    return EmailService.instance;
  }

  private async sendWithSmtp({ email, code, expiresAt }: SendVerificationInput): Promise<SendVerificationResult> {
    const fromName = process.env.EMAIL_FROM_NAME || "OnTap Team";
    const fromAddress =
      process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_FROM || getRequiredEnv("SMTP_USER");

    const transporter = createSmtpTransporter();

    try {
      const info = await transporter.sendMail({
        from: `"${fromName}" <${fromAddress}>`,
        to: email,
        subject: "Verify Your Email Address",
        html: buildVerificationHtml(code, expiresAt),
        text: `Your verification code is ${code}. This code expires at ${expiresAt.toISOString()}.`,
      });

      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "SMTP_SEND_FAILED";
      console.error("[EmailService] SMTP send failed:", message);
      return {
        success: false,
        error: message,
      };
    } finally {
      transporter.close();
    }
  }

  private async sendWithResend({ email, code, expiresAt }: SendVerificationInput): Promise<SendVerificationResult> {
    const apiKey = getRequiredEnv("RESEND_API_KEY");
    const fromAddress = process.env.EMAIL_FROM_ADDRESS || "noreply@example.com";

    try {
      const dynamicImporter = new Function("m", "return import(m)") as (m: string) => Promise<{ Resend: new (apiKey: string) => { emails: { send: (payload: Record<string, unknown>) => Promise<{ data?: { id?: string }; error?: { message?: string } }> } } }>;
      const module = await dynamicImporter("resend");
      const ResendCtor = module.Resend;
      const resend = new ResendCtor(apiKey);
      const response = await resend.emails.send({
        from: fromAddress,
        to: email,
        subject: "Verify Your Email Address",
        html: buildVerificationHtml(code, expiresAt),
      });

      if (response.error) {
        return { success: false, error: response.error.message || "RESEND_SEND_FAILED" };
      }

      return {
        success: true,
        messageId: response.data?.id,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "RESEND_SEND_FAILED",
      };
    }
  }

  async sendVerificationEmail(input: SendVerificationInput): Promise<SendVerificationResult> {
    if (this.provider === "resend") {
      return this.sendWithResend(input);
    }

    return this.sendWithSmtp(input);
  }

  private async sendStaffInviteWithSmtp(input: SendStaffInviteInput): Promise<SendStaffInviteResult> {
    const fromName = process.env.EMAIL_FROM_NAME || "OnTap Team";
    const fromAddress = process.env.EMAIL_FROM_ADDRESS || getRequiredEnv("SMTP_USER");
    const html = buildStaffInviteHtml(input.firstName, input.verifyUrl, input.expiresAt);

    const transporter = createSmtpTransporter();

    try {
      const info = await transporter.sendMail({
        from: `"${fromName}" <${fromAddress}>`,
        to: input.email,
        subject: "Verify Your OnTap Staff Account",
        html,
        text: `Verify your staff account: ${input.verifyUrl}`,
      });

      return { success: true, messageId: info.messageId };
    } catch (error) {
      const message = error instanceof Error ? error.message : "SMTP_SEND_FAILED";
      console.error("[EmailService] Staff invite SMTP send failed:", message);
      return {
        success: false,
        error: message,
      };
    } finally {
      transporter.close();
    }
  }

  private async sendStaffInviteWithResend(input: SendStaffInviteInput): Promise<SendStaffInviteResult> {
    const apiKey = getRequiredEnv("RESEND_API_KEY");
    const fromAddress = process.env.EMAIL_FROM_ADDRESS || "noreply@example.com";
    const html = buildStaffInviteHtml(input.firstName, input.verifyUrl, input.expiresAt);

    try {
      const dynamicImporter = new Function("m", "return import(m)") as (m: string) => Promise<{
        Resend: new (apiKey: string) => {
          emails: {
            send: (payload: Record<string, unknown>) => Promise<{
              data?: { id?: string };
              error?: { message?: string };
            }>;
          };
        };
      }>;
      const module = await dynamicImporter("resend");
      const resend = new module.Resend(apiKey);
      const response = await resend.emails.send({
        from: fromAddress,
        to: input.email,
        subject: "Verify Your OnTap Staff Account",
        html,
      });

      if (response.error) {
        return { success: false, error: response.error.message || "RESEND_SEND_FAILED" };
      }

      return { success: true, messageId: response.data?.id };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "RESEND_SEND_FAILED",
      };
    }
  }

  async sendStaffInviteVerificationEmail(input: SendStaffInviteInput): Promise<SendStaffInviteResult> {
    if (!isEmailDeliveryConfigured(this.provider)) {
      const missing =
        this.provider === "resend"
          ? "RESEND_API_KEY"
          : "SMTP_HOST, SMTP_USER, and SMTP_PASS";
      console.error("[EmailService] Staff invite email skipped; delivery is not configured", {
        provider: this.provider,
        missing,
      });
      return {
        success: false,
        error: `EMAIL_NOT_CONFIGURED:${missing}`,
      };
    }

    if (this.provider === "resend") {
      return this.sendStaffInviteWithResend(input);
    }
    return this.sendStaffInviteWithSmtp(input);
  }

  private async sendCompanyEmployeeInviteWithSmtp(
    input: SendCompanyEmployeeInviteInput,
  ): Promise<SendCompanyEmployeeInviteResult> {
    const fromAddress = resolveTransactionalFromAddress("smtp");
    if (!fromAddress) {
      return {
        success: false,
        error: "EMAIL_NOT_CONFIGURED:EMAIL_FROM_ADDRESS",
      };
    }

    const fromName = process.env.EMAIL_FROM_NAME || "OnTap Team";
    const fromHeader = formatFromHeader(fromName, fromAddress);
    const headers = buildTransactionalMailHeaders(fromAddress);
    const html = buildCompanyEmployeeInviteHtml(
      input.companyName,
      input.inviterName,
      input.acceptUrl,
      input.expiresAt,
    );
    const companyLabel = input.companyName.trim() || "a company";
    const text = [
      `You're invited to join ${companyLabel} on OnTap.`,
      `${input.inviterName.trim() || "A company admin"} invited you.`,
      `Accept your company invitation: ${input.acceptUrl}`,
    ].join("\n\n");

    const transporter = createSmtpTransporter();

    try {
      const info = await transporter.sendMail({
        from: fromHeader,
        to: input.email,
        subject: `You're invited to join ${companyLabel} on OnTap`,
        html,
        text,
        replyTo: headers["Reply-To"],
        headers,
      });

      return { success: true, messageId: info.messageId };
    } catch (error) {
      const message = error instanceof Error ? error.message : "SMTP_SEND_FAILED";
      console.error("[EmailService] Company employee invite SMTP send failed:", message);
      return { success: false, error: message };
    } finally {
      transporter.close();
    }
  }

  private async sendCompanyEmployeeInviteWithResend(
    input: SendCompanyEmployeeInviteInput,
  ): Promise<SendCompanyEmployeeInviteResult> {
    const fromAddress = resolveTransactionalFromAddress("resend");
    if (!fromAddress) {
      return {
        success: false,
        error: "EMAIL_NOT_CONFIGURED:EMAIL_FROM_ADDRESS",
      };
    }

    const apiKey = getRequiredEnv("RESEND_API_KEY");
    const fromName = process.env.EMAIL_FROM_NAME || "OnTap Team";
    const fromHeader = formatFromHeader(fromName, fromAddress);
    const headers = buildTransactionalMailHeaders(fromAddress);
    const html = buildCompanyEmployeeInviteHtml(
      input.companyName,
      input.inviterName,
      input.acceptUrl,
      input.expiresAt,
    );
    const companyLabel = input.companyName.trim() || "a company";
    const text = [
      `You're invited to join ${companyLabel} on OnTap.`,
      `${input.inviterName.trim() || "A company admin"} invited you.`,
      `Accept your company invitation: ${input.acceptUrl}`,
    ].join("\n\n");

    try {
      const dynamicImporter = new Function("m", "return import(m)") as (m: string) => Promise<{
        Resend: new (apiKey: string) => {
          emails: {
            send: (payload: Record<string, unknown>) => Promise<{
              data?: { id?: string };
              error?: { message?: string };
            }>;
          };
        };
      }>;
      const module = await dynamicImporter("resend");
      const resend = new module.Resend(apiKey);
      const response = await resend.emails.send({
        from: fromHeader,
        to: input.email,
        subject: `You're invited to join ${companyLabel} on OnTap`,
        html,
        text,
        reply_to: headers["Reply-To"],
        headers,
      });

      if (response.error) {
        return { success: false, error: response.error.message || "RESEND_SEND_FAILED" };
      }

      return { success: true, messageId: response.data?.id };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "RESEND_SEND_FAILED",
      };
    }
  }

  async sendCompanyEmployeeInviteEmail(
    input: SendCompanyEmployeeInviteInput,
  ): Promise<SendCompanyEmployeeInviteResult> {
    if (!isEmailDeliveryConfigured(this.provider)) {
      const missing =
        this.provider === "resend"
          ? "RESEND_API_KEY"
          : "SMTP_HOST, SMTP_USER, and SMTP_PASS";
      console.error("[EmailService] Company employee invite email skipped; delivery is not configured", {
        provider: this.provider,
        missing,
      });
      return {
        success: false,
        error: `EMAIL_NOT_CONFIGURED:${missing}`,
      };
    }

    if (!resolveTransactionalFromAddress(this.provider)) {
      console.error(
        "[EmailService] Company employee invite email skipped; EMAIL_FROM_ADDRESS is missing or invalid",
        { provider: this.provider },
      );
      return {
        success: false,
        error: "EMAIL_NOT_CONFIGURED:EMAIL_FROM_ADDRESS",
      };
    }

    if (this.provider === "resend") {
      return this.sendCompanyEmployeeInviteWithResend(input);
    }
    return this.sendCompanyEmployeeInviteWithSmtp(input);
  }

  private async sendCompanyJoinConfirmationWithSmtp(
    input: SendCompanyJoinConfirmationInput,
  ): Promise<SendCompanyJoinConfirmationResult> {
    const fromAddress = resolveTransactionalFromAddress("smtp");
    if (!fromAddress) {
      return {
        success: false,
        error: "EMAIL_NOT_CONFIGURED:EMAIL_FROM_ADDRESS",
      };
    }

    const fromName = process.env.EMAIL_FROM_NAME || "OnTap Team";
    const fromHeader = formatFromHeader(fromName, fromAddress);
    const headers = buildTransactionalMailHeaders(fromAddress);
    const companyLabel = input.companyName.trim() || "your company";
    const html = buildCompanyJoinConfirmationHtml(companyLabel, input.dashboardUrl);
    const text = [
      `You have successfully joined ${companyLabel} on OnTap.`,
      `Open your dashboard: ${input.dashboardUrl}`,
    ].join("\n\n");

    const transporter = createSmtpTransporter();

    try {
      const info = await transporter.sendMail({
        from: fromHeader,
        to: input.email,
        subject: `Welcome to ${companyLabel} on OnTap`,
        html,
        text,
        replyTo: headers["Reply-To"],
        headers,
      });
      return { success: true, messageId: info.messageId };
    } catch (error) {
      const message = error instanceof Error ? error.message : "SMTP_SEND_FAILED";
      console.error("[EmailService] Company join confirmation SMTP send failed:", message);
      return { success: false, error: message };
    } finally {
      transporter.close();
    }
  }

  private async sendCompanyJoinConfirmationWithResend(
    input: SendCompanyJoinConfirmationInput,
  ): Promise<SendCompanyJoinConfirmationResult> {
    const fromAddress = resolveTransactionalFromAddress("resend");
    if (!fromAddress) {
      return {
        success: false,
        error: "EMAIL_NOT_CONFIGURED:EMAIL_FROM_ADDRESS",
      };
    }

    const apiKey = getRequiredEnv("RESEND_API_KEY");
    const fromName = process.env.EMAIL_FROM_NAME || "OnTap Team";
    const fromHeader = formatFromHeader(fromName, fromAddress);
    const headers = buildTransactionalMailHeaders(fromAddress);
    const companyLabel = input.companyName.trim() || "your company";
    const html = buildCompanyJoinConfirmationHtml(companyLabel, input.dashboardUrl);
    const text = [
      `You have successfully joined ${companyLabel} on OnTap.`,
      `Open your dashboard: ${input.dashboardUrl}`,
    ].join("\n\n");

    try {
      const dynamicImporter = new Function("m", "return import(m)") as (m: string) => Promise<{
        Resend: new (apiKey: string) => {
          emails: {
            send: (payload: Record<string, unknown>) => Promise<{
              data?: { id?: string };
              error?: { message?: string };
            }>;
          };
        };
      }>;
      const module = await dynamicImporter("resend");
      const resend = new module.Resend(apiKey);
      const response = await resend.emails.send({
        from: fromHeader,
        to: input.email,
        subject: `Welcome to ${companyLabel} on OnTap`,
        html,
        text,
        reply_to: headers["Reply-To"],
        headers,
      });

      if (response.error) {
        return { success: false, error: response.error.message || "RESEND_SEND_FAILED" };
      }

      return { success: true, messageId: response.data?.id };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "RESEND_SEND_FAILED",
      };
    }
  }

  async sendCompanyJoinConfirmationEmail(
    input: SendCompanyJoinConfirmationInput,
  ): Promise<SendCompanyJoinConfirmationResult> {
    if (!isEmailDeliveryConfigured(this.provider)) {
      const missing =
        this.provider === "resend"
          ? "RESEND_API_KEY"
          : "SMTP_HOST, SMTP_USER, and SMTP_PASS";
      return {
        success: false,
        error: `EMAIL_NOT_CONFIGURED:${missing}`,
      };
    }

    if (!resolveTransactionalFromAddress(this.provider)) {
      return {
        success: false,
        error: "EMAIL_NOT_CONFIGURED:EMAIL_FROM_ADDRESS",
      };
    }

    if (this.provider === "resend") {
      return this.sendCompanyJoinConfirmationWithResend(input);
    }
    return this.sendCompanyJoinConfirmationWithSmtp(input);
  }
}
