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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

app.use(express.json());
app.use(cors());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('dev'));
app.use(express.static('public'));

// REPLACE your existing app.post('/api/v1/tracking/update') block with this:
app.post('/api/v1/tracking/update', async (req, res) => {
  try {
    // 1. Validate API Key from headers
    const apiKey = req.headers['x-api-key'];
    const VALID_API_KEY = process.env.DRIVER_API_KEY || 'harare_kombi_secret_2026';

    if (!apiKey || apiKey !== VALID_API_KEY) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
    }

    const { registration_number, latitude, longitude, speed, capacity } = req.body;
    const vehicleCapacity = capacity || 18;

    const query = `
      INSERT INTO vehicles (registration_number, latitude, longitude, speed, capacity, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (registration_number) 
      DO UPDATE SET latitude = $2, longitude = $3, speed = $4, updated_at = NOW();
    `;
    await pool.query(query, [registration_number, latitude, longitude, speed, vehicleCapacity]);

    // Broadcast live socket update to admin dashboard
    io.emit('location_update', { registration_number, latitude, longitude, speed });

    res.status(200).json({ status: 'success' });
  } catch (error) {
    console.error('Error processing location update:', error.message || error);
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
