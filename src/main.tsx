import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Scrolling the page with the mouse wheel must never change a number field the cursor happens to
// be over: drop focus from a focused number input as soon as the wheel turns.
document.addEventListener(
  "wheel",
  () => {
    const el = document.activeElement;
    if (el instanceof HTMLInputElement && el.type === "number") el.blur();
  },
  { passive: true }
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
