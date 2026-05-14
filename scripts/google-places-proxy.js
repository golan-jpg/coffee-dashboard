import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const API_KEY = process.env.GOOGLE_PLACES_API_KEY;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ESM __dirname workaround
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Backup user ratings endpoint
app.post('/api/backup-user-ratings', (req, res) => {
  try {
    const ratings = req.body;
    fs.writeFileSync(
      path.join(__dirname, '../src/data/userRatings-backup.json'),
      JSON.stringify(ratings, null, 2),
      'utf8'
    );
    res.status(200).json({ ok: true });
  } catch {
    res.status(400).json({ error: 'Invalid data' });
  }
});

// Proxy endpoint: /api/place-details?place_id=...
app.get('/api/place-details', async (req, res) => {
  const { place_id } = req.query;
  if (!place_id) return res.status(400).json({ error: 'Missing place_id' });
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place_id}&key=${API_KEY}&fields=name,formatted_address,geometry`;
  try {
    const apiRes = await fetch(url);
    const data = await apiRes.json();
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Failed to fetch from Google Places API' });
  }
});

app.listen(PORT, () => {
  console.log(`Google Places proxy running on port ${PORT}`);
});
