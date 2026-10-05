"use client";
import { useId } from "react";

/** Checkbox and radio group. Own file so each theme panel gets its own radio group name (via useId). */
export function ChoiceDemo() {
  const group = useId();
  return (
    <>
      <label className="check"><input type="checkbox" /> I can deliver this myself</label>
      <fieldset>
        <legend>Preferred time</legend>
        <label className="check"><input type="radio" name={group} defaultChecked /> Weekday evening</label>
        <label className="check"><input type="radio" name={group} /> Weekend morning</label>
      </fieldset>
    </>
  );
}
