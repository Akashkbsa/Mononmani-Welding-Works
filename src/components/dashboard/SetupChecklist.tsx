import { useEffect, useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import type { Page } from "../../App";
import { BusinessSettings } from "../../types/settings";
import { BackupStatus } from "../../types/backup";
import { getBackupStatus, getSettings } from "../../services/api";
import { Button, Card } from "../ui";

interface Props {
  onNavigate: (page: Page) => void;
}

interface Step {
  label: string;
  done: boolean;
}

function steps(settings: BusinessSettings, backup: BackupStatus): Step[] {
  return [
    { label: "Business name & GSTIN", done: settings.business_name.trim() !== "" },
    { label: "Bank account details", done: settings.bank_account_no.trim() !== "" },
    { label: "Google Drive backup", done: backup.configured },
  ];
}

export default function SetupChecklist({ onNavigate }: Props) {
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [backup, setBackup] = useState<BackupStatus | null>(null);

  useEffect(() => {
    Promise.all([getSettings(), getBackupStatus()])
      .then(([s, b]) => {
        setSettings(s);
        setBackup(b);
      })
      .catch(() => {
        // Checklist is a helper; a failed load just hides it.
      });
  }, []);

  if (!settings || !backup) return null;

  const list = steps(settings, backup);
  if (list.every((s) => s.done)) return null;

  return (
    <section role="region" aria-label="Setup checklist" className="mb-6">
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Complete your setup</h2>
        <ul className="space-y-2">
          {list.map((step) => (
            <li key={step.label} className="flex items-center gap-3 text-sm">
              {step.done ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-slate-300" />
              )}
              <span className={step.done ? "text-slate-400 line-through" : "text-slate-700"}>{step.label}</span>
              {!step.done && (
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onNavigate("settings")}>
                  Set up →
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
