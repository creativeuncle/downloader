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

// Detect platform from URL
function detectPlatform(url) {
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('instagram.com')) return 'instagram';
  if (url.includes('tiktok.com')) return 'tiktok';
  if (url.includes('snapchat.com')) return 'snapchat';
  if (url.includes('twitter.com') || url.includes('x.com')) return 'twitter';
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

// YouTube's "web" client now requires a PO token that cookies alone don't satisfy,
// triggering "Sign in to confirm you're not a bot" even with valid cookies. The
// android client skips that check.
function platformArgs(platform) {
  if (platform === 'youtube') {
    return ['--extractor-args', 'youtube:player_client=android,web'];
  }
  return [];
}

// ─── INFO ROUTE ───────────────────────────────────────────────────────────────
app.post('/api/info', (req, res) => {
  const { url } = req.body;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }

  const platform = detectPlatform(url);
  if (platform === 'unknown') {
    return res.status(400).json({ error: 'Only YouTube, Instagram, TikTok, Snapchat, and Twitter/X URLs are supported' });
  }

  if (platform === 'snapchat' && !isPublicSnapchat(url)) {
    return res.status(400).json({
      error: 'Only Snapchat Spotlight & public Stories can be downloaded. Private snaps/DMs are not supported.'
    });
  }

  const args = ['--dump-json', '--no-playlist', '--no-warnings', ...cookieArgs(), ...platformArgs(platform)];

  args.push(url);

  const proc = spawn('yt-dlp', args);
  let stdout = '';
  let stderr = '';
  let responded = false;

  const timeoutId = setTimeout(() => {
    if (!responded) {
      responded = true;
      proc.kill('SIGKILL');
      res.status(504).json({ error: 'Timed out fetching video info. Please try again.' });
    }
  }, 60000);

  proc.stdout.on('data', d => { stdout += d.toString(); });
  proc.stderr.on('data', d => { stderr += d.toString(); });

  proc.on('close', (code) => {
    clearTimeout(timeoutId);
    if (responded) return;
    responded = true;

    if (code !== 0) {
      console.error('yt-dlp info error:', stderr);
      if (platform === 'snapchat') {
        return res.status(500).json({ error: 'Could not fetch Snapchat video. Make sure it is a public Spotlight or Story link.' });
      }
      return res.status(500).json({ error: 'Could not fetch video info. Check the URL and try again.' });
    }

    try {
      const info = JSON.parse(stdout);
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
});

// ─── DOWNLOAD ROUTE ───────────────────────────────────────────────────────────
// Waits for yt-dlp to finish (needed for ffmpeg merge), then streams file to browser.
// Content-Length header is set so browser shows real download progress.
app.post('/api/download', (req, res) => {
  const { url, format_id, type } = req.body;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

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

  const args = [
    '-f', formatArg,
    '--no-playlist',
    '--no-warnings',
    '--merge-output-format', 'mp4',
    '--postprocessor-args', 'ffmpeg:-movflags +faststart',
    '-o', outputTemplate,
    ...cookieArgs(),
    ...platformArgs(detectPlatform(url)),
  ];

  if (isAudio) {
    args.push('--extract-audio', '--audio-format', 'mp3');
  }

  args.push(url);

  console.log(`[Download] ${url} | Format: ${formatArg}`);

  const proc = spawn('yt-dlp', args);
  let stderr = '';
  let responded = false;

  // 10 minute timeout — enough for large 4K videos
  const timeoutId = setTimeout(() => {
    if (!responded) {
      responded = true;
      proc.kill('SIGKILL');
      console.error('Timeout:', url);
      if (!res.headersSent) {
        res.status(504).json({ error: 'Download timed out (10 min). Try a lower quality.' });
      }
    }
  }, 600000);

  proc.stderr.on('data', d => { stderr += d.toString(); });

  proc.on('close', (code) => {
    clearTimeout(timeoutId);
    if (responded) return;
    responded = true;

    if (code !== 0) {
      console.error('Download failed:', stderr);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Download failed. Try a different quality or check the URL.' });
      }
      return;
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
