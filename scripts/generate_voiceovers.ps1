# PowerShell Script to generate voiceover audio files for all 8 hackathon demo steps
Add-Type -AssemblyName System.Speech

$voiceovers = @(
    @{
        File = "step1.wav"
        Text = "Welcome to CodeKitchen, an automated, 24/7 intelligent code reviewer built for the next generation of engineers. Traditional code reviewers send your private source code to external servers. CodeKitchen solves this with a zero-trust architecture: parsing ASTs and executing DuckDB SQL queries 100 percent inside your browser via WebAssembly, generating a Standardized Code Quality Rating on a scale of 1.0 to 10.0."
    },
    @{
        File = "step2.wav"
        Text = "CodeKitchen is built to ingest and learn from historical review datasets. By uploading a CSV file formatted as ID, Type, and Description, our CSV to AST Policy Compiler dynamically converts natural language guidelines into executable DuckDB SQL rules, instantly re-evaluating your code against your team's historical guidelines."
    },
    @{
        File = "step3.wav"
        Text = "Developers can ask our AI Chatbot Assistant powered by Gemini 2.5 Flash about active CSV rules and security findings. User evaluation sessions are also saved persistently to Firebase Firestore so developer growth and quality ratings can be tracked over time."
    },
    @{
        File = "step4.wav"
        Text = "At any point, developers can click Export CSV to download a complete, structured security audit report of their single-file evaluations."
    },
    @{
        File = "step5.wav"
        Text = "Now, let's refresh our browser to start a clean repository evaluation session with zero state friction."
    },
    @{
        File = "step6.wav"
        Text = "CodeKitchen securely imports full public and private GitHub repositories using OAuth tokens. Our zero-trust 5-Agent Swarm evaluates full codebases in parallel using client-side WebAssembly Web Workers."
    },
    @{
        File = "step7.wav"
        Text = "To prevent cross-file breaking changes, we construct an interactive Blast Radius Graph visualizing function call coupling and dependency risks across the entire repository."
    },
    @{
        File = "step8.wav"
        Text = "We can export a full repository CSV security report with one click. CodeKitchen delivers intelligent, zero-trust code reviews 24/7. Thank you!"
    }
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$tempAudioDir = Join-Path $scriptDir "audio_temp"
if (-not (Test-Path $tempAudioDir)) {
    New-Item -ItemType Directory -Path $tempAudioDir | Out-Null
}

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = 0
$synth.Volume = 100

foreach ($item in $voiceovers) {
    $outPath = Join-Path $tempAudioDir $item.File
    $synth.SetOutputToWaveFile($outPath)
    $synth.Speak($item.Text)
    Write-Host "Generated $($item.File)"
}

$synth.Dispose()
Write-Host "All voiceover tracks generated successfully in $tempAudioDir"
