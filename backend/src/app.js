const express = require('express');
const cors = require('cors');

const app = express();

// Middleware
app.use(cors());
app.use(express.json()); // Parses incoming JSON requests

// Health check route
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'UP', message: 'Trading engine is running.' });
});

// Future routes will be mounted here
// const apiRoutes = require('./routes/api.routes');
// app.use('/api', apiRoutes);

module.exports = app;