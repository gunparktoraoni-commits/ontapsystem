"use client";

import type { StyleHTMLAttributes } from "react";
import { useCspNonce } from "./CspNonceProvider";

export default function CspStyle(props: StyleHTMLAttributes<HTMLStyleElement>) {
  const nonce = useCspNonce();
  return <style {...props} nonce={nonce} />;
}
