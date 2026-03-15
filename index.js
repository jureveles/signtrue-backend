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
  
  if (userKey === process.env.MY_SECRET_KEY) {
    next(); 
  } else {
    console.log("Blocked unauthorized attempt from headers:", req.headers);
    res.status(403).json({ error: "Unauthorized access blocked." });
  }
};

// --- ROUTES ---

// 1. Staff Lookup
app.get('/staff/:id', checkSecretKey, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT 
        st.local_id, 
        st.first_name, 
        st.last_name, 
        st.role, 
        sch.name AS school_name 
       FROM signtrue.staff st
       LEFT JOIN signtrue.schools sch ON st.school_id = sch.id
       WHERE st.local_id = $1`,
      [id]
    );

    if (result.rows.length > 0) {
      // This will now return the staff info PLUS "school_name"
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
      `SELECT 
        s.local_id, 
        s.last_name, 
        s.first_name, 
        s.chosen_name, 
        s.grade_level, 
        sch.name AS school_name 
       FROM signtrue.students s
       LEFT JOIN signtrue.schools sch ON s.school_id = sch.id
       WHERE s.local_id = $1`,
      [id]
    );

    if (result.rows.length > 0) {
      // result.rows[0] will now include the "school_name" field!
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ message: "Student not found" });
    }
  } catch (err) {
    console.error("Database Error in Student Lookup:", err);
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
    const result = await pool.query(query, [title, instructor, start_time, end_time, day_of_week, activity_date, location, max_capacity]);
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
    res.json(result.rows.map(row => row.name)); 
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// 6. Record/Update Attendance (The "Save" Logic)
app.post('/signtrue/attendance/record', checkSecretKey, async (req, res) => {
  const { student_id, activity_id, teacher_id, activity_date, status } = req.body;

  try {
    // UPSERT: If record exists (student + date match), update the status. Else, insert.
    const query = `
      INSERT INTO signtrue.attendance (student_id, activity_id, teacher_id, activity_date, status)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (student_id, activity_date) 
      DO UPDATE SET status = EXCLUDED.status, teacher_id = EXCLUDED.teacher_id
      RETURNING *`;
    
    const values = [student_id, activity_id, teacher_id, activity_date, status || 'Pending'];
    const result = await pool.query(query, values);
    
    res.status(201).json({ message: "Attendance processed!", data: result.rows[0] });
  } catch (err) {
    console.error("Attendance Error:", err);
    res.status(500).json({ error: "Database error recording attendance" });
  }
});

// 7. Get individual student registrations (For schedule view)
app.get('/signtrue/attendance/student/:studentId', checkSecretKey, async (req, res) => {
  const { studentId } = req.params;
  const { date } = req.query;
  try {
    const query = 'SELECT activity_id FROM signtrue.attendance WHERE student_id = $1 AND activity_date = $2';
    const result = await pool.query(query, [studentId, date]);
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching registrations:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// 8. Get all students for a specific class (For teacher dashboard)
app.get('/signtrue/attendance/activity/:activityId', checkSecretKey, async (req, res) => {
  const { activityId } = req.params;
  const { date } = req.query;

  try {
    const query = `
      SELECT a.student_id, a.status, s.first_name, s.last_name, s.chosen_name
      FROM signtrue.attendance a
      JOIN signtrue.students s ON a.student_id = s.local_id
      WHERE a.activity_id = $1 AND a.activity_date = $2
      ORDER BY s.last_name ASC, s.first_name ASC`;
      
    const result = await pool.query(query, [activityId, date]);
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching activity attendance:", err);
    res.status(500).json({ error: "Database error" });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SignTrue server running on port ${PORT}`));














