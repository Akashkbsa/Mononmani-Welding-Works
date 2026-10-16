import { DOCUMENT_CATEGORIES, DocumentCategory } from "../../types/document";

/** The two groups of the vault as two large choices, with what belongs in each. */
export default function CategoryChoice({ value, onChange }: { value: DocumentCategory; onChange: (c: DocumentCategory) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-[13px] font-medium text-slate-700">Keep in</legend>
      <div className="grid grid-cols-2 gap-3">
        {DOCUMENT_CATEGORIES.map((c) => (
          <label
            key={c.id}
            className={`cursor-pointer rounded-lg border px-4 py-3 transition-colors duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-300 ${
              value === c.id ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500" : "border-slate-200 hover:border-slate-300"
            }`}
          >
            <input type="radio" name="document-category" className="sr-only" checked={value === c.id} onChange={() => onChange(c.id)} />
            <span className="block text-sm font-medium text-slate-900">{c.label}</span>
            <span className="mt-0.5 block text-xs text-slate-500">{c.hint}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
