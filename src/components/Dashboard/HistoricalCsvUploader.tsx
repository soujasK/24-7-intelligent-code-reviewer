import { useState } from 'react';
import { parseHistoricalReviewCsv, SAMPLE_HISTORICAL_RULES_CSV } from '../../utils/csv-parser';
import type { RawPolicyRule } from '../../types/rules';

interface HistoricalCsvUploaderProps {
  onRulesLoaded: (rules: RawPolicyRule[], datasetName?: string) => void;
  onClearRules?: () => void;
  currentRuleCount: number;
}

export function HistoricalCsvUploader({ onRulesLoaded, onClearRules, currentRuleCount }: HistoricalCsvUploaderProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        const rules = parseHistoricalReviewCsv(content);
        if (rules.length > 0) {
          onRulesLoaded(rules, file.name);
          setSuccessMessage(`Loaded ${rules.length} historical review rules from CSV!`);
          setTimeout(() => setSuccessMessage(null), 4000);
        }
      }
    };
    reader.readAsText(file);
  };

  const handleLoadSampleCsv = (): void => {
    const rules = parseHistoricalReviewCsv(SAMPLE_HISTORICAL_RULES_CSV);
    onRulesLoaded(rules, 'Sample Historical Rules (CSV)');
    setSuccessMessage(`Loaded ${rules.length} sample historical review rules (<id>, <type>, <description>)!`);
    setTimeout(() => setSuccessMessage(null), 4000);
  };

  const handleClear = (): void => {
    if (onClearRules) onClearRules();
    setSuccessMessage(`Cleared all active historical rules.`);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 mb-6 text-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-100">Historical Review Dataset Engine</h3>
              <span className={`text-xs px-2 py-0.5 rounded font-mono ${currentRuleCount > 0 ? 'bg-indigo-500/20 text-indigo-300' : 'bg-slate-800 text-slate-400'}`}>
                {currentRuleCount} Rules Active
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Ingests review data CSV in schema: <code className="font-mono text-slate-300">&lt;id&gt;, &lt;type&gt;, &lt;description&gt;</code> to inform and ground reviews.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {currentRuleCount > 0 && onClearRules && (
            <button
              onClick={handleClear}
              className="rounded-md border border-rose-900/40 bg-rose-950/30 px-2.5 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-900/50 transition-all"
            >
              Clear Rules
            </button>
          )}
          <button
            onClick={handleLoadSampleCsv}
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition-all"
          >
            Load Sample CSV Rules
          </button>
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="rounded-md bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 transition-all shadow-sm"
          >
            {isOpen ? 'Close CSV Panel' : 'Upload CSV File'}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="mt-4 pt-3 border-t border-slate-800 space-y-3">
          <div className="flex items-center gap-3">
            <input
              type="file"
              accept=".csv,.txt"
              onChange={handleFileUpload}
              className="text-xs text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-slate-200 hover:file:bg-slate-700 cursor-pointer"
            />
          </div>

          <div className="rounded-lg bg-slate-950 p-3 text-xs font-mono text-slate-400 space-y-1">
            <p className="font-semibold text-slate-300">Expected CSV Format Example:</p>
            <pre className="text-[11px] text-indigo-300">
              1, formatting, Avoid single-character variable names — they hurt readability{"\n"}
              2, performance, Cache repeated database lookups inside the request loop{"\n"}
              3, security, Never interpolate raw user input directly into SQL queries
            </pre>
          </div>
        </div>
      )}

      {successMessage && (
        <div className="mt-3 text-xs text-emerald-400 font-medium flex items-center gap-2">
          <span>✓</span> {successMessage}
        </div>
      )}
    </div>
  );
}
