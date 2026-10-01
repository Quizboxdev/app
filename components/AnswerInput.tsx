"use client";

import { RichContent } from "@/components/QuestionRenderer";
import type { AttemptQuestion } from "@/lib/types";

export interface AnswerState {
  selectedAnswer?: string | null;
  selectedValue?: any;
}

export default function AnswerInput({
  question,
  value,
  onChange,
}: {
  question: AttemptQuestion;
  value: AnswerState;
  onChange: (value: AnswerState) => void;
}) {
  const type = String(question.answer_type ?? "SINGLE_CHOICE").toUpperCase();

  const normalizedOptions =
    question.options?.length
      ? question.options.map((option) => ({
          key: option.option_key,
          content: option.content,
        }))
      : [
          { key: "A", text: question.option_a },
          { key: "B", text: question.option_b },
          { key: "C", text: question.option_c },
          { key: "D", text: question.option_d },
        ].filter((x) => x.text);

  if (["SINGLE_CHOICE", "TRUE_FALSE"].includes(type)) {
    return (
      <div>
        {normalizedOptions.map((option: any) => {
          const selected = value.selectedAnswer === option.key;
          return (
            <button
              key={option.key}
              type="button"
              className={`qb-option ${selected ? "selected" : ""}`}
              onClick={() =>
                onChange({
                  selectedAnswer: option.key,
                  selectedValue: null,
                })
              }
            >
              <strong>{option.key}.</strong>{" "}
              {option.content ? (
                <RichContent content={option.content} media={question.media} />
              ) : (
                option.text
              )}
            </button>
          );
        })}
      </div>
    );
  }

  if (type === "MULTIPLE_CHOICE") {
    const selected = new Set<string>(
      Array.isArray(value.selectedValue?.options)
        ? value.selectedValue.options
        : []
    );

    return (
      <div>
        {normalizedOptions.map((option: any) => {
          const checked = selected.has(option.key);
          return (
            <label
              key={option.key}
              className={`qb-option ${checked ? "selected" : ""}`}
              style={{ display: "block" }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                  const next = new Set(selected);
                  checked ? next.delete(option.key) : next.add(option.key);
                  onChange({
                    selectedAnswer: null,
                    selectedValue: { options: Array.from(next) },
                  });
                }}
              />{" "}
              <strong>{option.key}.</strong>{" "}
              {option.content ? (
                <RichContent content={option.content} media={question.media} />
              ) : (
                option.text
              )}
            </label>
          );
        })}
      </div>
    );
  }

  if (type === "NUMERIC") {
    return (
      <div className="qb-field">
        <label>Your answer</label>
        <input
          type="number"
          step="any"
          value={value.selectedValue?.value ?? ""}
          onChange={(e) =>
            onChange({
              selectedAnswer: null,
              selectedValue: {
                value: e.target.value === "" ? null : Number(e.target.value),
              },
            })
          }
        />
      </div>
    );
  }

  if (type === "FRACTION") {
    return (
      <div className="qb-grid cols-2">
        <div className="qb-field">
          <label>Numerator</label>
          <input
            type="number"
            value={value.selectedValue?.numerator ?? ""}
            onChange={(e) =>
              onChange({
                selectedAnswer: null,
                selectedValue: {
                  ...(value.selectedValue ?? {}),
                  numerator:
                    e.target.value === "" ? null : Number(e.target.value),
                },
              })
            }
          />
        </div>
        <div className="qb-field">
          <label>Denominator</label>
          <input
            type="number"
            value={value.selectedValue?.denominator ?? ""}
            onChange={(e) =>
              onChange({
                selectedAnswer: null,
                selectedValue: {
                  ...(value.selectedValue ?? {}),
                  denominator:
                    e.target.value === "" ? null : Number(e.target.value),
                },
              })
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="qb-field">
      <label>Your answer</label>
      <input
        value={value.selectedAnswer ?? ""}
        onChange={(e) =>
          onChange({
            selectedAnswer: e.target.value,
            selectedValue: null,
          })
        }
        placeholder={type === "EXPRESSION" ? "Enter expression" : "Enter answer"}
      />
    </div>
  );
}
