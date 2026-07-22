const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Database Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Middleware
app.use(express.json());
app.use(cors());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('dev'));
app.use(express.static('public'));

// =========================================================================
// 1. GEOFENCING & RANK CONFIGURATION
// =========================================================================

const HARARE_RANKS = [
  { name: 'Copacabana Rank', lat: -17.8315, lng: 31.0425, radiusMeters: 150 },
  { name: 'Fourth Street Rank', lat: -17.8319, lng: 31.0558, radiusMeters: 150 },
  { name: 'Market Square Rank', lat: -17.8358, lng: 31.0381, radiusMeters: 150 }
];

function getDistanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const rad1 = lat1 * Math.PI / 180;
  const rad2 = lat2 * Math.PI / 180;
  const deltaLat = (lat2 - lat1) * Math.PI / 180;
  const deltaLon = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
            Math.cos(rad1) * Math.cos(rad2) *
            Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function checkRankGeofence(latitude, longitude) {
  for (const rank of HARARE_RANKS) {
    const distance = getDistanceInMeters(latitude, longitude, rank.lat, rank.lng);
    if (distance <= rank.radiusMeters) {
      return rank.name;
    }
  }
  return null;
}

// =========================================================================
// 2. API ROUTES
// =========================================================================

// GET active vehicles updated within the last 15 minutes
app.get('/api/v1/vehicles', async (req, res) => {
  try {
    const query = `
      SELECT * FROM vehicles 
      WHERE updated_at >= NOW() - INTERVAL '15 minutes'
      ORDER BY updated_at DESC;
    `;
    const result = await pool.query(query);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching vehicles:', error.message || error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST live location updates
app.post('/api/v1/tracking/update', async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'];
    const VALID_API_KEY = process.env.DRIVER_API_KEY || 'harare_kombi_secret_2026';

    if (!apiKey || apiKey !== VALID_API_KEY) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
    }

    const { registration_number, latitude, longitude, speed, capacity } = req.body;
    const vehicleCapacity = capacity || 18;

    const currentRank = checkRankGeofence(parseFloat(latitude), parseFloat(longitude));

    const query = `
      INSERT INTO vehicles (registration_number, latitude, longitude, speed, capacity, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (registration_number) 
      DO UPDATE SET latitude = $2, longitude = $3, speed = $4, updated_at = NOW();
    `;
    await pool.query(query, [registration_number, latitude, longitude, speed, vehicleCapacity]);

    io.emit('location_update', { 
      registration_number, 
      latitude, 
      longitude, 
      speed,
      current_rank: currentRank 
    });

    res.status(200).json({ status: 'success', current_rank: currentRank });
  } catch (error) {
    console.error('Error processing location update:', error.message || error);
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

// POST driver offline notification
app.post('/api/v1/tracking/offline', (req, res) => {
  const { registration_number } = req.body;
  if (registration_number) {
    io.emit('vehicle_offline', { registration_number });
  }
  res.status(200).json({ status: 'offline broadcasted' });
});

// =========================================================================
// 3. SERVER INITIALIZATION
// =========================================================================

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
