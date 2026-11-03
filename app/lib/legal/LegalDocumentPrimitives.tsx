import type { ReactNode } from "react";

type LegalDocumentLayoutProps = {
  title: string;
  lastUpdated?: string;
  lastUpdatedIso?: string;
  backHref?: string;
  toc: ReactNode;
  children: ReactNode;
};

/**
 * Modal-friendly legal document shell (ported from new-ontap-landing-page).
 * Stacks TOC above the document on mobile; side-by-side on larger screens.
 */
export function LegalDocumentLayout({
  title,
  lastUpdated = "January 01, 2026",
  lastUpdatedIso = "2026-01-01",
  toc,
  children,
}: LegalDocumentLayoutProps) {
  return (
    <div className="flex w-full flex-col gap-6 lg:flex-row lg:gap-8">
      <aside className="w-full shrink-0 lg:w-56 xl:w-64">
        <h2 className="text-lg font-bold text-gray-900 sm:text-xl">{title}</h2>
        <p className="mt-1 text-xs text-gray-500">
          Last updated:{" "}
          <time dateTime={lastUpdatedIso} className="font-medium text-gray-700">
            {lastUpdated}
          </time>
        </p>
        <div className="mt-4 max-h-40 overflow-y-auto overscroll-contain rounded-xl border border-gray-100 bg-gray-50/80 p-3 lg:max-h-[min(55vh,420px)]">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            Sections
          </p>
          <div className="flex flex-col items-start text-gray-700 [&_a]:border-gray-200 [&_a]:text-gray-700 [&_a:hover]:border-[#2A4792] [&_a:hover]:text-[#2A4792]">
            {toc}
          </div>
        </div>
      </aside>
      <div className="min-w-0 flex-1 space-y-8 text-sm leading-7 text-gray-700 sm:text-[15px] [&_h2]:scroll-mt-4 [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-gray-900 sm:[&_h2]:text-lg [&_h3]:mt-4 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-gray-900 [&_p]:text-gray-600 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_table]:w-full [&_table]:text-left [&_th]:border-b [&_th]:border-gray-200 [&_th]:py-2 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-gray-500 [&_td]:border-b [&_td]:border-gray-100 [&_td]:py-2 [&_td]:align-top">
        {children}
      </div>
    </div>
  );
}

type LegalTocLinkProps = {
  href: string;
  number: string;
  children: ReactNode;
  nested?: boolean;
};

export function LegalTocLink({
  href,
  number,
  children,
  nested = false,
}: LegalTocLinkProps) {
  return (
    <a
      href={href}
      className={`flex w-full min-w-0 items-start gap-3 border-b-2 border-t border-t-gray-200 border-b-transparent py-2 text-left text-sm transition-all duration-100 ease-in hover:border-[#2A4792] hover:text-[#2A4792] focus:border-[#2A4792] focus:text-[#2A4792] sm:text-base ${
        nested ? "pl-1" : ""
      }`}
    >
      <span className="min-w-6 shrink-0 text-sm font-bold">{number}</span>
      <span className="min-w-0 break-words">{children}</span>
    </a>
  );
}

type LegalTableRowProps = {
  label: string;
  children: ReactNode;
  cols?: 4 | 5;
  isHeader?: boolean;
  isLast?: boolean;
};

/** Responsive 2-column legal table row (stacks on small screens). */
export function LegalTableRow({
  label,
  children,
  cols = 5,
  isHeader = false,
  isLast = false,
}: LegalTableRowProps) {
  const labelSpan = cols === 5 ? "sm:col-span-2" : "sm:col-span-1";
  const valueSpan = "sm:col-span-3";
  const gridClass = cols === 5 ? "sm:grid-cols-5" : "sm:grid-cols-4";

  return (
    <div
      className={`grid w-full grid-cols-1 ${gridClass} ${
        isLast ? "" : "border-b border-gray-200"
      }`}
    >
      {isHeader ? (
        <>
          <h3
            className={`${labelSpan} border-b border-gray-200 px-4 py-3 text-base font-semibold text-[#2A4792] sm:border-b-0 sm:border-r sm:px-5 sm:text-lg`}
          >
            <strong>{label}</strong>
          </h3>
          <h3 className={`${valueSpan} px-4 py-3 text-base font-semibold text-[#2A4792] sm:px-5 sm:text-lg`}>
            <strong>{children}</strong>
          </h3>
        </>
      ) : (
        <>
          <h4
            className={`${labelSpan} border-b border-gray-200 p-4 text-base font-semibold text-gray-600 sm:border-b-0 sm:border-r sm:p-5 sm:text-lg`}
          >
            {label}
          </h4>
          <p className={`${valueSpan} p-4 text-sm font-light text-gray-700 sm:p-5 sm:text-base`}>
            {children}
          </p>
        </>
      )}
    </div>
  );
}

type LegalBulletProps = {
  children: ReactNode;
  isLast?: boolean;
};

export function LegalBullet({ children, isLast = false }: LegalBulletProps) {
  return (
    <div
      className={`flex w-full items-stretch ${
        isLast ? "" : "border-b border-gray-200"
      }`}
    >
      <span
        className="flex max-w-8 min-w-8 items-start justify-center border-r border-gray-200 pt-4 text-xl text-gray-400 sm:max-w-10 sm:min-w-10 sm:pt-5 sm:text-2xl"
        aria-hidden
      >
        ●
      </span>
      <p className="min-w-0 break-words p-4 text-sm font-light text-gray-700 sm:p-5 sm:text-base">
        {children}
      </p>
    </div>
  );
}
