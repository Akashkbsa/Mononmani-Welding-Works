import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { onTabListKeyDown, PageHeader } from "../components/ui";
import PaySheetTab from "../components/employees/PaySheetTab";
import EmployeesTab from "../components/employees/EmployeesTab";

type Tab = "sheet" | "employees";

const TABS: { id: Tab; label: string }[] = [
  { id: "sheet", label: "Pay sheet" },
  { id: "employees", label: "Employees" },
];

/** Employees and their monthly pay: the pay sheet for a month, and the list of employees. */
export default function EmployeesPage() {
  const [tab, setTab] = useState<Tab>("sheet");
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [slider, setSlider] = useState<{ x: number; w: number } | null>(null);
  const [sliderReady, setSliderReady] = useState(false);

  useLayoutEffect(() => {
    const el = tabRefs.current[tab];
    if (el) setSlider({ x: el.offsetLeft, w: el.offsetWidth });
  }, [tab]);

  useEffect(() => {
    if (slider && !sliderReady) {
      const frame = requestAnimationFrame(() => setSliderReady(true));
      return () => cancelAnimationFrame(frame);
    }
  }, [slider, sliderReady]);

  return (
    <>
      <PageHeader title="Employees" description="Who works here, their days and overtime each month, and what has been paid." />

      <div className="mb-4 border-b border-slate-200">
        <div role="tablist" onKeyDown={onTabListKeyDown} aria-label="Employees" className="relative flex gap-1 w-fit">
          <span
            aria-hidden="true"
            className={`${sliderReady ? "mww-slider" : ""} pointer-events-none absolute -bottom-px left-0 h-0.5 w-[100px] origin-left bg-brand-600`}
            style={{ transform: slider ? `translateX(${slider.x}px) scaleX(${slider.w / 100})` : "scaleX(0)" }}
          />
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 h-9 text-sm transition-colors ${
                tab === t.id ? "text-brand-700 font-medium" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel">
        {tab === "sheet" && <PaySheetTab />}
        {tab === "employees" && <EmployeesTab />}
      </div>
    </>
  );
}
