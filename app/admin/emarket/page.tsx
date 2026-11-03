'use client';

import dynamic from 'next/dynamic';

const MarketPlace = dynamic(() => import('../../components/MarketPlace'), { ssr: false });

export default function AdminEmarketPage() {
  return <MarketPlace />;
}
