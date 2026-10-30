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
        id: vehicle.id,
        registration_number: vehicle.registration_number,
        status: vehicle.status || 'registered',
        operational_status: vehicle.operational_status || 'registered',
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
 * POST /api/officer/inspect
 * Records an enforcement action and updates vehicle operational status
 */
app.post('/api/officer/inspect', async (req, res) => {
    const { 
        officer_id, 
        vehicle_id, 
        vehicle_plate, 
        is_registered, 
        checkpoint_name, 
        action_taken, 
        fine_amount, 
        notes 
    } = req.body;

    try {
        await pool.query('BEGIN');

        let paymentStatus = 'N/A';
        // Only charge fine if action taken is FINED
        let actualFineAmount = (action_taken === 'FINED') ? (parseFloat(fine_amount) || 0.00) : 0.00;
        
        // Force registered vehicles to $0.00 fine unless explicitly overridden by a fine action
        if (is_registered && action_taken !== 'FINED') {
            actualFineAmount = 0.00;
        }

        if (action_taken === 'FINED') {
            paymentStatus = 'UNPAID';
        }

        const logQuery = `
            INSERT INTO enforcement_inspection_logs 
            (officer_id, vehicle_id, vehicle_plate, is_registered, checkpoint_name, action_taken, fine_amount, payment_status, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *;
        `;
        
        const logValues = [
            officer_id || 'OFFICER_DEFAULT', 
            vehicle_id || null, 
            vehicle_plate, 
            is_registered, 
            checkpoint_name || 'Harare Checkpoint', 
            action_taken, 
            actualFineAmount, 
            paymentStatus, 
            notes
        ];

        const logResult = await pool.query(logQuery, logValues);

        if (vehicle_id && (action_taken === 'IMPOUND_FLAGGED' || action_taken === 'DRIVER_SUSPENDED')) {
            const newStatus = action_taken === 'IMPOUND_FLAGGED' ? 'IMPOUNDED' : 'SUSPENDED';
            await pool.query(
                `UPDATE vehicles SET operational_status = $1 WHERE id = $2`,
                [newStatus, vehicle_id]
            );
        }

        await pool.query('COMMIT');

        return res.status(201).json({
            success: true,
            message: 'Enforcement action logged successfully',
            inspection: logResult.rows[0]
        });

    } catch (error) {
        await pool.query('ROLLBACK');
        console.error('Enforcement logging detailed error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/enforcement/reports/summary
 * Admin report summarizing compliance metrics, weekly/monthly unregistered revenue, and plate inspection logs
 */
app.get('/api/enforcement/reports/summary', async (req, res) => {
    try {
        const statsQuery = `
            SELECT 
                COUNT(*) AS total_inspections,
                SUM(CASE WHEN is_registered = TRUE THEN 1 ELSE 0 END) as registered_count,
                SUM(CASE WHEN is_registered = FALSE THEN 1 ELSE 0 END) as unregistered_count,
                SUM(CASE WHEN is_registered = FALSE THEN fine_amount ELSE 0 END) as total_fines_issued,
                COALESCE(SUM(CASE WHEN is_registered = FALSE AND created_at >= NOW() - INTERVAL '7 days' THEN fine_amount ELSE 0 END), 0.00) as weekly_unregistered_fines,
                COALESCE(SUM(CASE WHEN is_registered = FALSE AND created_at >= NOW() - INTERVAL '30 days' THEN fine_amount ELSE 0 END), 0.00) as monthly_unregistered_fines
            FROM enforcement_inspection_logs;
        `;

        const recentLogsQuery = `
            SELECT 
                vehicle_plate, 
                is_registered, 
                checkpoint_name, 
                action_taken, 
                fine_amount, 
                created_at
            FROM enforcement_inspection_logs
            WHERE created_at >= NOW() - INTERVAL '30 days'
            ORDER BY created_at DESC;
        `;

        const stats = await pool.query(statsQuery);
        const recentLogs = await pool.query(recentLogsQuery);

        return res.json({
            success: true,
            summary: stats.rows[0] || { 
                total_inspections: 0, 
                registered_count: 0, 
                unregistered_count: 0, 
                total_fines_issued: 0, 
                weekly_unregistered_fines: 0,
                monthly_unregistered_fines: 0 
            },
            weekly_logs: recentLogs.rows || []
        });

    } catch (error) {
        console.error('Error fetching enforcement reports:', error);
        return res.status(500).json({ success: false, error: error.message });
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
  return res.json({ success: true, locations: liveVehicleLocations });
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

    if (!REGISTRATION_REGEX.test(formattedReg)) {
      return res.status(400).json({
        success: false,
        error: `Invalid format '${formattedReg}'. Registration must strictly follow ABC-2006 format (e.g. ABC-2006).`
      });
    }

    const driverPin = generate4DigitPin();

    const insertQuery = `
      INSERT INTO vehicles (registration_number, driver_pin, status, operational_status)
      VALUES ($1, $2, 'registered', 'registered')
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

    if (error.code === '23505') {
      return res.status(409).json({ 
        success: false, 
        error: 'A vehicle with this registration number already exists.' 
      });
    }

    return res.status(500).json({ 
      success: false, 
      error: 'Database error while registering vehicle. Ensure driver_pin and operational_status columns exist in Supabase.' 
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

    const normalizedRows = rows.map(v => ({
      ...v,
      status: 'registered',
      operational_status: v.operational_status || 'registered'
    }));

    return res.json({ 
      success: true, 
      vehicles: normalizedRows 
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
