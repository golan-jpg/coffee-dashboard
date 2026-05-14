// Simple Express endpoint to save user ratings backup
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

router.post('/api/backup-user-ratings', (req, res) => {
  let data = '';
  req.on('data', chunk => { data += chunk; });
  req.on('end', () => {
    try {
      const ratings = JSON.parse(data);
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
});

module.exports = router;
