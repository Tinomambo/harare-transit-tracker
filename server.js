const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Middleware
app.use(cors());
app.use(express.json());

// PostgreSQL Connection Pool (Supabase / Render Database)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});
// Locate your login route inside server.js
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    
    // Check or update hardcoded credentials here
    if (username === 'admin' && password === 'harare2026') {
        return res.json({ success: true, token: 'authenticated' });
    }
    
    return res.status(401).json({ success: false, message: 'Unauthorized admin credentials.' });
});
// Rank Geofence Coordinates (Harare CBD)
const CBD_RANKS = [
  { name: 'Copacabana Rank', lat: -17.8315, lng: 31.0425, radiusMeters: 150 },
  { name: 'Fourth Street Rank', lat: -17.8319, lng: 31.0558, radiusMeters: 150 },
  { name: 'Market Square Rank', lat: -17.8358, lng: 31.0381, radiusMeters: 150 }
];

// Haversine Formula for Distance Calculation (in Meters)
function getHaversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Helper to check if vehicle is inside a rank
function checkRankGeofence(lat, lng) {
  for (const rank of CBD_RANKS) {
    const dist = getHaversineDistanceMeters(lat, lng, rank.lat, rank.lng);
    if (dist <= rank.radiusMeters) {
      return rank.name;
    }
  }
  return null;
}

// API Key Verification Middleware for Driver Telemetry
const verifyApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  const expectedKey = process.env.DRIVER_API_KEY || 'harare-secret-key-2026';
  if (!apiKey || apiKey !== expectedKey) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
  }
  next();
};

// =========================================================================
// 1. AUTHENTICATION ROUTES (Admin & Municipal Officer)
// =========================================================================

app.post('/api/v1/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await pool.query(
      'SELECT * FROM system_users WHERE username = $1 AND password = $2',
      [username, password]
    );

    if (result.rows.length > 0) {
      const user = result.rows[0];
      return res.status(200).json({ status: 'success', role: user.role, username: user.username });
    } else {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Authentication processing error' });
  }
});

// =========================================================================
// 2. ADMIN MANAGEMENT ROUTES
// =========================================================================

// Admin registers vehicle & assigns driver PIN
app.post('/api/v1/admin/register-vehicle', async (req, res) => {
  try {
    const { registration_number, capacity, pin } = req.body;
    if (!registration_number || !pin) {
      return res.status(400).json({ error: 'Registration plate and PIN are required' });
    }

    const plate = registration_number.trim().toUpperCase();

    const query = `
      INSERT INTO vehicles (registration_number, capacity, pin, latitude, longitude, speed, updated_at)
      VALUES ($1, $2, $3, -17.8315, 31.0425, 0, NOW())
      ON CONFLICT (registration_number) 
      DO UPDATE SET capacity = $2, pin = $3;
    `;
    await pool.query(query, [plate, capacity || 18, pin]);

    return res.status(200).json({ status: 'success', message: `Vehicle ${plate} registered successfully with PIN ${pin}` });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Failed to register vehicle in database' });
  }
});

// =========================================================================
// 3. DRIVER AUTHENTICATION & GPS TELEMETRY
// =========================================================================

// Driver PIN Verification
app.post('/api/v1/driver/authenticate', async (req, res) => {
  try {
    const { registration_number, pin } = req.body;
    if (!registration_number || !pin) {
      return res.status(400).json({ error: 'Plate number and PIN are required' });
    }

    const plate = registration_number.trim().toUpperCase();

    const result = await pool.query(
      'SELECT * FROM vehicles WHERE UPPER(registration_number) = $1 AND pin = $2',
      [plate, pin]
    );

    if (result.rows.length > 0) {
      return res.status(200).json({ status: 'authenticated', registration_number: plate });
    } else {
      return res.status(401).json({ error: 'Invalid plate number or PIN. Please consult Administrator.' });
    }
  } catch (error) {
    console.error('Driver Auth Error:', error);
    return res.status(500).json({ error: 'Driver authentication error' });
  }
});

// Receive GPS Telemetry from Authenticated Driver App
app.post('/api/v1/tracking/update', verifyApiKey, async (req, res) => {
  try {
    const { registration_number, latitude, longitude, speed, capacity } = req.body;

    if (!registration_number || latitude == null || longitude == null) {
      return res.status(400).json({ error: 'Missing required vehicle coordinates' });
    }

    const plate = registration_number.trim().toUpperCase();
    const currentRank = checkRankGeofence(latitude, longitude);

    const query = `
      INSERT INTO vehicles (registration_number, latitude, longitude, speed, capacity, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (registration_number) 
      DO UPDATE SET 
        latitude = $2, 
        longitude = $3, 
        speed = $4, 
        capacity = COALESCE($5, vehicles.capacity), 
        updated_at = NOW();
    `;
    await pool.query(query, [plate, latitude, longitude, speed || 0, capacity || 18]);

    const vehiclePayload = {
      registration_number: plate,
      latitude,
      longitude,
      speed: speed || 0,
      capacity: capacity || 18,
      rank: currentRank,
      updated_at: new Date()
    };

    // Push WebSocket update immediately to connected Admin Dashboards
    io.emit('location_update', vehiclePayload);

    return res.status(200).json({ status: 'success', data: vehiclePayload });
  } catch (error) {
    console.error('Telemetry update error:', error);
    return res.status(500).json({ error: 'Internal server error while processing telemetry' });
  }
});

// =========================================================================
// 4. MUNICIPAL ENFORCEMENT & FLEET DATA
// =========================================================================

// Officer Plate Verification Lookup
app.get('/api/v1/enforcement/lookup/:plate', async (req, res) => {
  try {
    const plate = req.params.plate.trim().toUpperCase();
    
    const query = 'SELECT * FROM vehicles WHERE UPPER(registration_number) = $1';
    const result = await pool.query(query, [plate]);

    if (result.rows.length > 0) {
      const vehicle = result.rows[0];
      return res.status(200).json({
        status: 'REGISTERED',
        registration_number: vehicle.registration_number,
        last_seen: vehicle.updated_at,
        current_speed: vehicle.speed,
        capacity: vehicle.capacity || 18
      });
    } else {
      return res.status(200).json({
        status: 'UNREGISTERED',
        registration_number: plate,
        message: 'Vehicle not found in municipal transit database.'
      });
    }
  } catch (error) {
    console.error('Enforcement lookup error:', error);
    return res.status(500).json({ error: 'Internal server error during lookup' });
  }
});

// Get Active Vehicles (Filtered for last 15 minutes)
app.get('/api/v1/vehicles', async (req, res) => {
  try {
    const query = `
      SELECT registration_number, latitude, longitude, speed, capacity, updated_at 
      FROM vehicles 
      WHERE updated_at >= NOW() - INTERVAL '15 minutes'
      ORDER BY updated_at DESC;
    `;
    const result = await pool.query(query);

    const vehiclesWithRanks = result.rows.map(v => ({
      ...v,
      rank: checkRankGeofence(v.latitude, v.longitude)
    }));

    return res.status(200).json({ vehicles: vehiclesWithRanks });
  } catch (error) {
    console.error('Fetch vehicles error:', error);
    return res.status(500).json({ error: 'Failed to retrieve active fleet data' });
  }
});
// Serve Gateway Portal as the default landing page
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/portal.html');
});
// =========================================================================
// 5. STATIC FILES & SINGLE SERVER PORT LISTEN
// =========================================================================

app.use(express.static('public'));

// WebSockets Connection Event
io.on('connection', (socket) => {
  console.log('Client connected to Socket.IO server:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Single PORT Declaration at the bottom
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Harare Transit Server active and running on port ${PORT}`);
});