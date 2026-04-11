const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Middleware: Security Gatekeeper
const checkSecretKey = (req, res, next) => {
  const userKey = req.headers['x-api-key'];
  if (userKey === process.env.MY_SECRET_KEY) {
    next();
  } else {
    res.status(403).json({ error: "Unauthorized access blocked." });
  }
};

// --- ROUTES ---

// 1. UNIFIED LOGIN (Replaces staff/student lookups)
app.post('/signtrue/login', checkSecretKey, async (req, res) => {
  const { local_id, password } = req.body;
  try {
    const query = `
      SELECT u.*, sch.name AS school_name 
      FROM signtrue.users u
      LEFT JOIN signtrue.schools sch ON u.school_id = sch.id
      WHERE u.local_id = $1 AND u.password = $2`;
    
    const result = await pool.query(query, [local_id, password]);

    if (result.rows.length > 0) {
      const user = result.rows[0];
      delete user.password; // Don't send the password back to the app!
      res.json(user);
    } else {
      res.status(401).json({ error: "Invalid ID or password" });
    }
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Database error during login" });
  }
});

// 2. ACTIVITIES BY DAY
app.get('/signtrue/activities/:day', checkSecretKey, async (req, res) => {
  const { day } = req.params;
  try {
    const result = await pool.query(
      'SELECT * FROM signtrue.activities WHERE day_of_week = $1 ORDER BY start_time ASC',
      [day]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Error fetching activities" });
  }
});

// 3. CREATE NEW ACTIVITY (Used by Admin Dashboard)
app.post('/signtrue/activities/create', checkSecretKey, async (req, res) => {
  const { title, instructor, start_time, end_time, day_of_week, activity_date, location, max_capacity } = req.body;
  try {
    const query = `
      INSERT INTO signtrue.activities 
      (title, instructor, start_time, end_time, day_of_week, activity_date, location, max_capacity) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
      RETURNING *`;
    const result = await pool.query(query, [title, instructor, start_time, end_time, day_of_week, activity_date, location, max_capacity]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Create Activity Error:", err);
    res.status(500).json({ error: "Could not create activity" });
  }
});

// 4. GET ENROLLMENT FOR ACTIVITY (Admin Roster View)
app.get('/signtrue/attendance/activity/:activityId', checkSecretKey, async (req, res) => {
  const { activityId } = req.params;
  try {
    const query = `
      SELECT a.status, u.first_name || ' ' || u.last_name AS student_name
      FROM signtrue.attendance a
      JOIN signtrue.users u ON a.student_id = u.local_id
      WHERE a.activity_id = $1`;
    const result = await pool.query(query, [activityId]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Error fetching roster" });
  }
});

// 5. RECORD ATTENDANCE (Teacher Check-in)
app.post('/signtrue/attendance/record', checkSecretKey, async (req, res) => {
  const { student_id, activity_id, teacher_id, activity_date, status } = req.body;
  try {
    const query = `
      INSERT INTO signtrue.attendance (student_id, activity_id, teacher_id, activity_date, status)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (student_id, activity_date) 
      DO UPDATE SET status = EXCLUDED.status, teacher_id = EXCLUDED.teacher_id
      RETURNING *`;
    const result = await pool.query(query, [student_id, activity_id, teacher_id, activity_date, status]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Attendance failed" });
  }
});

// 6. SCHOOLS LIST
app.get('/signtrue/schools-list', checkSecretKey, async (req, res) => {
  try {
    const result = await pool.query('SELECT name FROM signtrue.schools');
    res.json(result.rows.map(row => row.name));
  } catch (err) {
    res.status(500).json({ error: "Error fetching schools" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SignTrue Server Active on Port ${PORT}`));













