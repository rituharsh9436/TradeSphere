const express = require('express');
const cors = require('cors');

const apiRoutes = require('./routes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

// Middleware
app.use(cors());
app.use(express.json()); // Parses incoming JSON requests

// Health check route
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'UP', message: 'Trading engine is running.' });
});

// API routes
app.use('/api', apiRoutes);

// 404 + central error handler (must be registered last)
app.use(notFound);
app.use(errorHandler);

module.exports = app;