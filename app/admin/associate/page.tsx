'use client';

import dynamic from 'next/dynamic';

const AssociateUser = dynamic(() => import('../../components/AssociateUser'), { ssr: false });

export default function AdminAssociatePage() {
  return <AssociateUser />;
}
