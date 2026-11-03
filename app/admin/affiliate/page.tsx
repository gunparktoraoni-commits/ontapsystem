'use client';

import dynamic from 'next/dynamic';
const AffiliateUser = dynamic(() => import('../../components/AffiliateUser'), { ssr: false });
export default function AdminAffiliatePage() {
  return <AffiliateUser />;
}

