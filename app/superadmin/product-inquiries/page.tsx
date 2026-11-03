"use client";

import ProductInquiriesPanel from "../../staff/components/ProductInquiriesPanel";

export default function SuperadminProductInquiriesPage() {
  return <ProductInquiriesPanel apiBase="/api/superadmin/product-inquiries" />;
}
