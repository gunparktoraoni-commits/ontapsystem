'use client';

import dynamic from 'next/dynamic';

const BizCardList = dynamic(() => import('../../components/BizCardList'), { ssr: false });

export default function AdminBizCardListPage() {
  return <BizCardList />;
}
