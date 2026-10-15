import { useEffect, useState } from "react";
import { getSnoozeChoices, saveSnoozeChoices } from "../services/api";
import { errorMessage } from "../lib/format";
import { SNOOZE_OPTIONS, snoozeLabel } from "../lib/reminders";
import { Alert, Button, Card, Checkbox, Loading, useToast } from "./ui";

/** Which snooze lengths the reminder banner offers. One choice snoozes straight away; more show a small menu. */
export default function SnoozeSettingsCard() {
  const toast = useToast();
  const [saved, setSaved] = useState<number[] | null>(null);
  const [chosen, setChosen] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSnoozeChoices()
      .then((days) => {
        setSaved(days);
        setChosen(days);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const toggle = (days: number, on: boolean) => setChosen((c) => (on ? [...c, days] : c.filter((d) => d !== days)).sort((a, b) => a - b));

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const days = await saveSnoozeChoices(chosen);
      setSaved(days);
      setChosen(days);
      toast("Snooze choices saved");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const unchanged = saved !== null && saved.join(",") === chosen.join(",");
  // A length saved earlier that is not in the usual list still shows, so it can be turned off.
  const options = Array.from(new Set([...SNOOZE_OPTIONS, ...(saved ?? [])])).sort((a, b) => a - b);

  return (
    <Card className="p-6 max-w-3xl space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Reminder snooze</h2>
        <p className="text-sm text-slate-600 mt-1">
          Snooze on the reminder banner hides a reminder until the day you pick; it stays on the Reminders page. With one
          choice ticked, Snooze works in one click; with more, it asks how long.
        </p>
      </div>
      {error && <Alert>{error}</Alert>}
      {saved === null ? (
        !error && <Loading />
      ) : (
        <>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {options.map((d) => (
              <Checkbox key={d} checked={chosen.includes(d)} onChange={(on) => toggle(d, on)} label={snoozeLabel(d)} />
            ))}
          </div>
          <div className="flex justify-end">
            <Button variant="primary" loading={saving} disabled={unchanged || chosen.length === 0} onClick={save}>
              Save snooze choices
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
