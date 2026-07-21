const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const db = require('./config/db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allows dashboard clients to connect from any origin
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(express.json());
app.use(cors());
app.use(helmet({contentSecurityPolicy: false}));
app.use(express.static('public'));

// Test Route
app.get('/', (req, res) => {
  res.json({ message: 'Smart Public Transport Tracking System API is running...' });
});

// Helper Function: Distance Calculation (Haversine Formula in meters)
function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

// ==========================================
// GPS LOCATION INGESTION & REAL-TIME ENGINE
// ==========================================
app.post('/api/v1/tracking/update', async (req, res) => {
  const { registration_number, latitude, longitude, speed } = req.body;

  if (!registration_number || !latitude || !longitude) {
    return res.status(400).json({ error: 'Missing required fields: registration_number, latitude, longitude' });
  }

  try {
    // 1. Check if vehicle is registered
    const vehicleRes = await db.query(
      'SELECT id, status FROM vehicles WHERE registration_number = $1',
      [registration_number]
    );

    let vehicleId = null;
    let isUnregistered = false;

    if (vehicleRes.rows.length === 0 || vehicleRes.rows[0].status !== 'registered') {
      isUnregistered = true;
      // Log illegal unregistered vehicle detection
      await db.query(
        'INSERT INTO violations (vehicle_id, violation_type, latitude, longitude) VALUES ($1, $2, $3, $4)',
        [null, 'UNREGISTERED_OPERATOR', latitude, longitude]
      );
    } else {
      vehicleId = vehicleRes.rows[0].id;
    }

    // 2. Geofence Check: Check distance against known holding bays
    const baysRes = await db.query(
      'SELECT id, name, radius_meters, ST_X(location::geometry) as lng, ST_Y(location::geometry) as lat FROM holding_bays'
    );

    let isInAuthorizedBay = false;
    for (let bay of baysRes.rows) {
      const dist = getDistanceFromLatLonInMeters(latitude, longitude, bay.lat, bay.lng);
      if (dist <= bay.radius_meters) {
        isInAuthorizedBay = true;
        break;
      }
    }

    // 3. Log GPS Movement
    if (vehicleId) {
      await db.query(
        'INSERT INTO gps_logs (vehicle_id, latitude, longitude, speed, is_authorized_stop) VALUES ($1, $2, $3, $4, $5)',
        [vehicleId, latitude, longitude, speed || 0, isInAuthorizedBay]
      );

      // Flag informal stop violation if stationary/low speed outside holding bay
      if (!isInAuthorizedBay && (speed || 0) < 5) {
        await db.query(
          'INSERT INTO violations (vehicle_id, violation_type, latitude, longitude) VALUES ($1, $2, $3, $4)',
          [vehicleId, 'INFORMAL_STOP', latitude, longitude]
        );
      }
    }

    // 4. Broadcast live location update to WebSocket clients (Admin Dashboard)
    const payload = {
      registration_number,
      latitude,
      longitude,
      speed: speed || 0,
      isUnregistered,
      isInAuthorizedBay,
      timestamp: new Date()
    };

    io.emit('vehiclePositionUpdate', payload);

    return res.status(200).json({ status: 'Success', processed: payload });
  } catch (err) {
    console.error('Error processing location update:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Socket.io Connection Logic
io.on('connection', (socket) => {
  console.log('⚡ Admin Dashboard connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
});

// Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Harare Transit Server running on port ${PORT}`);
});