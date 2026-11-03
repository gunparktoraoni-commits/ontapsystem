'use client';

import { CreditCard, ArrowRight, Clock, Star, Wifi, Zap } from 'lucide-react';
import React from 'react';
import StepIndicator from './StepIndicator';

interface UpsellPhysicalCardProps {
  currentStep: number;
  totalSteps: number;
  onGetCard: () => void;
  onSkip: () => void;
}

const FEATURES = [
  {
    icon: Wifi,
    label: 'NFC-enabled',
    description: 'Tap to share your digital profile instantly',
  },
  {
    icon: Zap,
    label: 'Instant sharing',
    description: 'No app needed — works on any modern smartphone',
  },
  
  {
    icon: Star,
    label: 'Premium finish',
    description: 'High-quality card with your personal brand',
  },
] as const;

const UpsellPhysicalCard: React.FC<UpsellPhysicalCardProps> = ({
  currentStep,
  totalSteps,
  onGetCard,
  onSkip,
}) => {
  return (
    <div className="w-full max-w-md bg-white rounded-2xl p-8">
      <StepIndicator currentStep={currentStep} totalSteps={totalSteps} />

      {/* Hero icon */}
      <div className="flex justify-center mb-5">
        <div className="w-20 h-20 rounded-2xl flex items-center justify-center shadow-md"
          style={{ background: 'linear-gradient(135deg, #2A4792, #4785B8)' }}>
          <CreditCard className="h-10 w-10 text-white" strokeWidth={1.5} />
        </div>
      </div>

      {/* Headline */}
      <h1 className="text-2xl font-bold text-gray-900 text-center mb-2 leading-snug">
        Get Your First Physical BizCard
      </h1>
      <p className="text-gray-400 text-sm text-center mb-6 leading-relaxed">
        Your digital profile is live — take it one step further with a
        physical NFC BizCard that shares your profile with a single tap.
      </p>

      {/* Feature list */}
      <div className="space-y-3 mb-7">
        {FEATURES.map(({ icon: Icon, label, description }) => (
          <div
            key={label}
            className="flex items-start gap-3 bg-blue-50 rounded-xl px-4 py-3"
          >
            <div className="w-8 h-8 rounded-lg bg-[#2D3A8C]/10 flex items-center justify-center shrink-0 mt-0.5">
              <Icon className="h-4 w-4 text-[#2D3A8C]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800">{label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{description}</p>
            </div>
          </div>
        ))}
      </div>

      {/* CTA */}
      <button
        type="button"
        onClick={onGetCard}
        className="w-full bg-[#2D3A8C] hover:bg-[#243080] text-white font-semibold py-3.5 rounded-xl transition-colors text-sm cursor-pointer flex items-center justify-center gap-2 mb-3"
      >
        Get My Physical BizCard
        <ArrowRight className="h-4 w-4" />
      </button>

      {/* Skip */}
      <button
        type="button"
        onClick={onSkip}
        className="w-full flex items-center justify-center gap-1.5 border border-gray-200 hover:bg-gray-50 text-gray-500 font-medium py-3 rounded-xl transition-colors text-sm cursor-pointer"
      >
        <Clock className="h-4 w-4" />
        Do this later
      </button>
    </div>
  );
};

export default UpsellPhysicalCard;
