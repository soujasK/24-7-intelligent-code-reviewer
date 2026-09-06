import Editor, { type OnMount } from '@monaco-editor/react';
import type { SupportedLanguage } from '../../types/ast';

export interface MonacoEditorProps {
  value: string;
  language: SupportedLanguage;
  onChange: (value: string) => void;
  height?: string;
  readOnly?: boolean;
}

export function MonacoEditor({ value, language, onChange, height = '360px', readOnly = false }: MonacoEditorProps): JSX.Element {
  const handleMount: OnMount = (editor) => {
    editor.updateOptions({ minimap: { enabled: false }, fontSize: 13, readOnly });
  };

  return (
    <Editor
      height={height}
      language={language}
      theme="vs-dark"
      value={value}
      onChange={(next) => onChange(next ?? '')}
      onMount={handleMount}
      options={{ automaticLayout: true, scrollBeyondLastLine: false }}
    />
  );
}
