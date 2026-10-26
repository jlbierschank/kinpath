"use client";
export function PrintButton() {
  return <button className="btn btn-line" type="button" onClick={() => window.print()}>Print or save as PDF</button>;
}
