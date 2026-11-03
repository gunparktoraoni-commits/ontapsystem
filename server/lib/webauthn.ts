import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { resolveAppBaseUrl } from "@/lib/utils/app-base-url";

export type WebAuthnEndpointConfig = {
  origin: string;
  rpId: string;
};

export function resolveWebAuthnConfig(requestUrl?: string): WebAuthnEndpointConfig {
  const origin = resolveAppBaseUrl(requestUrl ? { url: requestUrl } : undefined);
  const rpId = new URL(origin).hostname;
  return { origin, rpId };
}

export function parseTransports(value: string | null | undefined): AuthenticatorTransportFuture[] | undefined {
  if (!value) return undefined;
  const transports = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean) as AuthenticatorTransportFuture[];
  return transports.length > 0 ? transports : undefined;
}

export function serializeTransports(transports?: AuthenticatorTransportFuture[] | null): string | null {
  if (!transports || transports.length === 0) return null;
  return transports.join(",");
}
