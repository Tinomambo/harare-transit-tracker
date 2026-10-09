const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serves static files from the 'public' directory

// PostgreSQL Database Connection Setup
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Regular Expression: Exactly 3 uppercase letters, a hyphen, and 4 digits
const REGISTRATION_REGEX = /^[A-Z]{3}-\d{4}$/;

/**
 * POST /api/vehicles
 * Handles Vehicle Registration with Strict Format Validation
 */
app.post('/api/vehicles', async (req, res) => {
  try {
    const { registration_number, capacity, model, driver_name } = req.body;

    // Sanitize and format input
    if (!registration_number) {
      return res.status(400).json({
        success: false,
        error: 'Registration number is required.'
      });
    }

    const formattedReg = registration_number.trim().toUpperCase();

    // Enforce Format Validation (e.g., ABC-2009)
    if (!REGISTRATION_REGEX.test(formattedReg)) {
      return res.status(400).json({
        success: false,
        error: `Invalid registration format '${formattedReg}'. Registration must strictly follow the format ABC-2009 (3 letters, hyphen, 4 numbers).`
      });
    }

    // Insert into Database
    const insertQuery = `
      INSERT INTO vehicles (registration_number, capacity, model, driver_name)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;
    const values = [formattedReg, capacity || null, model || null, driver_name || null];

    const { rows } = await pool.query(insertQuery, values);

    return res.status(201).json({
      success: true,
      message: 'Vehicle registered successfully.',
      vehicle: rows[0]
    });

  } catch (error) {
    console.error('Vehicle Registration Error:', error);

    // PostgreSQL Unique Constraint Violation (Error Code 23505)
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        error: 'A vehicle with this registration number already exists.'
      });
    }

    return res.status(500).json({
      success: false,
      error: 'An internal server error occurred while registering the vehicle.'
    });
  }
});

/**
 * GET /api/vehicles
 * Fetch All Registered Vehicles
 */
app.get('/api/vehicles', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM vehicles ORDER BY id DESC');
    res.json({ success: true, vehicles: rows });
  } catch (error) {
    console.error('Fetch Error:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve vehicles.' });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Harare Transit Tracker server running on port ${PORT}`);
});
