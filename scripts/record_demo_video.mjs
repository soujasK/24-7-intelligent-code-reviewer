import { spawn, execSync } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const audioDir = path.join(__dirname, 'audio_temp');
const framesDir = path.join(__dirname, 'frames_temp');

// Clean frames directory
if (fs.existsSync(framesDir)) {
  fs.rmSync(framesDir, { recursive: true, force: true });
}
fs.mkdirSync(framesDir, { recursive: true });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 1. Prepare Concatenated Audio
console.log('[1/4] Preparing Audio Narration...');
const audioFiles = [
  'step1.wav', 'step2.wav', 'step3.wav', 'step4.wav',
  'step5.wav', 'step6.wav', 'step7.wav', 'step8.wav'
];

const concatListPath = path.join(audioDir, 'concat_list.txt');
const concatLines = audioFiles.map((f) => `file '${path.join(audioDir, f).replace(/\\/g, '/')}'`).join('\n');
fs.writeFileSync(concatListPath, concatLines, 'utf8');

const fullAudioPath = path.join(audioDir, 'full_audio.wav');
execSync(`ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c copy "${fullAudioPath}"`, { stdio: 'inherit' });

console.log('[2/4] Launching Headless Chrome Instance (1920x1080)...');
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const chromeProcess = spawn(chromePath, [
  '--remote-debugging-port=9222',
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1920,1080',
  '--force-device-scale-factor=1',
  '--hide-scrollbars',
  'http://localhost:5173/',
]);

await sleep(3000);

// Get WebSocket debugger URL
const versionJson = await new Promise((resolve, reject) => {
  http.get('http://127.0.0.1:9222/json/list', (res) => {
    let data = '';
    res.on('data', (c) => (data += c));
    res.on('end', () => resolve(JSON.parse(data)));
  }).on('error', reject);
});

const targetPage = versionJson.find((p) => p.type === 'page');
if (!targetPage || !targetPage.webSocketDebuggerUrl) {
  throw new Error('No Chrome target page found');
}

console.log('[3/4] Connecting to Chrome DevTools Protocol & Recording Live Demo Frames...');
const ws = new WebSocket(targetPage.webSocketDebuggerUrl);

let msgId = 1;
function sendCdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = msgId++;
    const handler = (data) => {
      const parsed = JSON.parse(data.toString());
      if (parsed.id === id) {
        ws.off('message', handler);
        if (parsed.error) reject(parsed.error);
        else resolve(parsed.result);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await new Promise((resolve) => ws.on('open', resolve));

await sendCdp('Page.enable');
await sendCdp('Runtime.enable');
await sendCdp('DOM.enable');
await sendCdp('Emulation.setDeviceMetricsOverride', {
  width: 1920,
  height: 1080,
  deviceScaleFactor: 1,
  mobile: false,
});

await sleep(2000);

let frameIndex = 0;
const FPS = 4; // 4 high-res frames per second

async function captureFrame() {
  const result = await sendCdp('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
  const frameFileName = `frame_${String(frameIndex++).padStart(6, '0')}.jpg`;
  fs.writeFileSync(path.join(framesDir, frameFileName), Buffer.from(result.data, 'base64'));
}

async function runStepFrames(durationSeconds, onFrameCallback) {
  const totalFrames = Math.round(durationSeconds * FPS);
  for (let i = 0; i < totalFrames; i++) {
    if (onFrameCallback) {
      await onFrameCallback(i, totalFrames);
    }
    await captureFrame();
  }
}

async function evalJs(expr) {
  return sendCdp('Runtime.evaluate', { expression: expr, awaitPromise: true });
}

console.log('Recording Step 1 (0:00 - 0:25): Standardized Quality Rating (1.0-10.0 scale) & ELO Matrix...');
await evalJs(`window.scrollTo({ top: 0, behavior: 'smooth' });`);
await runStepFrames(30.2, async (i) => {
  if (i === 15) {
    await evalJs(`
      const card = document.querySelector('.scanline-effect');
      if (card) card.style.boxShadow = '0 0 45px rgba(245, 158, 11, 0.55)';
    `);
  }
  if (i === 50) {
    await evalJs(`window.scrollTo({ top: 120, behavior: 'smooth' });`);
  }
});

console.log('Recording Step 2 (0:25 - 1:05): Historical Review CSV Ingestion (<id>, <type>, <description>)...');
await evalJs(`window.scrollTo({ top: 280, behavior: 'smooth' });`);
await sleep(300);
// Click Load Sample CSV Rules
await evalJs(`
  const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Load Sample CSV Rules'));
  if (btn) { btn.click(); btn.style.transform = 'scale(0.96)'; setTimeout(() => btn.style.transform = 'scale(1)', 200); }
`);

await runStepFrames(23.2, async (i) => {
  if (i === 30) {
    await evalJs(`window.scrollTo({ top: 380, behavior: 'smooth' });`);
  }
});

console.log('Recording Step 3 (1:05 - 1:30): Interactive AI Chatbot & Growth Timeline...');
await evalJs(`window.scrollTo({ top: 520, behavior: 'smooth' });`);
await sleep(300);
// Click "Explain active CSV rules"
await evalJs(`
  const chip = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Explain active CSV rules'));
  if (chip) chip.click();
`);

await runStepFrames(17.8, async (i) => {
  if (i === 35) {
    // Open session history
    await evalJs(`
      const histBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('View History'));
      if (histBtn) histBtn.click();
    `);
  }
});

console.log('Recording Step 4 (1:30 - 1:45): Export CSV Security Audit Report...');
await evalJs(`window.scrollTo({ top: 0, behavior: 'smooth' });`);
await sleep(300);
await evalJs(`
  const expBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Export CSV'));
  if (expBtn) { expBtn.style.backgroundColor = '#d97706'; expBtn.click(); }
`);
await runStepFrames(9.7);

console.log('Recording Step 5 (1:45 - 1:55): Clean State Session Refresh...');
await sendCdp('Page.reload');
await sleep(2000);
await runStepFrames(7.2);

console.log('Recording Step 6 (1:55 - 2:35): GitHub Repo Importer & 5-Agent Swarm...');
await evalJs(`
  const scanBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Scan Mesh'));
  if (scanBtn) { scanBtn.click(); }
`);
await runStepFrames(14.0, async (i) => {
  if (i === 20) {
    await evalJs(`window.scrollTo({ top: 350, behavior: 'smooth' });`);
  }
});

console.log('Recording Step 7 (2:35 - 2:50): Interactive Blast Radius Dependency Graph...');
await evalJs(`
  const graphTab = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Blast Radius Graph'));
  if (graphTab) graphTab.click();
`);
await sleep(800);
await runStepFrames(11.1, async (i) => {
  if (i === 20) {
    // Click on a node in graph to isolate blast radius
    await evalJs(`
      const circles = document.querySelectorAll('circle');
      if (circles.length > 2) { circles[2].dispatchEvent(new MouseEvent('click', { bubbles: true })); }
    `);
  }
});

console.log('Recording Step 8 (2:50 - 3:00): Final Repository CSV Export & Closing...');
await evalJs(`window.scrollTo({ top: 0, behavior: 'smooth' });`);
await sleep(300);
await evalJs(`
  const expBtn2 = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Export CSV'));
  if (expBtn2) { expBtn2.style.backgroundColor = '#d97706'; expBtn2.click(); }
`);
await runStepFrames(12.3);

// Close Chrome
ws.close();
chromeProcess.kill();

console.log(`[4/4] Encoding ${frameIndex} captured frames into pristine 1080p MP4 with voiceover...`);
const outputMp4Path = path.join(rootDir, 'codekitchen_demo_full.mp4');
const publicMp4Path = path.join(rootDir, 'public', 'codekitchen_demo_full.mp4');

const ffmpegCmd = `ffmpeg -y -framerate ${FPS} -i "${path.join(framesDir, 'frame_%06d.jpg')}" -i "${fullAudioPath}" -c:v libx264 -r 24 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest "${outputMp4Path}"`;

execSync(ffmpegCmd, { stdio: 'inherit' });

// Also copy to public directory
fs.copyFileSync(outputMp4Path, publicMp4Path);

console.log(`=======================================================`);
console.log(`🎉 Full 3-Minute Video Successfully Generated!`);
console.log(`📁 Saved at: ${outputMp4Path}`);
console.log(`=======================================================`);
