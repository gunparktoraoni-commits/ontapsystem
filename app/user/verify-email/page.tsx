'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import VerifyEmailUser from '../../components/VerifyEmailUser';
import { markSupportPopupPending } from '../../components/support/SupportPopUp';

export default function VerifyEmailPage() {
  const router = useRouter();

  // When accessed standalone (e.g. from a link), userId/email may not be
  // available — the component handles empty strings gracefully.
  
  return (
    <div className="min-h-screen bg-[#F4F7FC] flex items-center justify-center px-4">
      <VerifyEmailUser
        onVerified={() => {
          markSupportPopupPending();
          router.push('/user/dashboard');
        }}
        onBack={() => router.push('/user/login')}
      />
    </div>
  );
}
