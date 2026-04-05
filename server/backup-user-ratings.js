// server/backup-user-ratings.js
// Express server to receive userRatings and auto-sync specialtyScore
import express from 'express';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3030;

app.use(express.json({ limit: '2mb' }));

function readRatingsFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function mergeRatings(existing, incoming) {
  const merged = { ...(existing || {}) };
  Object.entries(incoming || {}).forEach(([id, value]) => {
    const current = Number(merged[id] || 0);
    const next = Number(value || 0);
    if (next > current) {
      merged[id] = next;
    }
  });
  return merged;
}

function readHiddenIdsFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function uniqueIds(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
}

app.get('/api/backup-user-ratings', (_req, res) => {
  try {
    const ratingsPath = path.resolve('userRatings.json');
    const backupPath = path.resolve('src/data/userRatings-backup.json');
    const primary = readRatingsFile(ratingsPath);
    const fallback = readRatingsFile(backupPath);
    const ratings = mergeRatings(fallback, primary);

    res.json({ ok: true, ratings });
  } catch (error) {
    console.error('get backup-user-ratings failed:', error);
    res.status(500).json({ ok: false, error: 'Failed reading ratings backup' });
  }
});

app.post('/api/backup-user-ratings', (req, res) => {
  try {
    const incoming = req.body && typeof req.body === 'object' ? req.body : {};
    const ratingsPath = path.resolve('userRatings.json');
    const backupPath = path.resolve('src/data/userRatings-backup.json');

    const existing = mergeRatings(readRatingsFile(backupPath), readRatingsFile(ratingsPath));
    const merged = mergeRatings(existing, incoming);

    fs.writeFileSync(ratingsPath, JSON.stringify(merged, null, 2), 'utf8');
    fs.writeFileSync(backupPath, JSON.stringify(merged, null, 2), 'utf8');

    res.json({ ok: true, message: 'Ratings saved.', count: Object.keys(merged).length });
  } catch (error) {
    console.error('backup-user-ratings failed:', error);
    res.status(500).json({ ok: false, error: 'Failed saving ratings backup' });
  }
});

app.get('/api/backup-hidden-place-ids', (_req, res) => {
  try {
    const hiddenPath = path.resolve('hiddenPlaceIds.json');
    const backupPath = path.resolve('src/data/hiddenPlaceIds-backup.json');
    const ids = uniqueIds([...readHiddenIdsFile(hiddenPath), ...readHiddenIdsFile(backupPath)]);

    res.json({ ok: true, hiddenPlaceIds: ids });
  } catch (error) {
    console.error('get backup-hidden-place-ids failed:', error);
    res.status(500).json({ ok: false, error: 'Failed reading hidden-place-ids backup' });
  }
});

app.post('/api/backup-hidden-place-ids', (req, res) => {
  try {
    const incoming = uniqueIds(req.body);
    const hiddenPath = path.resolve('hiddenPlaceIds.json');
    const backupPath = path.resolve('src/data/hiddenPlaceIds-backup.json');

    fs.writeFileSync(hiddenPath, JSON.stringify(incoming, null, 2), 'utf8');
    fs.writeFileSync(backupPath, JSON.stringify(incoming, null, 2), 'utf8');

    res.json({ ok: true, message: 'Hidden place IDs saved.', count: incoming.length });
  } catch (error) {
    console.error('backup-hidden-place-ids failed:', error);
    res.status(500).json({ ok: false, error: 'Failed saving hidden-place-ids backup' });
  }
});

app.post('/api/report-error', (req, res) => {
  try {
    const errorPayload = {
      ts: new Date().toISOString(),
      ...req.body,
    };
    const logsPath = path.resolve('debug/runtime-errors.log');
    fs.appendFileSync(logsPath, `${JSON.stringify(errorPayload)}\n`, 'utf8');
    res.json({ ok: true });
  } catch (error) {
    console.error('report-error failed:', error);
    res.status(500).json({ ok: false, error: 'Failed writing error log' });
  }
});

app.get('/api/reverse-geocode', async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'Invalid lat/lon' });
  }

  try {
    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=18&addressdetails=0`;
    const response = await fetch(nominatimUrl, {
      headers: {
        'Accept-Language': 'en',
        'User-Agent': 'coffee-dashboard/1.0 (local-dev)',
      },
    });

    if (!response.ok) {
      return res.json({ display_name: '' });
    }

    const payload = await response.json();
    res.json(payload);
  } catch (error) {
    console.error('reverse-geocode failed:', error);
    res.json({ display_name: '' });
  }
});

app.listen(PORT, () => {
  console.log(`Backup server running on http://localhost:${PORT}`);
});
