const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Supabase client initialization
// (Find these in Supabase Dashboard -> Project Settings -> API)
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gprvuiygcrniyuzqicmx.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY; 

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

app.use(express.json());
app.use(cors());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('dev'));
app.use(express.static('public'));

app.post('/api/v1/tracking/update', async (req, res) => {
  try {
    const { registration_number, latitude, longitude, speed } = req.body;

    // Upsert into 'vehicles' table via Supabase API
    const { data, error } = await supabase
      .from('vehicles')
      .upsert({ 
        registration_number, 
        latitude, 
        longitude, 
        speed, 
        updated_at: new Date().toISOString() 
      }, { onConflict: 'registration_number' });

    if (error) throw error;

    // Broadcast update via Socket.io
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
