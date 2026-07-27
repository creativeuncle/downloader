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
function runYtDlp(args, timeoutMs) {
  return new Promise((resolve) => {
    const proc = spawn('yt-dlp', args);
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill('SIGKILL');
        resolve({ code: null, stdout, stderr, timedOut: true });
      }
    }, timeoutMs);

    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      if (settled) return;
      settled = true;
      resolve({ code, stdout, stderr, timedOut: false });
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

// ─── DOWNLOAD ROUTE ───────────────────────────────────────────────────────────
// Waits for yt-dlp to finish (needed for ffmpeg merge), then streams file to browser.
// Content-Length header is set so browser shows real download progress.
app.post('/api/download', async (req, res) => {
  const { url, format_id, type } = req.body;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const platform = detectPlatform(url);
  const isAudio = type === 'audio';
  const timestamp = Date.now();
  // Use %(ext)s so yt-dlp sets the real extension after merge
  const outputTemplate = path.join(TEMP_DIR, `vid_${timestamp}.%(ext)s`);

  let formatArg;
  if (isAudio) {
    formatArg = 'bestaudio';
  } else {
    // /best as ultimate fallback
    formatArg = format_id ? `${format_id}/best` : 'bestvideo+bestaudio/best';
  }

  function buildArgs(clientArgs) {
    const args = [
      '-f', formatArg,
      '--no-playlist',
      '--no-warnings',
      '--merge-output-format', 'mp4',
      '-o', outputTemplate,
      ...cookieArgs(),
      ...clientArgs,
    ];

    // Some sources (Instagram in particular) can serve VP9/Opus streams. Those
    // remux into a technically-valid .mp4 that most players handle fine, but
    // Apple's Photos framework rejects it outright (PHPhotosErrorDomain 3302)
    // since it only accepts H.264/HEVC video + AAC audio. Force a re-encode to
    // that combination for video downloads so "Save to Photos" always works.
    if (!isAudio) {
      // Render sets RENDER=true automatically. Its free instance has ~512MB RAM,
      // which the default libx264 preset at full resolution OOM-crashes the
      // whole process — so only cap resolution/speed up there. Local/other
      // hosts have real CPU/RAM, so keep full quality with a normal preset.
      const ffmpegArgs = process.env.RENDER
        ? '-c:v libx264 -preset ultrafast -crf 26 -vf scale=-2:min(720\\,ih) -c:a aac -b:a 128k -movflags +faststart'
        : '-c:v libx264 -preset medium -crf 20 -c:a aac -b:a 192k -movflags +faststart';
      args.push('--recode-video', 'mp4', '--postprocessor-args', `ffmpeg:${ffmpegArgs}`);
    } else {
      args.push('--postprocessor-args', 'ffmpeg:-movflags +faststart', '--extract-audio', '--audio-format', 'mp3');
    }

    args.push(url);
    return args;
  }

  console.log(`[Download] ${url} | Format: ${formatArg}`);

  let result = await runYtDlp(buildArgs([]), 3600000);

  if (platform === 'youtube' && result.code !== 0 && !result.timedOut && BOT_CHECK_RE.test(result.stderr)) {
    console.log('[YouTube] web client blocked, retrying download with android/tv client');
    result = await runYtDlp(buildArgs(YOUTUBE_FALLBACK_ARGS), 3600000);
  }

  if (result.timedOut) {
    console.error('Timeout:', url);
    return res.status(504).json({ error: 'Download timed out (60 min). Try a lower quality.' });
  }

  if (result.code !== 0) {
    console.error('Download failed:', result.stderr);
    return res.status(500).json({ error: 'Download failed. Try a different quality or check the URL.' });
  }

  // Find actual output file (extension may differ)
  const files = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(`vid_${timestamp}`));
  if (!files.length) {
    return res.status(500).json({ error: 'Output file not found after download.' });
  }

  const actualFile = path.join(TEMP_DIR, files[0]);
  const actualExt = path.extname(actualFile).slice(1) || (isAudio ? 'mp3' : 'mp4');
  const fileSize  = fs.statSync(actualFile).size;

  console.log(`[Send] ${actualFile} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);

  // Content-Length lets browser show real download progress bar
  res.setHeader('Content-Disposition', `attachment; filename="vidsnatch_${timestamp}.${actualExt}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', fileSize);
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const stream = fs.createReadStream(actualFile);
  stream.pipe(res);
  stream.on('end',   () => fs.unlink(actualFile, () => {}));
  stream.on('error', () => fs.unlink(actualFile, () => {}));
});

// Cleanup temp files older than 2 hours
setInterval(() => {
  const now = Date.now();
  fs.readdirSync(TEMP_DIR).forEach(file => {
    const fp = path.join(TEMP_DIR, file);
    try {
      if (now - fs.statSync(fp).mtimeMs > 7200000) fs.unlink(fp, () => {});
    } catch {}
  });
}, 3600000);

app.listen(PORT, () => {
  console.log(`✅ VidSnatch running at http://localhost:${PORT}`);
});
