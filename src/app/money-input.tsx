"use client";

import { useState } from "react";
import { parsePesos, pesosInput } from "./money";

export function MoneyInput({
  valueMinor,
  disabled,
  onChangeMinor,
  onInvalidChange,
}: {
  valueMinor: number | null;
  disabled?: boolean;
  onChangeMinor: (value: number | null) => void;
  onInvalidChange: (invalid: boolean) => void;
}) {
  const [text, setText] = useState(
    valueMinor === null ? "" : pesosInput(valueMinor),
  );
  const [invalid, setInvalid] = useState(false);

  function change(value: string) {
    setText(value);
    const parsed = value.trim() === "" ? null : parsePesos(value);
    const bad = value.trim() !== "" && parsed === null;
    setInvalid(bad);
    onInvalidChange(bad);
    if (!bad) onChangeMinor(parsed);
  }

  return (
    <>
      <input
        type="text"
        inputMode="decimal"
        placeholder="123,45"
        value={text}
        disabled={disabled}
        aria-invalid={invalid}
        onChange={(event) => change(event.target.value)}
        onBlur={() => {
          if (!invalid && text.trim() !== "") {
            const parsed = parsePesos(text);
            if (parsed !== null) setText(pesosInput(parsed));
          }
        }}
      />
      {invalid && (
        <span className="error">Usa un importe con hasta dos decimales.</span>
      )}
    </>
  );
}
