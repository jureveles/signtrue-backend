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

// Middleware to check for our secret key
const checkSecretKey = (req, res, next) => {
  const userKey = req.headers['x-api-key']; // Look for the key in the headers
  
  if (userKey === process.env.MY_SECRET_KEY) {
    next(); // Key matches! Proceed to the data
  } else {
    res.status(403).json({ error: "Unauthorized access blocked." });
  }
};

// Apply this to your staff route
app.get('/staff/:id', checkSecretKey, async (req, res) => {
  // ... your existing code ...
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

// --- STAFF / TEACHER ROUTE ---
// 2. Route to find a staff member by their ID
app.get('/staff/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      // We select the columns shown in your database screenshot
      'SELECT local_id, first_name, last_name, role FROM signtrue.staff WHERE local_id = $1',
      [id]
    );

    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ message: "Staff member not found" });
    }
  } catch (err) {
    console.error("Staff lookup error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// 3. Route to get activities by day for the SignTrue schema
app.get('/signtrue/activities/:day', async (req, res) => {
  const { day } = req.params;
  try {
    const result = await pool.query(
      // ADDED: id, instructor, and activity_date to the SELECT list
      'SELECT id, title, instructor, start_time, end_time, location, activity_date, max_capacity FROM signtrue.activities WHERE day_of_week = $1 ORDER BY start_time ASC',
      [day]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching activities:", err);
    res.status(500).json({ error: "Database error fetching activities" });
  }
});

// 4. Route to create a new activity in the signtrue schema
app.post('/signtrue/activities', async (req, res) => {
  const { title, instructor, start_time, end_time, day_of_week, activity_date, location, max_capacity } = req.body;
  
  try {
    const query = `
      INSERT INTO signtrue.activities 
      (title, instructor, start_time, end_time, day_of_week, activity_date, location, max_capacity) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
      RETURNING *`;
    
    const values = [title, instructor, start_time, end_time, day_of_week, activity_date, location, max_capacity];
    
    const result = await pool.query(query, values);
    res.status(201).json(result.rows[0]); // Returns the created activity with its new ID
  } catch (err) {
    console.error("Error creating activity:", err);
    res.status(500).json({ error: "Database error creating activity" });
  }
});

// 2. Route to Get ALL school names as a list
app.get('/signtrue/schools-list', async (req, res) => {
  try {
    // 1. Remove "LIMIT 1" to get all schools
    const result = await pool.query('SELECT name FROM signtrue.schools');
    
    if (result.rows.length > 0) {
      // 2. Map the rows so you send ["School A", "School B"] 
      // instead of [{"name": "School A"}]
      const schoolNames = result.rows.map(row => row.name);
      res.json(schoolNames); 
    } else {
      res.json([]); // Return empty list if no schools exist
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SignTrue server running on port ${PORT}`));







