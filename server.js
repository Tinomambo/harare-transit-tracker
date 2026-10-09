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
  ssl: { rejectUnauthorized: false } // Required for Supabase external SSL connections
});

// Format Regex: Exactly 3 uppercase letters, a hyphen, and 4 numbers (e.g. ABC-2006)
const REGISTRATION_REGEX = /^[A-Z]{3}-\d{4}$/;

// Helper: Generate a random 4-digit PIN (1000 - 9999)
function generate4DigitPin() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

/**
 * POST /api/admin/login
 * Admin login authentication
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
        error: `Invalid format '${formattedReg}'. Registration must strictly follow the format ABC-2006 (e.g. ABC-2006).`
      });
    }

    // Generate 4-digit PIN for driver access
    const driverPin = generate4DigitPin();

    // Clean query targeting only registration_number, driver_pin, and status
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
      error: 'Database error while registering vehicle. Make sure driver_pin column exists in Supabase.' 
    });
  }
});

/**
 * GET /api/vehicles
 * Fetches all registered vehicles from Supabase
 */
app.get('/api/vehicles', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM vehicles ORDER BY id DESC');
    res.json({ success: true, vehicles: rows });
  } catch (error) {
    console.error('Fetch Vehicles Error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to retrieve vehicles from Supabase.' 
    });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Harare Transit Tracker server running on port ${PORT}`);
});
