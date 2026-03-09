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
  const userKey = req.headers['x-api-key']; 
  
  // Use the key you set in Render's Environment Variables
  if (userKey === process.env.MY_SECRET_KEY) {
    next(); 
  } else {
    console.log("Blocked unauthorized attempt from headers:", req.headers);
    res.status(403).json({ error: "Unauthorized access blocked." });
  }
};

// --- ROUTES (All now protected by checkSecretKey) ---

// 1. Staff Lookup (Merged and Secured)
app.get('/staff/:id', checkSecretKey, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
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

// 2. Student Lookup
app.get('/student/:id', checkSecretKey, async (req, res) => {
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

// 3. Activities by Day
app.get('/signtrue/activities/:day', checkSecretKey, async (req, res) => {
  const { day } = req.params;
  try {
    const result = await pool.query(
      'SELECT id, title, instructor, start_time, end_time, location, activity_date, max_capacity FROM signtrue.activities WHERE day_of_week = $1 ORDER BY start_time ASC',
      [day]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching activities:", err);
    res.status(500).json({ error: "Database error fetching activities" });
  }
});

// 4. Create New Activity
app.post('/signtrue/activities', checkSecretKey, async (req, res) => {
  const { title, instructor, start_time, end_time, day_of_week, activity_date, location, max_capacity } = req.body;
  try {
    const query = `
      INSERT INTO signtrue.activities 
      (title, instructor, start_time, end_time, day_of_week, activity_date, location, max_capacity) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
      RETURNING *`;
    const values = [title, instructor, start_time, end_time, day_of_week, activity_date, location, max_capacity];
    const result = await pool.query(query, values);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error creating activity:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// 5. Schools List
app.get('/signtrue/schools-list', checkSecretKey, async (req, res) => {
  try {
    const result = await pool.query('SELECT name FROM signtrue.schools');
    const schoolNames = result.rows.map(row => row.name);
    res.json(schoolNames); 
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// 6. Record Attendance
app.post('/signtrue/attendance/record', checkSecretKey, async (req, res) => {
  const { student_id, activity_id, teacher_id, activity_date } = req.body;

  try {
    const query = `
      INSERT INTO signtrue.attendance (student_id, activity_id, teacher_id, activity_date)
      VALUES ($1, $2, $3, $4)
      RETURNING *`;
    
    const values = [student_id, activity_id, teacher_id, activity_date];
    const result = await pool.query(query, values);
    
    res.status(201).json({ message: "Attendance recorded!", data: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') { // PostgreSQL unique violation error code
      res.status(400).json({ error: "Student is already registered for an activity today." });
    } else {
      console.error("Attendance Error:", err);
      res.status(500).json({ error: "Database error recording attendance" });
    }
  }
});

// 7. Get student registrations for a specific date
app.get('/signtrue/attendance/student/:studentId', checkSecretKey, async (req, res) => {
  const { studentId } = req.params;
  const { date } = req.query; // Matches ?date=yyyy-MM-dd in your Flutter call

  try {
    const query = `
      SELECT activity_id 
      FROM signtrue.attendance 
      WHERE student_id = $1 AND activity_date = $2
    `;
    const values = [studentId, date];
    const result = await pool.query(query, values);

    // Sends back an array like [{"activity_id": 1}]
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching registrations:", err);
    res.status(500).json({ error: "Database error fetching registrations" });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SignTrue server running on port ${PORT}`));










