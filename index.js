const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Database connection using the environment variable from Render
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- ROUTES ---

// 1. Route to find a student by their ID
app.get('/student/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'SELECT local_id, last_name, first_name, chosen_name, grade_level, special_ed FROM signtrue.students WHERE local_id = $1',
      [id]
    );

    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ message: "Student not found" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// 2. Route to get activities by day for the SignTrue schema
app.get('/signtrue/activities/:day', async (req, res) => {
  const { day } = req.params;
  try {
    // Queries the activities table specifically within the signtrue schema
    const result = await pool.query(
      'SELECT title, instructor, start_time, end_time, location FROM signtrue.activities WHERE day_of_week = $1 ORDER BY start_time ASC',
      [day]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching activities:", err);
    res.status(500).json({ error: "Database error fetching activities" });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SignTrue server running on port ${PORT}`));

