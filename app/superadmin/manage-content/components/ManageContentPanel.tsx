"use client";

import { useState } from "react";
import { Package, CreditCard, Tag, Mail } from "lucide-react";
import {
  PortalPageHeader,
  PortalToastStack,
  usePortalToasts,
} from "../../components/ui";
import {
  MANAGE_CONTENT_TABS,
  type ManageContentTab,
} from "./manage-content-shared";
import ProductsTab from "./ProductsTab";
import SubscriptionTiersTab from "./SubscriptionTiersTab";
import LimitedTimeOffersTab from "./LimitedTimeOffersTab";
import NewsletterTab from "./NewsletterTab";

const TAB_ICONS = {
  products: Package,
  subscription: CreditCard,
  offers: Tag,
  newsletter: Mail,
} as const;

export default function ManageContentPanel() {
  const [tab, setTab] = useState<ManageContentTab>("products");
  const { toasts, push, dismiss } = usePortalToasts();

  const onNotice = (type: "success" | "error", message: string) => {
    push(type, message);
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <PortalPageHeader
        title="Manage Content"
        subtitle="Products, subscriptions, limited-time offers, and promotional emails."
      />

      <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div
          className="flex items-center gap-2 border-b border-[#e8eef8] bg-[#fbfdff] px-3 py-2 sm:px-4"
          role="tablist"
          aria-label="Manage content tabs"
        >
          <div className="flex w-full items-center gap-1 overflow-x-auto">
            {MANAGE_CONTENT_TABS.map(({ id, label }) => {
              const Icon = TAB_ICONS[id];
              const active = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                    active
                      ? "bg-white text-primary shadow-sm"
                      : "text-gray-500 hover:bg-white hover:text-gray-900"
                  }`}
                  role="tab"
                  aria-selected={active}
                  aria-controls={`manage-content-panel-${id}`}
                  id={`manage-content-tab-${id}`}
                >
                  <Icon className={`h-4 w-4 ${active ? "text-primary" : "text-gray-500"}`} />
                  <span className="whitespace-nowrap">{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-4 py-5 sm:px-6">
          {tab === "products" && (
            <div
              id="manage-content-panel-products"
              role="tabpanel"
              aria-labelledby="manage-content-tab-products"
            >
              <ProductsTab onNotice={onNotice} />
            </div>
          )}
          {tab === "subscription" && (
            <div
              id="manage-content-panel-subscription"
              role="tabpanel"
              aria-labelledby="manage-content-tab-subscription"
            >
              <SubscriptionTiersTab onNotice={onNotice} />
            </div>
          )}
          {tab === "offers" && (
            <div
              id="manage-content-panel-offers"
              role="tabpanel"
              aria-labelledby="manage-content-tab-offers"
            >
              <LimitedTimeOffersTab onNotice={onNotice} />
            </div>
          )}
          {tab === "newsletter" && (
            <div
              id="manage-content-panel-newsletter"
              role="tabpanel"
              aria-labelledby="manage-content-tab-newsletter"
            >
              <NewsletterTab onNotice={onNotice} />
            </div>
          )}
        </div>
      </section>

      <PortalToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
