import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PageHeader } from "../components/ui";
import ThisMonthTab from "../components/rentals/ThisMonthTab";
import TenantsTab from "../components/rentals/TenantsTab";
import PlacesTab from "../components/rentals/PlacesTab";

type Tab = "month" | "tenants" | "places";

const TABS: { id: Tab; label: string }[] = [
  { id: "month", label: "This month" },
  { id: "tenants", label: "Tenants" },
  { id: "places", label: "Places" },
];

export default function RentalsPage() {
  const [tab, setTab] = useState<Tab>("month");
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
      <PageHeader title="Rentals" description="Places you rent out, your tenants, and who has paid this month." />

      <div className="mb-4 border-b border-slate-200">
        <div role="tablist" aria-label="Rentals" className="relative flex gap-1 w-fit">
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
        {tab === "month" && <ThisMonthTab />}
        {tab === "tenants" && <TenantsTab />}
        {tab === "places" && <PlacesTab />}
      </div>
    </>
  );
}
