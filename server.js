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

app.post('/api/v1/tracking/update', async (req, res) => {
  try {
    const { registration_number, latitude, longitude, speed } = req.body;

    const query = `
      INSERT INTO vehicles (registration_number, latitude, longitude, speed, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (registration_number) 
      DO UPDATE SET latitude = $2, longitude = $3, speed = $4, updated_at = NOW();
    `;
    await pool.query(query, [registration_number, latitude, longitude, speed]);

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
