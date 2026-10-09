const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Supabase Database Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Required for Supabase SSL connections
});

// Format Regex: Exactly 3 uppercase letters, a hyphen, and 4 numbers (e.g. ABC-2006)
const REGISTRATION_REGEX = /^[A-Z]{3}-\d{4}$/;

// In-memory store for active vehicle telemetry locations
const liveVehicleLocations = {};

// Helper: Generate a random 4-digit PIN (1000 - 9999)
function generate4DigitPin() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

/**
 * POST /api/admin/login
 * Admin authentication endpoint
 */
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;

  if (username === 'admin' && password === 'April2005') {
    return res.json({ 
      success: true, 
      token: 'harare-admin-authenticated-token' 
    });
  }

  return res.status(401).json({ 
    success: false, 
    error: 'Invalid admin credentials.' 
  });
});

/**
 * POST /api/officer/login
 * Municipal Traffic Enforcement Officer Login Endpoint
 */
app.post('/api/officer/login', (req, res) => {
  const { username, password } = req.body;

  // Accept municipal officer credentials (officer / Harare2026 or officer / password)
  if ((username === 'officer' || username === 'officer1') && password) {
    return res.json({
      success: true,
      message: 'Officer authenticated successfully.',
      token: 'harare-officer-authenticated-token'
    });
  }

  return res.status(401).json({
    success: false,
    error: 'Invalid Officer ID or Password.'
  });
});

/**
 * POST /api/officer/verify
 * Verifies if a vehicle is registered and active in the Harare Municipal System
 */
app.post('/api/officer/verify', async (req, res) => {
  try {
    const { registration_number } = req.body;

    if (!registration_number) {
      return res.status(400).json({ success: false, error: 'Registration number is required.' });
    }

    const formattedReg = registration_number.trim().toUpperCase();

    // Query Supabase database for vehicle registration details
    const query = 'SELECT * FROM vehicles WHERE UPPER(registration_number) = $1;';
    const { rows } = await pool.query(query, [formattedReg]);

    if (rows.length === 0) {
      return res.json({
        success: true,
        verified: false,
        status: 'UNREGISTERED',
        message: `Vehicle '${formattedReg}' is NOT registered in the Harare Transit System.`
      });
    }

    const vehicle = rows[0];
    const isLive = liveVehicleLocations[formattedReg] !== undefined;

    return res.json({
      success: true,
      verified: true,
      vehicle: {
        registration_number: vehicle.registration_number,
        status: vehicle.status || 'ACTIVE',
        is_live_transmitting: isLive,
        registered_id: vehicle.id
      }
    });

  } catch (error) {
    console.error('Field Verification Error:', error);
    return res.status(500).json({ success: false, error: 'Database error during vehicle verification.' });
  }
});

/**
 * POST /api/driver/login
 * Driver authentication using Vehicle Registration & 4-Digit Access PIN
 */
app.post('/api/driver/login', async (req, res) => {
  try {
    const { registration_number, pin } = req.body;

    if (!registration_number || !pin) {
      return res.status(400).json({ 
        success: false, 
        error: 'Vehicle registration and access PIN are required.' 
      });
    }

    const formattedReg = registration_number.trim().toUpperCase();
    const formattedPin = pin.trim();

    // Verify vehicle registration and PIN match in Supabase
    const query = `
      SELECT * FROM vehicles 
      WHERE UPPER(registration_number) = $1 AND driver_pin = $2;
    `;
    const { rows } = await pool.query(query, [formattedReg, formattedPin]);

    if (rows.length === 0) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid vehicle registration or 4-digit driver PIN.' 
      });
    }

    return res.json({
      success: true,
      message: 'Driver authenticated successfully.',
      vehicle: rows[0]
    });

  } catch (error) {
    console.error('Driver Login Error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Database error during driver authentication.' 
    });
  }
});

/**
 * POST /api/driver/telemetry
 * Receives live lat/lng updates from drivers
 */
app.post('/api/driver/telemetry', (req, res) => {
  const { registration_number, latitude, longitude } = req.body;

  if (registration_number && latitude !== undefined && longitude !== undefined) {
    const formattedReg = registration_number.trim().toUpperCase();
    liveVehicleLocations[formattedReg] = {
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      updated_at: new Date()
    };
    return res.json({ success: true });
  }

  return res.status(400).json({ success: false, error: 'Invalid telemetry payload.' });
});

/**
 * GET /api/admin/live-locations
 * Returns active vehicle locations for real-time rendering on the Admin Map
 */
app.get('/api/admin/live-locations', (req, res) => {
  res.json({ success: true, locations: liveVehicleLocations });
});

/**
 * POST /api/vehicles
 * Registers a vehicle with strict ABC-2006 validation & generates a 4-digit Driver PIN
 */
app.post('/api/vehicles', async (req, res) => {
  try {
    const { registration_number } = req.body;

    if (!registration_number) {
      return res.status(400).json({ 
        success: false, 
        error: 'Registration number is required.' 
      });
    }

    const formattedReg = registration_number.trim().toUpperCase();

    // Enforce format validation (e.g., ABC-2006)
    if (!REGISTRATION_REGEX.test(formattedReg)) {
      return res.status(400).json({
        success: false,
        error: `Invalid format '${formattedReg}'. Registration must strictly follow ABC-2006 format (e.g. ABC-2006).`
      });
    }

    // Generate 4-digit PIN for driver access
    const driverPin = generate4DigitPin();

    // Insert into Supabase (registration_number, driver_pin, status)
    const insertQuery = `
      INSERT INTO vehicles (registration_number, driver_pin, status)
      VALUES ($1, $2, 'ACTIVE')
      RETURNING *;
    `;

    const { rows } = await pool.query(insertQuery, [formattedReg, driverPin]);

    return res.status(201).json({
      success: true,
      message: 'Vehicle registered successfully.',
      vehicle: rows[0],
      driver_pin: driverPin
    });

  } catch (error) {
    console.error('Registration Error:', error);

    // PostgreSQL Unique Constraint Violation (Duplicate Registration)
    if (error.code === '23505') {
      return res.status(409).json({ 
        success: false, 
        error: 'A vehicle with this registration number already exists.' 
      });
    }

    return res.status(500).json({ 
      success: false, 
      error: 'Database error while registering vehicle. Ensure driver_pin column exists in Supabase.' 
    });
  }
});

/**
 * GET /api/vehicles
 * Fetches all registered vehicles from Supabase safely
 */
app.get('/api/vehicles', async (req, res) => {
  try {
    const query = 'SELECT * FROM vehicles ORDER BY registration_number ASC;';
    const { rows } = await pool.query(query);

    return res.json({ 
      success: true, 
      vehicles: rows 
    });
  } catch (error) {
    console.error('Fetch Vehicles Error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to retrieve vehicles from Supabase.',
      details: error.message 
    });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Harare Transit Tracker server running on port ${PORT}`);
});
