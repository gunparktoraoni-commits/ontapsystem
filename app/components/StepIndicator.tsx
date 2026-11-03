'use client';

import React from 'react';

interface StepIndicatorProps {
  currentStep: number;
  totalSteps: number;
}

const StepIndicator: React.FC<StepIndicatorProps> = ({ currentStep, totalSteps }) => {
  return (
    <div>
      {/* Header row: logo + step label */}
      <div className="flex items-center justify-between mb-4">
        <img src="/ontaplogo.svg" alt="OnTap Logo" width={70} height={70} className="w-[70px] h-auto" draggable={false} decoding="async" />
        <span className="text-sm text-primary-light font-medium">
          step {currentStep} to {totalSteps}
        </span>
      </div>

      {/* Divider line */}
      <hr className="border-gray-200 mb-4" />

      {/* Progress track with pills */}
      <div className="relative flex items-center justify-center mb-6">
        {/* Background line */}
        <div className="absolute left-1/2 -translate-x-1/2 h-0.75 bg-gray-200 rounded-full" style={{ width: `${(totalSteps - 1) * 56}px` }} />

        {/* Step pills */}
        <div className="relative flex items-center" style={{ gap: '28px' }}>
          {Array.from({ length: totalSteps }, (_, i) => {
            const stepNum = i + 1;
            const isActive = stepNum === currentStep;
            const isCompleted = stepNum < currentStep;

            return (
              <div
                key={i}
                className={`h-2.5 rounded-full border-2 transition-all duration-300 ${
                  isActive
                    ? 'w-10 bg-primary border-primary'
                    : isCompleted
                    ? 'w-7 bg-primary border-primary'
                    : 'w-7 bg-white border-primary/40'
                }`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default StepIndicator;
