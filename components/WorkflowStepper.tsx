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
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", width: "100%", maxWidth: "900px", margin: "0 auto" }}>
      
      {/* Stepper Header (Desktop & Tablet) */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", overflowX: "auto", paddingBottom: "8px" }}>
        {steps.map((step, index) => {
          const isCompleted = index < currentStepIndex;
          const isActive = index === currentStepIndex;
          
          return (
            <div key={step.id} style={{ display: "flex", alignItems: "center", flex: 1 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div 
                    style={{ 
                      width: "28px", 
                      height: "28px", 
                      borderRadius: "50%", 
                      backgroundColor: isCompleted ? "var(--qb-success)" : isActive ? "var(--qb-primary)" : "var(--qb-surface-muted)",
                      color: isCompleted || isActive ? "#fff" : "var(--qb-text-secondary)",
                      display: "flex", 
                      alignItems: "center", 
                      justifyContent: "center",
                      fontSize: "0.875rem",
                      fontWeight: 700
                    }}
                  >
                    {isCompleted ? <Check size={16} /> : index + 1}
                  </div>
                  <span style={{ fontWeight: isActive ? 700 : 500, color: isActive || isCompleted ? "var(--qb-text-primary)" : "var(--qb-text-secondary)", fontSize: "0.875rem" }}>
                    {step.title}
                  </span>
                </div>
              </div>
              {index !== steps.length - 1 && (
                <div style={{ flex: 1, height: "2px", backgroundColor: isCompleted ? "var(--qb-success)" : "var(--qb-border)", margin: "0 16px" }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Main Content Area */}
      <div className="qb-card" style={{ padding: "32px", minHeight: "400px", display: "flex", flexDirection: "column" }}>
        <div style={{ marginBottom: "24px" }}>
          <h2 style={{ fontSize: "1.5rem", margin: "0 0 8px 0" }}>{currentStep.title}</h2>
          {currentStep.description && <p className="qb-muted" style={{ margin: 0 }}>{currentStep.description}</p>}
        </div>
        
        <div style={{ flex: 1 }}>
          {currentStep.content}
        </div>
        
        {/* Footer Navigation */}
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--qb-border)", paddingTop: "24px", marginTop: "24px" }}>
          <button className="qb-btn ghost" onClick={handleBack}>
            {isFirstStep ? "Cancel" : "Back"}
          </button>
          <button 
            className="qb-btn" 
            onClick={handleNext} 
            disabled={currentStep.isValid === false}
            style={{ display: "flex", alignItems: "center", gap: "8px" }}
          >
            {isLastStep ? "Launch Campaign" : "Next Step"}
            {!isLastStep && <ChevronRight size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
