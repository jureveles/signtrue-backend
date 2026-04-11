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

// ===========================================================================
// ROUTES
// ===========================================================================

// 1. UNIFIED LOGIN
app.post('/signtrue/login', checkSecretKey, async (req, res) => {
  const { local_id, password } = req.body;

  try {
    const query = `
      SELECT u.*, sch.name AS school_name
      FROM signtrue.users u
      LEFT JOIN signtrue.schools sch ON u.school_id = sch.id
      WHERE (u.local_id = $1 OR LOWER(u.username) = LOWER($1))
        AND u.password_hash = $2
    `;

    const result = await pool.query(query, [local_id, password]);

    if (result.rows.length > 0) {
      const user = result.rows[0];
      delete user.password_hash;
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
      `
      SELECT * 
      FROM signtrue.activities 
      WHERE day_of_week = $1 
      ORDER BY start_time ASC
      `,
      [day]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Fetch activities error:", err);
    res.status(500).json({ error: "Error fetching activities" });
  }
});

// 3. CREATE NEW ACTIVITY
app.post('/signtrue/activities/create', checkSecretKey, async (req, res) => {
  const {
    title,
    instructor,
    start_time,
    end_time,
    day_of_week,
    activity_date,
    location,
    max_capacity
  } = req.body;

  try {
    const query = `
      INSERT INTO signtrue.activities 
      (title, instructor, start_time, end_time, day_of_week, activity_date, location, max_capacity) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
      RETURNING *
    `;

    const result = await pool.query(query, [
      title,
      instructor,
      start_time,
      end_time,
      day_of_week,
      activity_date,
      location,
      max_capacity
    ]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Create Activity Error:", err);
    res.status(500).json({ error: "Could not create activity" });
  }
});

// 4. GET ENROLLMENT FOR ACTIVITY
app.get('/signtrue/attendance/activity/:activityId', checkSecretKey, async (req, res) => {
  const { activityId } = req.params;

  try {
    const query = `
      SELECT a.status, u.first_name || ' ' || u.last_name AS student_name
      FROM signtrue.attendance a
      JOIN signtrue.users u ON a.student_id = u.local_id
      WHERE a.activity_id = $1
    `;

    const result = await pool.query(query, [activityId]);

    res.json(result.rows);
  } catch (err) {
    console.error("Fetch roster error:", err);
    res.status(500).json({ error: "Error fetching roster" });
  }
});

// 5. RECORD ATTENDANCE
app.post('/signtrue/attendance/record', checkSecretKey, async (req, res) => {
  const { student_id, activity_id, teacher_id, activity_date, status } = req.body;

  try {
    const query = `
      INSERT INTO signtrue.attendance 
      (student_id, activity_id, teacher_id, activity_date, status)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (student_id, activity_date) 
      DO UPDATE SET 
        status = EXCLUDED.status, 
        teacher_id = EXCLUDED.teacher_id
      RETURNING *
    `;

    const result = await pool.query(query, [
      student_id,
      activity_id,
      teacher_id,
      activity_date,
      status
    ]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Attendance error:", err);
    res.status(500).json({ error: "Attendance failed" });
  }
});

// 6. SCHOOLS LIST
app.get('/signtrue/schools-list', checkSecretKey, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT name FROM signtrue.schools ORDER BY name ASC`
    );

    res.json(result.rows.map(row => row.name));
  } catch (err) {
    console.error("Fetch schools error:", err);
    res.status(500).json({ error: "Error fetching schools" });
  }
});

// 7. GET RESOURCES FOR AN ORGANIZATION
app.get('/signtrue/resources/:schoolId', checkSecretKey, async (req, res) => {
  const { schoolId } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT
        id,
        school_id,
        name,
        description,
        location,
        capacity,
        resource_type,
        is_active,
        created_at
      FROM signtrue.resources
      WHERE school_id = $1
        AND is_active = true
      ORDER BY name ASC
      `,
      [schoolId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Fetch resources error:", err);
    res.status(500).json({ error: "Error fetching resources" });
  }
});

// 8. GET RESERVATIONS FOR A RESOURCE ON A GIVEN DATE
app.get('/signtrue/reservations/:resourceId/:date', checkSecretKey, async (req, res) => {
  const { resourceId, date } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT
        r.id,
        r.resource_id,
        r.user_id,
        r.reservation_date,
        r.start_time,
        r.end_time,
        r.status,
        r.notes,
        r.created_at,
        u.first_name,
        u.last_name,
        u.username
      FROM signtrue.reservations r
      JOIN signtrue.users u ON r.user_id = u.id
      WHERE r.resource_id = $1
        AND r.reservation_date = $2
        AND r.status IN ('pending', 'approved')
      ORDER BY r.start_time ASC
      `,
      [resourceId, date]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Fetch reservations error:", err);
    res.status(500).json({ error: "Error fetching reservations" });
  }
});

// 9. CREATE A RESERVATION
app.post('/signtrue/reservations/create', checkSecretKey, async (req, res) => {
  const {
    resource_id,
    user_id,
    reservation_date,
    start_time,
    end_time,
    notes
  } = req.body;

  try {
    const result = await pool.query(
      `
      INSERT INTO signtrue.reservations
      (resource_id, user_id, reservation_date, start_time, end_time, status, notes)
      VALUES ($1, $2, $3, $4, $5, 'pending', $6)
      RETURNING *
      `,
      [resource_id, user_id, reservation_date, start_time, end_time, notes || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Create reservation error:", err);

    if (err.constraint === 'no_overlapping_reservations') {
      return res.status(409).json({ error: "Time slot already reserved" });
    }

    res.status(500).json({ error: "Could not create reservation" });
  }
});

// 10. GET ALL RESERVATIONS FOR AN ORGANIZATION / SCHOOL
app.get('/signtrue/reservations/school/:schoolId', checkSecretKey, async (req, res) => {
  const { schoolId } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT
        r.id,
        r.resource_id,
        r.user_id,
        r.reservation_date,
        r.start_time,
        r.end_time,
        r.status,
        r.notes,
        r.created_at,
        res.name AS resource_name,
        res.location AS resource_location,
        res.capacity AS resource_capacity,
        u.first_name,
        u.last_name,
        u.username,
        u.local_id
      FROM signtrue.reservations r
      JOIN signtrue.resources res ON r.resource_id = res.id
      JOIN signtrue.users u ON r.user_id = u.id
      WHERE res.school_id = $1
      ORDER BY r.reservation_date ASC, r.start_time ASC
      `,
      [schoolId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Fetch school reservations error:", err);
    res.status(500).json({ error: "Error fetching school reservations" });
  }
});

// 11. UPDATE RESERVATION STATUS
app.patch('/signtrue/reservations/:reservationId/status', checkSecretKey, async (req, res) => {
  const { reservationId } = req.params;
  const { status } = req.body;

  const allowedStatuses = ['pending', 'approved', 'denied', 'cancelled'];

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ error: "Invalid reservation status" });
  }

  try {
    const result = await pool.query(
      `
      UPDATE signtrue.reservations
      SET status = $1
      WHERE id = $2
      RETURNING *
      `,
      [status, reservationId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Reservation not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Update reservation status error:", err);
    res.status(500).json({ error: "Could not update reservation status" });
  }
});

// ===========================================================================
// SERVER START
// ===========================================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`SignTrue Server Active on Port ${PORT}`);
});






