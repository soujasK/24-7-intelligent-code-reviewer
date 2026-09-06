import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const audioDir = path.join(__dirname, 'audio_temp');
const framesDir = path.join(__dirname, 'frames_temp');
const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

console.log('=======================================================');
console.log('🚀 Starting CodeKitchen Ultra-HD Demo Video Recorder');
console.log('=======================================================');

// 1. Prepare Full Synced Audio Track
console.log('[1/4] Preparing Audio Tracks...');
const audioFiles = [
  'step1.wav', 'step2.wav', 'step3.wav', 'step4.wav',
  'step5.wav', 'step6.wav', 'step7.wav', 'step8.wav'
];

const concatListPath = path.join(audioDir, 'concat_list.txt');
const concatLines = audioFiles.map((f) => `file '${path.join(audioDir, f).replace(/\\/g, '/')}'`).join('\n');
fs.writeFileSync(concatListPath, concatLines, 'utf8');

const fullAudioPath = path.join(audioDir, 'full_audio.wav');
execSync(`"${ffmpegPath}" -y -f concat -safe 0 -i "${concatListPath}" -c copy "${fullAudioPath}"`, { stdio: 'inherit' });

// Clean & prepare frames directory
if (fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });

// 2. Launch Puppeteer Headless Browser
console.log('[2/4] Launching Google Chrome (1920x1080)...');
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: 'new',
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
  args: ['--hide-scrollbars', '--disable-gpu', '--no-sandbox', '--window-size=1920,1080'],
});

const page = await browser.newPage();
console.log('[3/4] Navigating to http://localhost:5173/ ...');
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 2000));

// Inject Sleek Virtual Cursor, Teleprompter Banner, and Visual Effects Overlay
async function injectOverlays() {
  await page.evaluate(() => {
    // Remove old overlays if any
    document.getElementById('video-demo-cursor')?.remove();
    document.getElementById('video-demo-banner')?.remove();

    // 1. Virtual Animated Cursor
    const cursor = document.createElement('div');
    cursor.id = 'video-demo-cursor';
    cursor.innerHTML = `
      <div style="position: relative;">
        <!-- Cursor pointer SVG -->
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style="filter: drop-shadow(0 0 8px rgba(245, 158, 11, 0.9));">
          <path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.88c.45 0 .67-.54.35-.85L5.5 3.21z" fill="#f59e0b" stroke="#ffffff" stroke-width="1.5"/>
        </svg>
        <div id="cursor-ripple" style="position: absolute; top: 0; left: 0; width: 40px; height: 40px; margin: -10px 0 0 -10px; border-radius: 50%; border: 2px solid #f59e0b; opacity: 0; transform: scale(0.2); pointer-events: none; transition: all 0.4s ease-out;"></div>
      </div>
    `;
    cursor.style.position = 'fixed';
    cursor.style.top = '100px';
    cursor.style.left = '100px';
    cursor.style.zIndex = '999999';
    cursor.style.pointerEvents = 'none';
    cursor.style.transition = 'transform 0.08s linear';
    cursor.style.transform = 'translate3d(0, 0, 0)';
    document.body.appendChild(cursor);

    // 2. Teleprompter Bottom Banner
    const banner = document.createElement('div');
    banner.id = 'video-demo-banner';
    banner.style.position = 'fixed';
    banner.style.bottom = '24px';
    banner.style.left = '50%';
    banner.style.transform = 'translateX(-50%)';
    banner.style.zIndex = '999998';
    banner.style.padding = '10px 24px';
    banner.style.borderRadius = '9999px';
    banner.style.background = 'rgba(18, 14, 11, 0.92)';
    banner.style.border = '1px solid rgba(245, 158, 11, 0.4)';
    banner.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.8), 0 0 20px rgba(245, 158, 11, 0.2)';
    banner.style.backdropFilter = 'blur(16px)';
    banner.style.display = 'flex';
    banner.style.alignItems = 'center';
    banner.style.gap = '12px';
    banner.style.fontFamily = 'monospace, ui-monospace, sans-serif';
    banner.style.color = '#fdf8f3';
    banner.style.fontSize = '13px';
    banner.style.fontWeight = 'bold';
    banner.style.pointerEvents = 'none';
    banner.style.transition = 'all 0.3s ease';
    banner.innerHTML = `
      <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #f59e0b; box-shadow: 0 0 10px #f59e0b;"></span>
      <span id="banner-step" style="color: #fbbf24; text-transform: uppercase; letter-spacing: 0.05em;">PART 1</span>
      <span style="color: #78716c;">|</span>
      <span id="banner-text" style="color: #fdf8f3;">CodeKitchen Zero-Trust Mesh</span>
    `;
    document.body.appendChild(banner);

    // Helper functions on window
    window.__setCursorPos = (x, y) => {
      cursor.style.left = `${x}px`;
      cursor.style.top = `${y}px`;
    };

    window.__triggerCursorClick = () => {
      const ripple = document.getElementById('cursor-ripple');
      if (ripple) {
        ripple.style.transition = 'none';
        ripple.style.transform = 'scale(0.2)';
        ripple.style.opacity = '1';
        setTimeout(() => {
          ripple.style.transition = 'all 0.4s ease-out';
          ripple.style.transform = 'scale(1.8)';
          ripple.style.opacity = '0';
        }, 20);
      }
    };

    window.__setBanner = (step, title) => {
      const stepEl = document.getElementById('banner-step');
      const textEl = document.getElementById('banner-text');
      if (stepEl) stepEl.textContent = step;
      if (textEl) textEl.textContent = title;
    };
  });
}

await injectOverlays();

let frameIndex = 0;
const FPS = 4; // 4 high quality keyframes per second

async function capture() {
  const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
  const filename = `frame_${String(frameIndex++).padStart(6, '0')}.jpg`;
  fs.writeFileSync(path.join(framesDir, filename), buf);
}

// Smooth cursor interpolation helper
let curCursorX = 200;
let curCursorY = 150;

async function moveCursorTo(targetX, targetY, steps = 10) {
  const startX = curCursorX;
  const startY = curCursorY;
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    // Ease-in-out curve
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    curCursorX = startX + (targetX - startX) * ease;
    curCursorY = startY + (targetY - startY) * ease;
    await page.evaluate((x, y) => window.__setCursorPos(x, y), curCursorX, curCursorY);
    await capture();
    await new Promise((r) => setTimeout(r, 60));
  }
}

async function clickAt(targetX, targetY) {
  await moveCursorTo(targetX, targetY, 6);
  await page.evaluate(() => window.__triggerCursorClick());
  await capture();
  await capture();
}

async function holdDuration(seconds) {
  const count = Math.round(seconds * FPS);
  for (let i = 0; i < count; i++) {
    await capture();
    await new Promise((r) => setTimeout(r, 60));
  }
}

// ====================================================
// STEP 1: Problem & Standardized Quality Rating (1.0-10.0)
// Duration: 30.19s
// ====================================================
console.log('>>> [Step 1/8] Problem & Standardized Quality Rating (1.0–10.0)...');
await page.evaluate(() => {
  window.__setBanner('STEP 1 OF 8', 'Standardized Code Quality Rating (1.0 - 10.0) & ELO Badge');
  window.scrollTo({ top: 0, behavior: 'instant' });
});

// Move cursor to CodeKitchen header
await moveCursorTo(180, 50, 8);
await holdDuration(3.0);

// Glide to HUD Circular Metrics
await moveCursorTo(960, 230, 10);
await holdDuration(4.0);

// Glide to Quality Score (1.0 - 10.0)
await moveCursorTo(1310, 230, 10);
await clickAt(1310, 230);
await holdDuration(6.0);

// Glide to ELO Rating Metric Card
await moveCursorTo(1450, 230, 10);
await clickAt(1450, 230);
await holdDuration(7.0);

// Hover over Autonomous Swarm Pods
await moveCursorTo(300, 390, 8);
await holdDuration(5.0);

// ====================================================
// STEP 2: Historical Review CSV Ingestion (<id>, <type>, <description>)
// Duration: 23.17s
// ====================================================
console.log('>>> [Step 2/8] Historical Review CSV Ingestion (<id>, <type>, <description>)...');
await page.evaluate(() => {
  window.__setBanner('STEP 2 OF 8', 'CSV Rule Ingestion: <id>, <type>, <description>');
  window.scrollTo({ top: 120, behavior: 'smooth' });
});

// Glide cursor to "Load Sample CSV Rules" button
await moveCursorTo(1330, 190, 10);
await clickAt(1330, 190);

// Trigger Load Sample CSV Rules in app
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('Load Sample CSV Rules'));
  if (btn) btn.click();
});
await holdDuration(3.0);

// Glide cursor to 7 Rules Active badge
await moveCursorTo(300, 190, 10);
await holdDuration(3.0);

// Switch file tabs (main.py -> utils.py)
await page.evaluate(() => window.scrollTo({ top: 380, behavior: 'smooth' }));
await moveCursorTo(410, 480, 8);
await clickAt(410, 480);
await page.evaluate(() => {
  const utilsTab = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('utils.py'));
  if (utilsTab) utilsTab.click();
});
await holdDuration(4.0);

// Highlight security findings on right panel
await moveCursorTo(1200, 520, 10);
await holdDuration(7.0);

// ====================================================
// STEP 3: Interactive AI Chatbot & Growth Timeline
// Duration: 17.83s
// ====================================================
console.log('>>> [Step 3/8] Interactive AI Chatbot & Growth Timeline...');
await page.evaluate(() => {
  window.__setBanner('STEP 3 OF 8', 'Interactive AI Security Assistant & Developer Growth Timeline');
  window.scrollTo({ top: 400, behavior: 'smooth' });
});

// Click "Explain active CSV rules" prompt chip in chatbot
await moveCursorTo(150, 930, 10);
await clickAt(150, 930);
await page.evaluate(() => {
  const chip = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('Explain active CSV rules'));
  if (chip) chip.click();
});
await holdDuration(6.0);

// Scroll up and click "View History" button
await page.evaluate(() => window.scrollTo({ top: 180, behavior: 'smooth' }));
await moveCursorTo(1440, 205, 10);
await clickAt(1440, 205);
await page.evaluate(() => {
  const histBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('View History'));
  if (histBtn) histBtn.click();
});
await holdDuration(6.0);

// ====================================================
// STEP 4: Export CSV Security Audit Report
// Duration: 9.65s
// ====================================================
console.log('>>> [Step 4/8] Export CSV Security Audit Report...');
await page.evaluate(() => {
  // Close history modal if open
  const closeBtn = document.querySelector('[aria-label="Close"], button:has(svg)');
  if (closeBtn) closeBtn.click();
  window.__setBanner('STEP 4 OF 8', 'One-Click Compliance CSV Audit Export');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
await new Promise((r) => setTimeout(r, 400));

// Glide to Export CSV button in top navbar
await moveCursorTo(1470, 50, 10);
await clickAt(1470, 50);
await page.evaluate(() => {
  const expBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('Export CSV'));
  if (expBtn) {
    expBtn.style.transform = 'scale(0.95)';
    expBtn.style.backgroundColor = '#d97706';
    setTimeout(() => { expBtn.style.transform = 'scale(1)'; }, 200);
    expBtn.click();
  }
});
await holdDuration(5.0);

// ====================================================
// STEP 5: Clean State Browser Refresh
// Duration: 7.22s
// ====================================================
console.log('>>> [Step 5/8] Clean State Browser Refresh...');
await page.reload({ waitUntil: 'networkidle2' });
await injectOverlays();
await page.evaluate(() => {
  window.__setBanner('STEP 5 OF 8', 'Zero-Trust Client Ephemeral Sandbox (Zero Leakage)');
  window.scrollTo({ top: 0, behavior: 'instant' });
});

await moveCursorTo(200, 50, 8);
await holdDuration(4.5);

// ====================================================
// STEP 6: GitHub Repo Importer & 5-Agent Swarm
// Duration: 14.04s
// ====================================================
console.log('>>> [Step 6/8] GitHub Repo Importer & 5-Agent Swarm...');
await page.evaluate(() => {
  window.__setBanner('STEP 6 OF 8', 'GitHub Repo Ingestion & 5-Agent Autonomous Swarm');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// Glide to Scan Mesh button
await moveCursorTo(1240, 50, 10);
await clickAt(1240, 50);
await page.evaluate(() => {
  const scanBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('Scan Mesh'));
  if (scanBtn) scanBtn.click();
});
await holdDuration(3.0);

// Glide down to highlight 5 Autonomous Swarm Pods scanning
await page.evaluate(() => window.scrollTo({ top: 320, behavior: 'smooth' }));
await moveCursorTo(150, 390, 8);
await holdDuration(2.0);
await moveCursorTo(450, 390, 8);
await holdDuration(2.0);
await moveCursorTo(750, 390, 8);
await holdDuration(2.0);

// ====================================================
// STEP 7: Interactive Blast Radius Dependency Graph
// Duration: 11.07s
// ====================================================
console.log('>>> [Step 7/8] Interactive Blast Radius Dependency Graph...');
await page.evaluate(() => {
  window.__setBanner('STEP 7 OF 8', 'Interactive AST Blast Radius & Vulnerability Dependency Graph');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
await new Promise((r) => setTimeout(r, 400));

// Click "Blast Radius Graph" tab in navbar
await moveCursorTo(770, 50, 10);
await clickAt(770, 50);
await page.evaluate(() => {
  const graphTab = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('Blast Radius Graph'));
  if (graphTab) graphTab.click();
});
await holdDuration(3.0);

// Interact with D3 Graph Nodes
await page.evaluate(() => window.scrollTo({ top: 120, behavior: 'smooth' }));
await moveCursorTo(960, 450, 10);
await clickAt(960, 450);
await page.evaluate(() => {
  const circles = document.querySelectorAll('svg circle');
  if (circles.length > 2) {
    circles[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }
});
await holdDuration(4.5);

// ====================================================
// STEP 8: Part 2: Repository CSV Export & Closing
// Duration: 12.27s
// ====================================================
console.log('>>> [Step 8/8] Part 2: Repository CSV Export & Closing...');
await page.evaluate(() => {
  window.__setBanner('STEP 8 OF 8', 'Zero-Trust Code Defense Mesh — Built for the Next Generation');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
await new Promise((r) => setTimeout(r, 400));

// Glide to Export CSV button
await moveCursorTo(1470, 50, 10);
await clickAt(1470, 50);
await page.evaluate(() => {
  const expBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('Export CSV'));
  if (expBtn) expBtn.click();
});
await holdDuration(3.0);

// Conclude at CodeKitchen Logo
await moveCursorTo(180, 50, 10);
await holdDuration(5.0);

await browser.close();

// ----------------------------------------------------
// FINAL ENCODING: FFmpeg 1080p MP4 + Synced Audio
// ----------------------------------------------------
console.log(`[4/4] Encoding ${frameIndex} captured 1080p frames with audio track into MP4...`);
const outputMp4Path = path.join(rootDir, 'codekitchen_demo_full.mp4');
const publicMp4Path = path.join(rootDir, 'public', 'codekitchen_demo_full.mp4');

const ffmpegCmd = `"${ffmpegPath}" -y -framerate ${FPS} -i "${path.join(framesDir, 'frame_%06d.jpg')}" -i "${fullAudioPath}" -c:v libx264 -r 30 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest "${outputMp4Path}"`;

execSync(ffmpegCmd, { stdio: 'inherit' });

// Copy to public directory
fs.copyFileSync(outputMp4Path, publicMp4Path);

console.log(`=======================================================`);
console.log(`🎉 Full 3-Minute Video Successfully Generated!`);
console.log(`📁 Saved at: ${outputMp4Path}`);
console.log(`📁 Web Accessible: ${publicMp4Path}`);
console.log(`=======================================================`);
