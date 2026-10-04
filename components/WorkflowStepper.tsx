"use client";

import { useState, ReactNode } from "react";
import { Check, ChevronRight } from "lucide-react";

export interface WorkflowStep {
  id: string;
  title: string;
  description?: string;
  content: ReactNode;
  isValid?: boolean; // Can be used to disable the 'Next' button
}

interface WorkflowStepperProps {
  steps: WorkflowStep[];
  onComplete: () => void;
  onCancel?: () => void;
}

export default function WorkflowStepper({
  steps,
  onComplete,
  onCancel,
}: WorkflowStepperProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  const currentStep = steps[currentStepIndex];
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === steps.length - 1;

  const handleNext = () => {
    if (!isLastStep) setCurrentStepIndex((prev) => prev + 1);
    else onComplete();
  };

  const handleBack = () => {
    if (!isFirstStep) setCurrentStepIndex((prev) => prev - 1);
    else if (onCancel) onCancel();
  };

  return (
    <div className="qb-stepper">
      <ol className="qb-stepper-steps" aria-label="Progress">
        {steps.map((step, index) => {
          const state = index < currentStepIndex ? "done" : index === currentStepIndex ? "active" : "todo";
          return (
            <li key={step.id} className={`qb-step ${state}`} aria-current={state === "active" ? "step" : undefined}>
              <span className="qb-step-dot" aria-hidden="true">{state === "done" ? <Check size={14} /> : index + 1}</span>
              <span className="qb-step-title">{step.title}</span>
            </li>
          );
        })}
      </ol>
      <p className="qb-stepper-count qb-muted qb-small">Step {currentStepIndex + 1} of {steps.length}</p>

      <div className="qb-card qb-stepper-body">
        <div className="qb-stepper-head">
          <h2>{currentStep.title}</h2>
          {currentStep.description && <p className="qb-muted">{currentStep.description}</p>}
        </div>

        <div className="qb-stepper-content">
          {currentStep.content}
        </div>

        <div className="qb-stepper-foot">
          <button type="button" className="qb-btn ghost" onClick={handleBack}>
            {isFirstStep ? "Cancel" : "Back"}
          </button>
          <button type="button" className="qb-btn" onClick={handleNext} disabled={currentStep.isValid === false}>
            {isLastStep ? "Launch campaign" : "Next step"}
            {!isLastStep && <ChevronRight size={16} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </div>
  );
}
