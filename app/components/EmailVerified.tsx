'use client';

import { CheckCircle, CreditCard, ShoppingCart, LayoutList } from 'lucide-react';
import React from 'react';


interface EmailVerifiedProps {
  onContinueBizCard: () => void;
  onSkip: () => void;
}

const EmailVerified: React.FC<EmailVerifiedProps> = ({ onContinueBizCard, onSkip }) => {
  return (
    <div className="w-full max-w-md bg-white rounded-2xl p-8 text-center">
      <div className="flex justify-center mb-4">
        <CheckCircle className="h-14 w-14 text-green-500" />
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Email Verified!</h1>
      <p className="text-gray-400 text-sm mb-8 leading-relaxed">
        Your email has been successfully verified.<br />
        Would you like set-up your BizCard
      </p>
      <div className="border border-gray-200 rounded-2xl p-6">
        <div className="flex justify-center mb-3">
          <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center">
            <LayoutList className="h-6 w-6 text-[#2D3A8C]" />
          </div>
        </div>
        <h2 className="text-lg font-bold text-gray-900 mb-4">Set up  Your BizCard</h2>
        {/* Progress Icons */}
        <div className="flex items-center justify-center gap-0 mb-8">
          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
            <CreditCard className="h-5 w-5 text-[#2D3A8C]" />
          </div>
          <div className="w-10 h-0.5 bg-gray-200" />
          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
            <CreditCard className="h-5 w-5 text-[#2D3A8C]" />
          </div>
          <div className="w-10 h-0.5 bg-gray-200" />
          <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
            <ShoppingCart className="h-5 w-5 text-gray-400" />
          </div>
        </div>
        <button
          type="button"
          onClick={onContinueBizCard}
          className="w-full bg-[#2D3A8C] hover:bg-[#243080] text-white font-semibold py-3.5 rounded-full transition-colors text-base cursor-pointer mb-3"
        >
          Continue Set-up BizCard →
        </button>
        <p className="text-gray-400 text-sm my-3">OR</p>
        <button
          type="button"
          onClick={onSkip}
          className="w-full border border-gray-200 hover:bg-gray-50 text-[#2D3A8C] font-semibold py-3.5 rounded-full transition-colors text-base cursor-pointer"
        >
          Skip
        </button>
      </div>
    </div>
  );
};

export default EmailVerified;
