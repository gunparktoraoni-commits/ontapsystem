import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { cn } from "@/lib/utils";
import ChunkLoadRecovery from "./components/ChunkLoadRecovery";
import { CspNonceProvider } from "./components/CspNonceProvider";
import ToastProvider from "./components/Toast";
import ConfirmDialogProvider from "./components/ConfirmDialog";
import InputDialogProvider from "./components/InputDialog";
import { ModalProvider } from "./components/ModalProvider";

export const metadata: Metadata = {
  title: "OnTap Portal | OnTap Digital Bizcard Management Platform",
  description:
    "Ontap Bizcard is a digital business card solution that offers a sleek and modern way to share your contact information.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      className={cn("font-sans")}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <CspNonceProvider nonce={nonce}>
          <ModalProvider>
            <ChunkLoadRecovery />
            <ConfirmDialogProvider>
              <InputDialogProvider>
                <ToastProvider>
                  {children}
                </ToastProvider>
              </InputDialogProvider>
            </ConfirmDialogProvider>
          </ModalProvider>
        </CspNonceProvider>
      </body>
    </html>
  );
}
