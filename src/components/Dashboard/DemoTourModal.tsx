import { useState, useEffect } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  ChevronRight,
  ChevronLeft,
  X,
  Sparkles,
  Volume2,
} from 'lucide-react';

interface DemoStep {
  id: number;
  part: string;
  timeRange: string;
  title: string;
  screenAction: string;
  voiceover: string;
  actionCallback?: () => void;
}

interface DemoTourModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadSampleCsv: () => void;
  onExportCsv: () => void;
  onSelectTab: (tab: 'mesh' | 'graph') => void;
  onAskChatbot: (prompt: string) => void;
  onScanMesh: () => void;
}

export function DemoTourModal({
  isOpen,
  onClose,
  onLoadSampleCsv,
  onExportCsv,
  onSelectTab,
  onAskChatbot,
  onScanMesh,
}: DemoTourModalProps): JSX.Element | null {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [autoTimer, setAutoTimer] = useState(25);

  const steps: DemoStep[] = [
    {
      id: 1,
      part: 'PART 1: CORE HACKATHON REQUIREMENTS',
      timeRange: '0:00 – 0:25',
      title: 'Problem & Standardized Quality Rating (1.0–10.0)',
      screenAction: 'Point mouse to the 1.0 to 10.0 Code Quality Rating card, ELO metric badge, and Active File Health circular gauge.',
      voiceover:
        '“Welcome to CodeKitchen — an automated, 24/7 intelligent code reviewer built for the next generation of engineers. Traditional code reviewers send your private source code to external servers. CodeKitchen solves this with a zero-trust architecture: parsing ASTs and executing DuckDB SQL queries 100% inside your browser via WebAssembly, generating a Standardized Code Quality Rating on a scale of 1.0 to 10.0.”',
      actionCallback: () => {
        onSelectTab('mesh');
        window.scrollTo({ top: 120, behavior: 'smooth' });
      },
    },
    {
      id: 2,
      part: 'PART 1: CORE HACKATHON REQUIREMENTS',
      timeRange: '0:25 – 1:05',
      title: 'Historical Review CSV Ingestion (<id>, <type>, <description>)',
      screenAction: 'Click "Load Sample CSV Rules" (or Upload CSV). Show rule counter jump to 7 Rules Active and point to new findings on the panel.',
      voiceover:
        '“CodeKitchen is built to ingest and learn from historical review datasets. By uploading a CSV file formatted as ID, Type, and Description, our CSV-to-AST Policy Compiler dynamically converts natural language guidelines into executable DuckDB SQL rules, instantly re-evaluating your code against your team’s historical guidelines.”',
      actionCallback: () => {
        onLoadSampleCsv();
        window.scrollTo({ top: 320, behavior: 'smooth' });
      },
    },
    {
      id: 3,
      part: 'PART 1: CORE HACKATHON REQUIREMENTS',
      timeRange: '1:05 – 1:30',
      title: 'Interactive AI Chatbot & Persistent Growth Timeline',
      screenAction: 'Click "Explain active CSV rules" in Assistant Chat, then view the Developer Growth & Session History Timeline.',
      voiceover:
        '“Developers can ask our AI Chatbot Assistant powered by Gemini 2.5 Flash about active CSV rules and security findings. User evaluation sessions are also saved persistently to Firebase Firestore so developer growth and quality ratings can be tracked over time.”',
      actionCallback: () => {
        onAskChatbot('Explain active CSV rules');
        window.scrollTo({ top: 600, behavior: 'smooth' });
      },
    },
    {
      id: 4,
      part: 'PART 1: CORE HACKATHON REQUIREMENTS',
      timeRange: '1:30 – 1:45',
      title: 'Part 1: CSV Security Audit Report Export',
      screenAction: 'Click the "Export CSV" button in the navbar. Show zero-trust-report-*.csv downloading in the browser.',
      voiceover:
        '“At any point, developers can click ‘Export CSV’ to download a complete, structured security audit report of their single-file evaluations.”',
      actionCallback: () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setTimeout(() => onExportCsv(), 1000);
      },
    },
    {
      id: 5,
      part: 'PART 2: ADVANCED REPOSITORY ENGINE & BLAST RADIUS',
      timeRange: '1:45 – 1:55',
      title: 'Clean State Session Refresh',
      screenAction: 'Hit Refresh (F5 or Scan Mesh) on your browser to clear previous tab state and start fresh.',
      voiceover:
        '“Now, let’s refresh our browser to start a clean repository evaluation session with zero state friction.”',
      actionCallback: () => {
        onScanMesh();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
    },
    {
      id: 6,
      part: 'PART 2: ADVANCED REPOSITORY ENGINE & BLAST RADIUS',
      timeRange: '1:55 – 2:35',
      title: 'GitHub Repo Importer & 5-Agent Swarm',
      screenAction: 'Select a repository from the selector and click Scan Mesh. Show the 5 Agent Swarm cards processing in parallel.',
      voiceover:
        '“CodeKitchen securely imports full public and private GitHub repositories using OAuth tokens. Our zero-trust 5-Agent Swarm evaluates full codebases in parallel using client-side WebAssembly Web Workers.”',
      actionCallback: () => {
        window.scrollTo({ top: 450, behavior: 'smooth' });
      },
    },
    {
      id: 7,
      part: 'PART 2: ADVANCED REPOSITORY ENGINE & BLAST RADIUS',
      timeRange: '2:35 – 2:50',
      title: 'Interactive Blast Radius Dependency Graph',
      screenAction: 'Click the Blast Radius Graph tab at the top navbar. Hover over connected nodes showing cross-file function calls.',
      voiceover:
        '“To prevent cross-file breaking changes, we construct an interactive Blast Radius Graph visualizing function call coupling and dependency risks across the entire repository.”',
      actionCallback: () => {
        onSelectTab('graph');
        window.scrollTo({ top: 120, behavior: 'smooth' });
      },
    },
    {
      id: 8,
      part: 'PART 2: ADVANCED REPOSITORY ENGINE & BLAST RADIUS',
      timeRange: '2:50 – 3:00',
      title: 'Part 2: Repository CSV Export & Closing',
      screenAction: 'Click Export CSV again (downloading full repository audit report) and conclude.',
      voiceover:
        '“We can export a full repository CSV security report with one click. CodeKitchen delivers intelligent, zero-trust code reviews 24/7. Thank you!”',
      actionCallback: () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setTimeout(() => onExportCsv(), 1000);
      },
    },
  ];

  const currentStep = steps[currentStepIndex] ?? steps[0];

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying) {
      interval = setInterval(() => {
        setAutoTimer((prev) => {
          if (prev <= 1) {
            handleNext();
            return 22;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, currentStepIndex]);

  const handleNext = () => {
    if (currentStepIndex < steps.length - 1) {
      const nextIdx = currentStepIndex + 1;
      setCurrentStepIndex(nextIdx);
      setAutoTimer(22);
      steps[nextIdx]?.actionCallback?.();
    } else {
      setIsPlaying(false);
    }
  };

  const handlePrev = () => {
    if (currentStepIndex > 0) {
      const prevIdx = currentStepIndex - 1;
      setCurrentStepIndex(prevIdx);
      setAutoTimer(22);
      steps[prevIdx]?.actionCallback?.();
    }
  };

  const handleSelectStep = (idx: number) => {
    setCurrentStepIndex(idx);
    setAutoTimer(22);
    steps[idx]?.actionCallback?.();
  };

  if (!isOpen || !currentStep) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 max-w-xl w-[92vw] sm:w-[540px] rounded-2xl border border-amber-500/40 bg-[#16100c]/98 p-5 shadow-2xl backdrop-blur-2xl text-stone-100 shadow-black/90 animate-in fade-in slide-in-from-bottom-5">
      {/* Header Bar */}
      <div className="flex items-center justify-between border-b border-amber-900/40 pb-3 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-600 text-white shadow-md shadow-amber-900/40">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400 font-bold block">
              {currentStep.part}
            </span>
            <h3 className="text-xs font-bold text-white font-mono flex items-center gap-2">
              <span>Step {currentStep.id} of {steps.length}: {currentStep.title}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-500/30">
                {currentStep.timeRange}
              </span>
            </h3>
          </div>
        </div>

        <button
          onClick={onClose}
          className="rounded-lg p-1 text-stone-400 hover:text-white hover:bg-stone-800/60 transition-all"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Screen Action Instructions */}
      <div className="bg-[#1f1712] border border-amber-900/30 rounded-xl p-3 mb-3">
        <span className="text-[10px] font-mono uppercase text-amber-400 font-bold block mb-1">
          🖥️ Screen Action:
        </span>
        <p className="text-xs text-stone-200 leading-relaxed font-sans">
          {currentStep.screenAction}
        </p>
      </div>

      {/* Voiceover Teleprompter Box */}
      <div className="bg-[#120e0b] border border-amber-500/30 rounded-xl p-3 mb-4 shadow-inner">
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-amber-400 font-bold uppercase mb-1">
          <Volume2 className="h-3.5 w-3.5 text-amber-400" />
          <span>🎙️ Voiceover Script (Read this aloud):</span>
        </div>
        <p className="text-xs text-amber-100 font-medium italic leading-relaxed">
          {currentStep.voiceover}
        </p>
      </div>

      {/* Control Bar & Progress */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-amber-900/30">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all shadow-md ${
              isPlaying
                ? 'bg-rose-600 text-white hover:bg-rose-500'
                : 'bg-amber-600 text-white hover:bg-amber-500'
            }`}
          >
            {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            <span>{isPlaying ? `Auto-Advancing (${autoTimer}s)` : 'Auto-Play Demo'}</span>
          </button>

          <button
            onClick={() => {
              setCurrentStepIndex(0);
              setAutoTimer(22);
              steps[0]?.actionCallback?.();
            }}
            className="rounded-lg border border-amber-900/30 bg-[#221913] p-1.5 text-stone-400 hover:text-stone-200 hover:bg-[#2e211a] transition-all"
            title="Restart Tour from Step 1"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handlePrev}
            disabled={currentStepIndex === 0}
            className="flex items-center gap-1 rounded-lg border border-amber-900/30 bg-[#221913] px-2.5 py-1.5 text-xs font-semibold text-stone-300 hover:bg-[#2e211a] disabled:opacity-30 transition-all"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            <span>Prev</span>
          </button>

          <div className="flex items-center gap-1 px-1">
            {steps.map((s, idx) => (
              <button
                key={s.id}
                onClick={() => handleSelectStep(idx)}
                className={`h-2 rounded-full transition-all ${
                  idx === currentStepIndex
                    ? 'w-5 bg-amber-500'
                    : 'w-2 bg-stone-700 hover:bg-stone-500'
                }`}
                title={`Step ${s.id}: ${s.title}`}
              />
            ))}
          </div>

          <button
            onClick={handleNext}
            disabled={currentStepIndex === steps.length - 1}
            className="flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500 disabled:opacity-30 transition-all shadow-md shadow-amber-950/60"
          >
            <span>Next</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
