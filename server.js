const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Database Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Regex for Format: 3 letters, hyphen, 4 digits (e.g., ABC-2006)
const REGISTRATION_REGEX = /^[A-Z]{3}-\d{4}$/;

/**
 * POST /api/admin/login
 * Admin authentication endpoint
 */
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;

  if (username === 'admin' && password === 'April2005') {
    return res.json({ success: true, token: 'harare-admin-authenticated-token' });
  }

  return res.status(401).json({ success: false, error: 'Invalid admin username or password.' });
});

/**
 * POST /api/vehicles
 * Registers vehicle with strict ABC-2006 format validation
 */
app.post('/api/vehicles', async (req, res) => {
  try {
    const { registration_number } = req.body;

    if (!registration_number) {
      return res.status(400).json({ success: false, error: 'Registration number is required.' });
    }

    const formattedReg = registration_number.trim().toUpperCase();

    if (!REGISTRATION_REGEX.test(formattedReg)) {
      return res.status(400).json({
        success: false,
        error: `Invalid format '${formattedReg}'. Registration must be in format ABC-2006 (e.g. ABC-2006).`
      });
    }

    const insertQuery = `
      INSERT INTO vehicles (registration_number, status)
      VALUES ($1, 'ACTIVE')
      RETURNING *;
    `;
    const { rows } = await pool.query(insertQuery, [formattedReg]);

    return res.status(201).json({
      success: true,
      message: 'Vehicle registered successfully.',
      vehicle: rows[0]
    });

  } catch (error) {
    console.error('Registration Error:', error);
    if (error.code === '23505') {
      return res.status(409).json({ success: false, error: 'Vehicle registration already exists.' });
    }
    return res.status(500).json({ success: false, error: 'Internal server error.' });
  }
});

/**
 * GET /api/vehicles
 * Retrieves list of vehicles
 */
app.get('/api/vehicles', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM vehicles ORDER BY id DESC');
    res.json({ success: true, vehicles: rows });
  } catch (error) {
    console.error('Fetch Vehicles Error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch vehicles.' });
  }
});

app.listen(PORT, () => {
  console.log(`Harare Transit Tracker server running on port ${PORT}`);
});
