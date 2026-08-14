const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Temp folder for downloads
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

// Detect platform from URL's hostname (not a raw substring match — "x.com" as
// a substring would false-positive on unrelated domains like netflix.com).
function detectPlatform(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'unknown';
  }

  const isHost = (...domains) => domains.some(d => hostname === d || hostname.endsWith('.' + d));

  if (isHost('youtube.com', 'youtu.be')) return 'youtube';
  if (isHost('instagram.com')) return 'instagram';
  if (isHost('tiktok.com')) return 'tiktok';
  if (isHost('snapchat.com')) return 'snapchat';
  if (isHost('twitter.com', 'x.com')) return 'twitter';
  if (isHost('facebook.com', 'fb.watch')) return 'facebook';
  return 'unknown';
}

// Snapchat public content check
function isPublicSnapchat(url) {
  return (
    url.includes('/spotlight/') ||
    url.includes('/p/') ||
    url.includes('story.snapchat.com') ||
    url.includes('www.snapchat.com/p/') ||
    url.includes('www.snapchat.com/spotlight/')
  );
}

// Validate URL
function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// Optional cookies.txt (Netscape format) for platforms that need auth/bot-check bypass
// (YouTube "Sign in to confirm you're not a bot", Instagram private content, etc).
// Set via Render Secret File, not committed to git. Secret Files mount read-only,
// but yt-dlp rewrites the cookie jar after each run (refreshed session tokens), so
// the source is copied into a writable file on boot and that copy is what's used.
const SOURCE_COOKIES_FILE = process.env.COOKIES_FILE || path.join(__dirname, 'cookies.txt');
const WRITABLE_COOKIES_FILE = path.join(TEMP_DIR, 'cookies.txt');
if (fs.existsSync(SOURCE_COOKIES_FILE)) {
  fs.copyFileSync(SOURCE_COOKIES_FILE, WRITABLE_COOKIES_FILE);
  const stat = fs.statSync(WRITABLE_COOKIES_FILE);
  const cookieCount = fs.readFileSync(WRITABLE_COOKIES_FILE, 'utf8')
    .split('\n').filter(l => l && !l.startsWith('#')).length;
  console.log(`[Cookies] Loaded ${SOURCE_COOKIES_FILE} -> ${WRITABLE_COOKIES_FILE} (${stat.size} bytes, ${cookieCount} cookie lines)`);
} else {
  console.log(`[Cookies] No cookies file found at ${SOURCE_COOKIES_FILE} — running without cookies`);
}

function cookieArgs() {
  return fs.existsSync(WRITABLE_COOKIES_FILE) ? ['--cookies', WRITABLE_COOKIES_FILE] : [];
}

// YouTube's "web" client (used with cookies) sometimes gets blocked with
// "Sign in to confirm you're not a bot" — usually an IP-reputation thing
// (common on cloud/datacenter hosts, rare on a home connection). The
// android/tv clients skip that check entirely but only expose a limited
// format list, so this is used as a fallback, not the default.
const YOUTUBE_FALLBACK_ARGS = ['--extractor-args', 'youtube:player_client=android,tv'];
const BOT_CHECK_RE = /Sign in to confirm/i;

// Runs yt-dlp and resolves with its exit code + captured output instead of
// using callbacks, so routes can await a first attempt and retry with
// different args before deciding how to respond.
function runYtDlp(args, timeoutMs, onDownloadPercent) {
  return new Promise((resolve) => {
    const proc = spawn('yt-dlp', args);
    let stdout = '';
    let stderr = '';
    let settled = false;
    let buffer = '';

    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill('SIGKILL');
        resolve({ code: null, stdout, stderr, timedOut: true });
      }
    }, timeoutMs);

    proc.stdout.on('data', d => {
      const text = d.toString();
      stdout += text;
      if (onDownloadPercent) {
        // --newline makes yt-dlp emit one progress line per update instead of
        // overwriting with \r, so this is safe to parse line by line.
        buffer += text;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          const m = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
          if (m) onDownloadPercent(parseFloat(m[1]));
        }
      }
    });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      if (settled) return;
      settled = true;
      resolve({ code, stdout, stderr, timedOut: false });
    });

    // Without this, a spawn failure (e.g. yt-dlp not on PATH) throws an
    // unhandled 'error' event and crashes the entire Node process — not just
    // this one request. Resolve with a non-zero code instead so the route
    // can respond with an error like any other failure.
    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      if (settled) return;
      settled = true;
      resolve({ code: -1, stdout, stderr: stderr + '\n' + err.message, timedOut: false });
    });
  });
}

// ─── INFO ROUTE ───────────────────────────────────────────────────────────────
app.post('/api/info', async (req, res) => {
  const { url } = req.body;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }

  const platform = detectPlatform(url);
  if (platform === 'unknown') {
    return res.status(400).json({ error: 'Only YouTube, Instagram, TikTok, Snapchat, Twitter/X, and Facebook URLs are supported' });
  }

  if (platform === 'snapchat' && !isPublicSnapchat(url)) {
    return res.status(400).json({
      error: 'Only Snapchat Spotlight & public Stories can be downloaded. Private snaps/DMs are not supported.'
    });
  }

  let result = await runYtDlp(['--dump-json', '--no-playlist', '--no-warnings', ...cookieArgs(), url], 60000);

  if (platform === 'youtube' && result.code !== 0 && !result.timedOut && BOT_CHECK_RE.test(result.stderr)) {
    console.log('[YouTube] web client blocked, retrying with android/tv client');
    result = await runYtDlp(
      ['--dump-json', '--no-playlist', '--no-warnings', ...YOUTUBE_FALLBACK_ARGS, url],
      60000
    );
  }

  if (result.timedOut) {
    return res.status(504).json({ error: 'Timed out fetching video info. Please try again.' });
  }

  if (result.code !== 0) {
    console.error('yt-dlp info error:', result.stderr);
    if (platform === 'snapchat') {
      return res.status(500).json({ error: 'Could not fetch Snapchat video. Make sure it is a public Spotlight or Story link.' });
    }
    return res.status(500).json({ error: 'Could not fetch video info. Check the URL and try again.' });
  }

  try {
    const info = JSON.parse(result.stdout);
    const formats = [];

    // Collect all video streams, sort by quality score
    const videoStreams = (info.formats || []).filter(f => f.vcodec && f.vcodec !== 'none');

    const sorted = [...videoStreams].sort((a, b) => {
      const aScore = (a.height || 0) * 10000 + (a.tbr || 0);
      const bScore = (b.height || 0) * 10000 + (b.tbr || 0);
      return bScore - aScore;
    });

    // Deduplicate by height (or bitrate bucket for HLS)
    const seen = new Set();
    const unique = [];
    sorted.forEach(f => {
      const key = f.height || Math.round((f.tbr || 0) / 200);
      if (key && !seen.has(key)) {
        seen.add(key);
        unique.push(f);
      }
    });

    // Always put "Best Quality Auto" first — most reliable
    formats.push({
      label: '🔥 Best Quality (Auto)',
      format_id: 'bestvideo+bestaudio/best',
      type: 'video'
    });

    // Add detected quality options
    unique.slice(0, 5).forEach((f, idx) => {
      const height = f.height;
      const label = height
        ? (height >= 2160 ? `4K (${height}p) MP4` : `${height}p MP4`)
        : (idx === 0 ? 'Best Quality MP4' : `Quality ${idx + 1} MP4`);
      const badge = height >= 2160 ? '🔥 ' : height >= 1080 ? '⚡ ' : '';

      // video-only streams need +bestaudio; progressive streams (with audio) use as-is
      const hasAudio = f.acodec && f.acodec !== 'none';
      const fmtSelector = hasAudio ? f.format_id : `${f.format_id}+bestaudio`;

      formats.push({ label: badge + label, format_id: fmtSelector, type: 'video' });
    });

    // Fallback options if no streams detected
    if (unique.length === 0) {
      formats.push({ label: '⚡ 1080p MP4', format_id: 'bestvideo[height<=1080]+bestaudio/best[height<=1080]', type: 'video' });
      formats.push({ label: '720p MP4',  format_id: 'bestvideo[height<=720]+bestaudio/best[height<=720]',   type: 'video' });
      formats.push({ label: '480p MP4',  format_id: 'bestvideo[height<=480]+bestaudio/best[height<=480]',   type: 'video' });
    }

    formats.push({ label: '🎵 Audio Only (MP3)', format_id: 'bestaudio', type: 'audio' });

    res.json({
      title: info.title || 'Video',
      thumbnail: info.thumbnail || '',
      duration: info.duration_string || '',
      platform,
      uploader: info.uploader || info.channel || '',
      formats
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to parse video information.' });
  }
});

// ─── DOWNLOAD CORE ─────────────────────────────────────────────────────────────
// Shared by the legacy single-request /api/download and the job-based
// /api/download/start + SSE progress flow. Fetches the source (yt-dlp),
// then re-encodes to a Photos/QuickTime-friendly H.264/AAC file (ffmpeg),
// reporting phase + percent via onProgress as it goes.

function ffprobeDuration(filePath) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath]);
    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.on('close', () => {
      const val = parseFloat(out.trim());
      resolve(Number.isFinite(val) && val > 0 ? val : 0);
    });
    proc.on('error', () => resolve(0));
  });
}

function encodeFile(inputFile, outputFile, isAudio, onPercent) {
  return new Promise(async (resolve, reject) => {
    const durationSec = await ffprobeDuration(inputFile);

    const args = ['-y', '-i', inputFile];
    if (isAudio) {
      args.push('-vn', '-c:a', 'libmp3lame', '-b:a', '192k');
    } else {
      // Render sets RENDER=true automatically. Its free instance has ~512MB RAM,
      // which the default libx264 preset at full resolution OOM-crashes the
      // whole process — so only cap resolution/speed up there. Local/other
      // hosts have real CPU/RAM, so keep full quality with a normal preset.
      if (process.env.RENDER) {
        args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26', '-vf', 'scale=-2:min(720,ih)');
      } else {
        args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20');
      }
      args.push('-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart');
    }
    args.push('-progress', 'pipe:1', '-nostats', outputFile);

    const proc = spawn('ffmpeg', args);
    let stderr = '';
    let buffer = '';

    proc.stdout.on('data', d => {
      buffer += d.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const m = line.match(/^out_time=(\d+):(\d+):([\d.]+)/);
        if (m && durationSec > 0) {
          const seconds = parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
          onPercent(Math.min(99, (seconds / durationSec) * 100));
        }
      }
    });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('Encoding failed. ' + stderr.slice(-300)));
    });
    proc.on('error', reject);
  });
}

async function performDownload(url, formatId, type, onProgress = () => {}, options = {}) {
  // Re-encoding to H.264/AAC is only needed so iOS's Photos framework will
  // accept the file (see PHPhotosErrorDomain 3302 above) — the mobile/iOS
  // apps need it, but a browser/desktop download doesn't, so skip it there
  // to save real time. Audio still always gets converted since "MP3" is
  // what's promised in the UI, not whatever codec the source served.
  const { encode = true } = options;
  const platform = detectPlatform(url);
  const isAudio = type === 'audio';
  const jobTag = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const rawTemplate = path.join(TEMP_DIR, `raw_${jobTag}.%(ext)s`);
  const formatArg = isAudio ? 'bestaudio' : (formatId ? `${formatId}/best` : 'bestvideo+bestaudio/best');

  function buildFetchArgs(clientArgs) {
    return [
      '-f', formatArg,
      '--no-playlist',
      '--no-warnings',
      '--newline',
      '--merge-output-format', 'mp4',
      '-o', rawTemplate,
      ...cookieArgs(),
      ...clientArgs,
      url,
    ];
  }

  onProgress('downloading', 0);
  let result = await runYtDlp(buildFetchArgs([]), 3600000, (pct) => onProgress('downloading', pct));

  if (platform === 'youtube' && result.code !== 0 && !result.timedOut && BOT_CHECK_RE.test(result.stderr)) {
    console.log('[YouTube] web client blocked, retrying download with android/tv client');
    result = await runYtDlp(buildFetchArgs(YOUTUBE_FALLBACK_ARGS), 3600000, (pct) => onProgress('downloading', pct));
  }

  if (result.timedOut) {
    throw new Error('Download timed out (60 min). Try a lower quality.');
  }
  if (result.code !== 0) {
    console.error('Download failed:', result.stderr);
    throw new Error('Download failed. Try a different quality or check the URL.');
  }

  const rawFiles = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(`raw_${jobTag}`));
  if (!rawFiles.length) {
    throw new Error('Output file not found after download.');
  }
  const rawFile = path.join(TEMP_DIR, rawFiles[0]);

  if (!isAudio && !encode) {
    const rawExt = path.extname(rawFile).slice(1) || 'mp4';
    const finalFile = path.join(TEMP_DIR, `vid_${jobTag}.${rawExt}`);
    fs.renameSync(rawFile, finalFile);
    onProgress('done', 100);
    return { filePath: finalFile, fileName: `vidsnatch_${jobTag}.${rawExt}` };
  }

  const finalExt = isAudio ? 'mp3' : 'mp4';
  const finalFile = path.join(TEMP_DIR, `vid_${jobTag}.${finalExt}`);

  onProgress('encoding', 0);
  try {
    await encodeFile(rawFile, finalFile, isAudio, (pct) => onProgress('encoding', pct));
  } finally {
    fs.unlink(rawFile, () => {});
  }

  return { filePath: finalFile, fileName: `vidsnatch_${jobTag}.${finalExt}` };
}

function sendFile(res, filePath, fileName) {
  const fileSize = fs.statSync(filePath).size;
  console.log(`[Send] ${filePath} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);

  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', fileSize);
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
  stream.on('end', () => fs.unlink(filePath, () => {}));
  stream.on('error', () => fs.unlink(filePath, () => {}));
}

// ─── LEGACY DOWNLOAD ROUTE ─────────────────────────────────────────────────────
// Single request/response, used by the mobile (React Native) and iOS apps.
// No live progress — the client only sees bytes once this responds.
app.post('/api/download', async (req, res) => {
  const { url, format_id, type } = req.body;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  console.log(`[Download] ${url} | format_id=${format_id || '(default)'} type=${type || 'video'}`);

  try {
    const { filePath, fileName } = await performDownload(url, format_id, type);
    sendFile(res, filePath, fileName);
  } catch (err) {
    const status = /timed out/i.test(err.message) ? 504 : 500;
    res.status(status).json({ error: err.message });
  }
});

// ─── JOB-BASED DOWNLOAD + LIVE PROGRESS ────────────────────────────────────────
// Used by the web UI: start a job, watch its progress over SSE, then fetch the
// finished file — so the frontend can show a real percentage while yt-dlp is
// still fetching/encoding, not just once the file starts streaming.
const jobs = new Map();

app.post('/api/download/start', (req, res) => {
  const { url, format_id, type } = req.body;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const job = { status: 'downloading', phase: 'downloading', percent: 0, error: null, filePath: null, fileName: null, createdAt: Date.now() };
  jobs.set(jobId, job);

  console.log(`[Download] ${url} | format_id=${format_id || '(default)'} type=${type || 'video'} | job=${jobId}`);

  performDownload(url, format_id, type, (phase, percent) => {
    job.status = phase;
    job.phase = phase;
    job.percent = percent;
  }, { encode: false }).then(({ filePath, fileName }) => {
    job.status = 'done';
    job.phase = 'done';
    job.percent = 100;
    job.filePath = filePath;
    job.fileName = fileName;
  }).catch((err) => {
    job.status = 'error';
    job.error = err.message || 'Download failed';
  });

  res.json({ jobId });
});

app.get('/api/download/progress/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Unknown job' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const send = () => {
    res.write(`data: ${JSON.stringify({
      status: job.status,
      phase: job.phase,
      percent: Math.round(job.percent || 0),
      error: job.error,
    })}\n\n`);
  };

  send();
  const interval = setInterval(() => {
    send();
    if (job.status === 'done' || job.status === 'error') {
      clearInterval(interval);
      res.end();
    }
  }, 400);

  req.on('close', () => clearInterval(interval));
});

app.get('/api/download/file/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== 'done' || !job.filePath) {
    return res.status(404).json({ error: 'File not ready' });
  }

  sendFile(res, job.filePath, job.fileName);
  jobs.delete(req.params.jobId);
});

// Cleanup temp files older than 2 hours, and stale/abandoned jobs
setInterval(() => {
  const now = Date.now();
  fs.readdirSync(TEMP_DIR).forEach(file => {
    const fp = path.join(TEMP_DIR, file);
    try {
      if (now - fs.statSync(fp).mtimeMs > 7200000) fs.unlink(fp, () => {});
    } catch {}
  });
  for (const [jobId, job] of jobs) {
    if (now - job.createdAt > 7200000) jobs.delete(jobId);
  }
}, 3600000);

app.listen(PORT, () => {
  console.log(`✅ VidSnatch running at http://localhost:${PORT}`);
});
