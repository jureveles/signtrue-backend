const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} = require('./google_calendar');

const app = express();
app.use(cors());
app.use(express.json());

const nodemailer = require('nodemailer');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// =====================================================
// EMAIL TRANSPORTER
// =====================================================

const smtpHost = process.env.MAIL_DEFAULT_SERVER || 'mail.privateemail.com';
const smtpPort = Number(process.env.MAIL_PORT || 587);
const smtpUser = process.env.MAIL_USERNAME;
const smtpPass = process.env.MAIL_PASSWORD;
const smtpFrom = process.env.MAIL_DEFAULT_SENDER || smtpUser;

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: false,
  requireTLS: true,

  auth: {
    user: smtpUser,
    pass: smtpPass,
  },

  connectionTimeout: 30000,
  greetingTimeout: 30000,
  socketTimeout: 30000,
});


// Middleware: Security Gatekeeper
const checkSecretKey = (req, res, next) => {
  const userKey = req.headers['x-api-key'];

  if (userKey === process.env.MY_SECRET_KEY) {
    next();
  } else {
    res.status(403).json({
      error: "Unauthorized access blocked."
    });
  }
};

function buildReservationDateTime(date, time) {
  return `${date}T${time}`;
}

// ===========================================================================
// ROUTES
// ===========================================================================

// 1. UNIFIED LOGIN
app.post('/signtrue/login', checkSecretKey, async (req, res) => {
  const { local_id, password, school_name } = req.body;

  if (!local_id || !password || !school_name) {
    return res.status(400).json({
      error: "Missing login information"
    });
  }

  try {
    const query = `
      SELECT u.*, sch.name AS school_name
      FROM signtrue.users u
      LEFT JOIN signtrue.schools sch 
        ON u.school_id = sch.id
      WHERE 
        (u.local_id::text = $1 OR LOWER(u.username) = LOWER($1))
        AND LOWER(sch.name) = LOWER($2)
      LIMIT 1
    `;

    const result = await pool.query(query, [
      local_id,
      school_name,
    ]);

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: "Invalid ID, password, or institution"
      });
    }

    const user = result.rows[0];

    const bcrypt = require('bcryptjs');
    const passwordMatches = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        error: "Invalid ID, password, or institution"
      });
    }

    delete user.password_hash;
    return res.json(user);

  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({
      error: "Database error during login"
    });
  }
});

// 2. ACTIVITIES BY DATE
app.get('/signtrue/activities/date/:date', checkSecretKey, async (req, res) => {
  const { date } = req.params;

  try {
    const query = `
      SELECT 
        a.id,
        a.title,
        a.instructor,
        a.start_time,
        a.end_time,
        a.day_of_week,
        a.activity_date,
        a.location,
        a.max_capacity,
        a.is_active,
        COALESCE(COUNT(att.id), 0)::INT AS enrolled_count
      FROM signtrue.activities a
      LEFT JOIN signtrue.attendance att 
        ON a.id = att.activity_id 
        AND att.activity_date = $1
      WHERE a.activity_date = $1 
      GROUP BY a.id
      ORDER BY a.start_time ASC
    `;

    const result = await pool.query(query, [date]);

    // DEBUG LOG: Print the exact first row returned by Postgres
    if (result.rows.length > 0) {
      console.log("DB RAW ROW SAMPLE WITH ENROLLED COUNT:", result.rows[0]);
    }
    
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch activities by date error:", err);
    res.status(500).json({ error: "Error fetching activities" });
  }
});

// 3. CREATE NEW ACTIVITY HERE
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
      RETURNING *;
    `;

    const values = [
      title,
      instructor,
      start_time,
      end_time,
      day_of_week,
      activity_date,
      location,
      max_capacity !== undefined && max_capacity !== null ? parseInt(max_capacity, 10) : 20
    ];

    const result = await pool.query(query, values);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Create Activity Error:", err);
    res.status(500).json({ error: "Could not create activity" });
  }
});

// 3B. UPDATE EXISTING ACTIVITY HERE
app.put('/signtrue/activities/:id', checkSecretKey, async (req, res) => {
  const { id } = req.params;
  const {
    title,
    instructor,
    start_time,
    end_time,
    day_of_week,
    activity_date,
    location,
    max_capacity,
    is_active
  } = req.body;

  try {
    const query = `
      UPDATE signtrue.activities 
      SET 
        title = $1, 
        instructor = $2, 
        start_time = $3, 
        end_time = $4, 
        day_of_week = $5, 
        activity_date = $6, 
        location = $7, 
        max_capacity = $8,
        is_active = COALESCE($9, is_active)
      WHERE id = $10
      RETURNING *;
    `;

    const values = [
      title,
      instructor,
      start_time,
      end_time,
      day_of_week,
      activity_date,
      location,
      max_capacity !== undefined && max_capacity !== null ? parseInt(max_capacity, 10) : 20,
      is_active !== undefined ? is_active : true,
      id
    ];

    const result = await pool.query(query, values);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Activity not found" });
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error("Update Activity Error:", err);
    res.status(500).json({ error: "Could not update activity" });
  }
});


// 4. GET ENROLLMENT FOR ACTIVITY BY DATE
app.get('/signtrue/attendance/activity/:activityId', checkSecretKey, async (req, res) => {
  const { activityId } = req.params;
  const { date } = req.query; // Capture optional date query param

  try {
    let query = `
      SELECT 
        a.id,
        a.student_id,
        a.status,
        a.activity_date,
        COALESCE(u.first_name, '') AS first_name,
        COALESCE(u.last_name, '') AS last_name,
        COALESCE(u.local_id, a.student_id) AS local_id,
        COALESCE(
          NULLIF(TRIM(u.first_name || ' ' || u.last_name), ''),
          u.chosen_name,
          'Student'
        ) || ' (ID: ' || COALESCE(u.local_id, a.student_id) || ')' AS student_name
      FROM signtrue.attendance a
      LEFT JOIN signtrue.users u ON a.student_id = u.local_id
      WHERE a.activity_id = $1
    `;

    const queryParams = [activityId];

    if (date) {
      query += ` AND a.activity_date = $2`;
      queryParams.push(date);
    }

    query += `
      ORDER BY 
        COALESCE(u.last_name, '') ASC,
        COALESCE(u.first_name, '') ASC
    `;

    const result = await pool.query(query, queryParams);
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch roster error:", err);
    res.status(500).json({ error: "Error fetching roster" });
  }
});

// 5. RECORD / UPDATE ATTENDANCE (UPSERT)
app.post('/signtrue/attendance/record', checkSecretKey, async (req, res) => {
  const { student_id, activity_id, teacher_id, activity_date, status } = req.body;

  try {
    // Check if student registered for a DIFFERENT activity on this date
    const externalCheck = await pool.query(
      `SELECT id, activity_id FROM signtrue.attendance 
       WHERE student_id = $1 AND activity_date = $2 AND activity_id != $3`,
      [student_id, activity_date, activity_id]
    );

    if (externalCheck.rows.length > 0) {
      return res.status(409).json({ error: "Already registered for a different class on this date" });
    }

    // Insert or Update (UPSERT) status for the current activity
    const query = `
      INSERT INTO signtrue.attendance 
      (student_id, activity_id, teacher_id, activity_date, status)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (student_id, activity_date) 
      DO UPDATE SET 
        status = EXCLUDED.status,
        teacher_id = EXCLUDED.teacher_id,
        activity_id = EXCLUDED.activity_id
      RETURNING *
    `;

    const result = await pool.query(query, [
      student_id,
      activity_id,
      teacher_id,
      activity_date,
      status || 'Pending'
    ]);

    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error("Attendance error:", err);
    res.status(500).json({ error: "Attendance failed" });
  }
});

// 5B. GET STUDENT REGISTRATIONS BY DATE
app.get('/signtrue/attendance/student/:studentId', checkSecretKey, async (req, res) => {
  const { studentId } = req.params;
  const { date } = req.query;

  try {
    const query = `
      SELECT activity_id 
      FROM signtrue.attendance 
      WHERE student_id = $1 
        AND activity_date = $2
    `;

    const result = await pool.query(query, [studentId, date]);

    // Returns array of objects formatted as: [{ activity_id: 12 }, ...]
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch student registrations error:", err);
    res.status(500).json({ error: "Error fetching student registrations" });
  }
});


// 5C. GET ATTENDANCE/ENROLLMENT REPORT BY DATE RANGE
app.get('/signtrue/attendance/report', checkSecretKey, async (req, res) => {
  const { start_date, end_date } = req.query;

  console.log("=== REPORT REQUEST ===");
  console.log("Params:", { start_date, end_date });

  if (!start_date || !end_date) {
    return res.status(400).json({
      error: "Missing required query parameters: start_date and end_date"
    });
  }

  try {
    const query = `
      SELECT 
        att.student_id AS student_id,
        COALESCE(u.first_name, '') AS first_name,
        COALESCE(u.last_name, '') AS last_name,
        a.title AS class,
        a.start_time,
        a.end_time,
        att.activity_date
      FROM signtrue.attendance att
      JOIN signtrue.activities a 
        ON att.activity_id::text = a.id::text
      LEFT JOIN signtrue.users u 
        ON att.student_id::text = u.local_id::text
      WHERE att.activity_date::date BETWEEN $1::date AND $2::date
      ORDER BY att.activity_date DESC, a.title ASC, u.last_name ASC;
    `;

    const result = await pool.query(query, [start_date, end_date]);
    console.log(`Found ${result.rows.length} attendance/enrollment records.`);
    
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch attendance report error:", err);
    res.status(500).json({ error: "Error fetching attendance report" });
  }
});


// 6. SCHOOLS LIST (UPDATED STRUCTURAL RESPONSE)
app.get('/signtrue/schools-list', checkSecretKey, async (req, res) => {
  try {
    // Modified to extract both the row id and name mapping
    const result = await pool.query(
      `SELECT id, name FROM signtrue.schools ORDER BY name ASC`
    );

    // Directly respond with array of structured data maps: [{id: 1, name: "School"}, ...]
    res.json(result.rows);
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
      (
        resource_id,
        user_id,
        reservation_date,
        start_time,
        end_time,
        status,
        notes
      )
      VALUES ($1, $2, $3, $4, $5, 'approved', $6)
      RETURNING *
      `,
      [
        resource_id,
        user_id,
        reservation_date,
        start_time,
        end_time,
        notes || null
      ]
    );
    
    const reservation = result.rows[0];
    
    // =====================================================
    // FETCH RESOURCE NAME
    // =====================================================
    
    const resourceResult = await pool.query(
      `
      SELECT name
      FROM signtrue.resources
      WHERE id = $1
      `,
      [resource_id]
    );
    
    const resourceName =
      resourceResult.rows[0]?.name || 'Reservation';

    const userResult = await pool.query(
      `
      SELECT first_name, last_name
      FROM signtrue.users
      WHERE id = $1
      `,
      [user_id]
    );
    
    const staffName = `${userResult.rows[0]?.first_name || ''} ${userResult.rows[0]?.last_name || ''}`.trim() || 'Staff member';

  // =====================================================
  // GET SCHOOL GOOGLE CALENDAR ID
  // =====================================================
  
  const schoolCalendarResult = await pool.query(
    `
    SELECT s.google_calendar_id
    FROM signtrue.users u
    JOIN signtrue.schools s
      ON s.id = u.school_id
    WHERE u.id = $1
    `,
    [user_id]
  );
  
  const schoolCalendarId =
    schoolCalendarResult.rows[0]?.google_calendar_id;
  
  // =====================================================
  // CREATE GOOGLE CALENDAR EVENT
  // =====================================================
  
  try {
    const calendarEvent = await createCalendarEvent({
  
      summary: `${resourceName} - ${staffName}`,
  
      description:
        notes
          ? `Reserved by: ${staffName}\nPurpose: ${notes}`
          : `Reserved by: ${staffName}`,
  
      startDateTime: buildReservationDateTime(
        reservation_date,
        start_time
      ),
  
      endDateTime: buildReservationDateTime(
        reservation_date,
        end_time
      ),
  
      calendarId: schoolCalendarId,
  
    });
    
    // =====================================================
    // SAVE GOOGLE EVENT ID
    // =====================================================
    
      await pool.query(
        `
        UPDATE signtrue.reservations
        SET google_event_id = $1
        WHERE id = $2
        `,
        [calendarEvent.id, reservation.id]
      );
    
      reservation.google_event_id = calendarEvent.id;
    } catch (calendarErr) {
      console.error("Google Calendar sync failed:", calendarErr);
    }
    
    res.status(201).json(reservation);
    

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

// 12. UPDATE RESERVATION DETAILS
app.patch('/signtrue/reservations/:reservationId', checkSecretKey, async (req, res) => {
  const { reservationId } = req.params;
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
      UPDATE signtrue.reservations
      SET
        resource_id = $1,
        reservation_date = $2,
        start_time = $3,
        end_time = $4,
        notes = $5
      WHERE id = $6
        AND user_id = $7
        AND status IN ('pending', 'approved')
      RETURNING *
      `,
      [
        resource_id,
        reservation_date,
        start_time,
        end_time,
        notes || null,
        reservationId,
        user_id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Reservation not found or not owned by user"
      });
    }
    
    const reservation = result.rows[0];

    console.log("Updated reservation ID:", reservation.id);
    console.log("Google event ID on update:", reservation.google_event_id);
    
    try {
    
      // =====================================================
      // FETCH RESOURCE NAME
      // =====================================================
    
      const resourceResult = await pool.query(
        `
        SELECT name
        FROM signtrue.resources
        WHERE id = $1
        `,
        [resource_id]
      );
    
      const resourceName =
        resourceResult.rows[0]?.name || 'Reservation';
    
      // =====================================================
      // FETCH STAFF NAME
      // =====================================================
    
      const userResult = await pool.query(
        `
        SELECT first_name, last_name
        FROM signtrue.users
        WHERE id = $1
        `,
        [user_id]
      );
    
      const staffName =
        `${userResult.rows[0]?.first_name || ''} ${userResult.rows[0]?.last_name || ''}`.trim()
        || 'Staff member';
    
      // =====================================================
      // UPDATE GOOGLE CALENDAR EVENT
      // =====================================================
    
      if (reservation.google_event_id) {

        console.log("Attempting Google Calendar update...");
    
        await updateCalendarEvent({
          eventId: reservation.google_event_id,
    
          summary: `${resourceName} - ${staffName}`,
    
          description:
            notes
              ? `Reserved by: ${staffName}\nPurpose: ${notes}`
              : `Reserved by: ${staffName}`,
    
          startDateTime: buildReservationDateTime(
            reservation_date,
            start_time
          ),
    
          endDateTime: buildReservationDateTime(
            reservation_date,
            end_time
          ),
        });
      }
    
    } catch (calendarErr) {
    
      console.error(
        "Google Calendar update failed:",
        calendarErr
      );
    }
    
    res.json(reservation);
    
  } catch (err) {
    console.error("Update reservation details error:", err);

    if (err.constraint === 'no_overlapping_reservations') {
      return res.status(409).json({ error: "Time slot already reserved" });
    }

    res.status(500).json({ error: "Could not update reservation" });
  }
});

// 13. CANCEL / DELETE USER RESERVATION
app.patch('/signtrue/reservations/:reservationId/cancel', checkSecretKey, async (req, res) => {
  const { reservationId } = req.params;
  const { user_id } = req.body;

  try {
    const result = await pool.query(
      `
      UPDATE signtrue.reservations
      SET status = 'cancelled'
      WHERE id = $1
        AND user_id = $2
        AND status IN ('pending', 'approved')
      RETURNING *
      `,
      [reservationId, user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Reservation not found or not owned by user"
      });
    }
    
    const reservation = result.rows[0];
    
    try {
      if (reservation.google_event_id) {
        console.log("Deleting Google Calendar event:", reservation.google_event_id);
    
        await deleteCalendarEvent({
          eventId: reservation.google_event_id,
        });
      }
    } catch (calendarErr) {
      console.error("Google Calendar delete failed:", calendarErr);
    }
    
    res.json(reservation);

  } catch (err) {
    console.error("Cancel reservation error:", err);
    res.status(500).json({ error: "Could not cancel reservation" });
  }
});

// 14. STAFF REGISTRATION ROUTE 
app.post('/signtrue/register-staff', async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      chosen_name,
      email,
      username,
      password,
      school_id,
      local_id
    } = req.body;

    if (
      !first_name ||
      !last_name ||
      !email ||
      !username ||
      !password ||
      !school_id ||
      !local_id
    ){
      return res.status(400).json({
        success: false,
        message: 'Missing required registration fields.'
      });
    }

    const existingUser = await pool.query(
      `
      SELECT id
      FROM signtrue.users
      WHERE LOWER(email) = LOWER($1)
         OR LOWER(username) = LOWER($2)
      LIMIT 1
      `,
      [email, username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email or username already exists.'
      });
    }

    const bcrypt = require('bcryptjs');
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `
      INSERT INTO signtrue.users (
        local_id,
        first_name,
        last_name,
        chosen_name,
        email,
        username,
        password_hash,
        role,
        school_id,
        is_active,
        approval_status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'staff', $8, false, 'pending')
      RETURNING id, local_id, first_name, last_name, email, username, role, school_id, is_active, approval_status
      `,
      [
        local_id,
        first_name,
        last_name,
        chosen_name || null,
        email,
        username,
        passwordHash,
        school_id
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Registration submitted. Please wait for admin approval.',
      user: result.rows[0]
    });

  } catch (err) {
    console.error('Staff registration error:', err);
    return res.status(500).json({
      success: false,
      message: 'Server error during staff registration.'
    });
  }
});

// 15. GET USERS FOR ADMIN APPROVAL
app.get('/signtrue/admin/users/:schoolId', checkSecretKey, async (req, res) => {
  const { schoolId } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT
        id,
        local_id,
        first_name,
        last_name,
        chosen_name,
        email,
        username,
        role,
        school_id,
        is_active,
        approval_status,
        created_at
      FROM signtrue.users
      WHERE school_id = $1
        AND role = 'staff'
      ORDER BY 
        CASE 
          WHEN approval_status = 'pending' THEN 1
          WHEN approval_status = 'approved' THEN 2
          WHEN approval_status = 'denied' THEN 3
          ELSE 4
        END,
        created_at DESC
      `,
      [schoolId]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error('Admin fetch users error:', err);
    return res.status(500).json({
      error: 'Error fetching users'
    });
  }
});


// 16. UPDATE STAFF APPROVAL STATUS
app.patch('/signtrue/admin/users/:userId/approval', checkSecretKey, async (req, res) => {
  const { userId } = req.params;
  const { approval_status } = req.body;

  const allowedStatuses = ['pending', 'approved', 'denied'];

  if (!allowedStatuses.includes(approval_status)) {
    return res.status(400).json({
      error: 'Invalid approval status'
    });
  }

  const isActive = approval_status === 'approved';

  try {
    const result = await pool.query(
      `
      UPDATE signtrue.users
      SET
        approval_status = $1,
        is_active = $2
      WHERE id = $3
        AND role = 'staff'
      RETURNING
        id,
        local_id,
        first_name,
        last_name,
        email,
        username,
        role,
        school_id,
        is_active,
        approval_status
      `,
      [approval_status, isActive, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Staff user not found'
      });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Admin update approval error:', err);
    return res.status(500).json({
      error: 'Error updating user approval status'
    });
  }
});

//=========================
// Forgot Password route
//=========================
app.post('/signtrue/forgot-password', async (req, res) => {
  const { email } = req.body;

  try {
    // Always return the same public message for security.
    const publicResponse = {
      success: true,
      message: 'If this email exists, a reset code has been sent.',
    };

    if (!email) {
      return res.json(publicResponse);
    }

    const normalizedEmail = email.trim().toLowerCase();

    const userResult = await pool.query(
      `
      SELECT id, email, first_name
      FROM signtrue.users
      WHERE LOWER(email) = $1
        AND role = 'staff'
        AND is_active = true
      LIMIT 1
      `,
      [normalizedEmail]
    );

    if (userResult.rows.length === 0) {
      return res.json(publicResponse);
    }

    const user = userResult.rows[0];

    const code = Math.floor(100000 + Math.random() * 900000).toString();

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await pool.query(
      `
      INSERT INTO signtrue.password_reset_codes
        (user_id, email, code, expires_at, used)
      VALUES ($1, $2, $3, $4, false)
      `,
      [user.id, normalizedEmail, code, expiresAt]
    );

    // TEMPORARY TEST ONLY:
    // For now, print the code in Render logs so we can test before email setup.

  console.log("Generated reset code:", code);
    
  try {
    
    console.log("SMTP HOST:", smtpHost);
    console.log("SMTP PORT:", smtpPort);
    console.log("SMTP USER exists:", !!smtpUser);
    console.log("SMTP PASS exists:", !!smtpPass);
    console.log("SMTP FROM:", smtpFrom);
    
    await transporter.sendMail({     
      from: `"SignTrue Support" <${smtpFrom}>`,
     
      to: normalizedEmail,
      subject: 'Your Sacred Heart RVA SignTrue Password Reset Code',
      html: `
        <div style="
          font-family: Arial, sans-serif;
          padding: 24px;
          background-color: #f4f5f7;
          color: #222;
        ">
          <h2 style="color:#8B4513;">
            SignTrue Password Recovery
          </h2>
  
          <p>Hello ${user.first_name || 'User'},</p>
  
          <p>Your password reset code is:</p>
  
          <div style="
            font-size: 34px;
            font-weight: bold;
            letter-spacing: 5px;
            color: #CD7F32;
            margin: 24px 0;
          ">
            ${code}
          </div>
  
          <p>This code expires in 10 minutes.</p>
  
          <p>
            If you did not request this password reset,
            you may safely ignore this email.
          </p>
        </div>
      `,
    });
  
    console.log("Password reset email sent successfully.");
  } catch (emailErr) {
    console.error("PASSWORD RESET EMAIL ERROR:", emailErr);
  
    return res.status(500).json({
      success: false,
      message: "Server error while sending password reset email.",
      error: emailErr.message,
    });
  }
      
    
    return res.json(publicResponse);
  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({
      success: false,
      message: 'Server error while requesting password reset.',
    });
  }
});

// ======================================================
// RESET PASSWORD
// ======================================================
app.post('/signtrue/reset-password', async (req, res) => {
  const { email, code, newPassword } = req.body;

  try {
    if (!email || !code || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Email, code, and new password are required.',
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters.',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedCode = code.trim();

    const resetResult = await pool.query(
      `
      SELECT id, user_id
      FROM signtrue.password_reset_codes
      WHERE LOWER(email) = $1
        AND code = $2
        AND used = false
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [normalizedEmail, normalizedCode]
    );

    if (resetResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset code.',
      });
    }

    const resetRecord = resetResult.rows[0];

    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await pool.query(
      `
      UPDATE signtrue.users
      SET password_hash = $1
      WHERE id = $2
      `,
      [hashedPassword, resetRecord.user_id]
    );

    await pool.query(
      `
      UPDATE signtrue.password_reset_codes
      SET used = true
      WHERE id = $1
      `,
      [resetRecord.id]
    );

    return res.json({
      success: true,
      message: 'Password reset successfully.',
    });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({
      success: false,
      message: 'Server error while resetting password.',
    });
  }
});

// ===========================================================================
// USER MANAGEMENT ROUTES (SignTrue)
// ===========================================================================

// 17. GET ALL USERS (Roster List)
app.get('/signtrue/users', checkSecretKey, async (req, res) => {
  try {
    const query = `
      SELECT 
        id, 
        local_id, 
        first_name, 
        last_name, 
        email, 
        class_grade, 
        role,
        is_active,
        school_id
      FROM signtrue.users 
      ORDER BY last_name ASC, first_name ASC;
    `;
    const result = await pool.query(query);
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error fetching users:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// 18. CREATE A NEW USER (With Password Hashing)
app.post('/signtrue/users', checkSecretKey, async (req, res) => {
  const { 
    local_id, 
    first_name, 
    last_name, 
    email, 
    class_grade, 
    role, 
    school_id, 
    password 
  } = req.body;

  if (!local_id || !first_name || !last_name) {
    return res.status(400).json({ 
      error: 'Missing required fields: local_id, first_name, last_name' 
    });
  }

  try {
    const bcrypt = require('bcryptjs');
    // Hash provided password or fall back to local_id as default password
    const rawPassword = password && password.trim() !== '' ? password : local_id.toString();
    const passwordHash = await bcrypt.hash(rawPassword, 10);

    const query = `
      INSERT INTO signtrue.users (
        local_id, 
        first_name, 
        last_name, 
        email, 
        class_grade, 
        role,
        school_id,
        password_hash,
        is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
      RETURNING id, local_id, first_name, last_name, email, class_grade, role, school_id, is_active;
    `;

    const values = [
      local_id, 
      first_name, 
      last_name, 
      email || null, 
      class_grade || null, 
      role || 'student',
      school_id || 1,
      passwordHash
    ];

    const result = await pool.query(query, values);
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating user:', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'User with this Local ID or Email already exists.' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// 19. UPDATE AN EXISTING USER (With Optional Password Hashing)
app.put('/signtrue/users/:id', checkSecretKey, async (req, res) => {
  const { id } = req.params;
  const { 
    local_id, 
    first_name, 
    last_name, 
    email, 
    class_grade, 
    role, 
    school_id, 
    is_active,
    password 
  } = req.body;

  try {
    const bcrypt = require('bcryptjs');

    // If a new password is provided, hash it; otherwise leave password_hash unchanged
    let updateQuery;
    let values;

    if (password && password.trim() !== '') {
      const passwordHash = await bcrypt.hash(password, 10);
      updateQuery = `
        UPDATE signtrue.users
        SET 
          local_id = $1,
          first_name = $2,
          last_name = $3,
          email = $4,
          class_grade = $5,
          role = $6,
          school_id = COALESCE($7, school_id),
          is_active = COALESCE($8, is_active),
          password_hash = $9
        WHERE id = $10
        RETURNING id, local_id, first_name, last_name, email, class_grade, role, school_id, is_active;
      `;
      values = [
        local_id, 
        first_name, 
        last_name, 
        email || null, 
        class_grade || null, 
        role || 'student',
        school_id || null,
        is_active !== undefined ? is_active : null,
        passwordHash,
        id
      ];
    } else {
      updateQuery = `
        UPDATE signtrue.users
        SET 
          local_id = $1,
          first_name = $2,
          last_name = $3,
          email = $4,
          class_grade = $5,
          role = $6,
          school_id = COALESCE($7, school_id),
          is_active = COALESCE($8, is_active)
        WHERE id = $9
        RETURNING id, local_id, first_name, last_name, email, class_grade, role, school_id, is_active;
      `;
      values = [
        local_id, 
        first_name, 
        last_name, 
        email || null, 
        class_grade || null, 
        role || 'student',
        school_id || null,
        is_active !== undefined ? is_active : null,
        id
      ];
    }

    const result = await pool.query(updateQuery, values);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Error updating user:', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Local ID or Email is already in use by another user.' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
});


// ===========================================================================
// SERVER START
// ===========================================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`SignTrue Server Active on Port ${PORT}`);
});






