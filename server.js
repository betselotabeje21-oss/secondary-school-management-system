const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const nodemailer = require('nodemailer');
const { OAuth2Client } = require('google-auth-library');
const { rateLimit } = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_TITLE = 'Secondary School – Student Information Management System';
const db = new Database(path.join(__dirname, 'school.db'));
db.pragma('journal_mode = WAL');
db.exec('CREATE TABLE IF NOT EXISTS session_store (sid TEXT PRIMARY KEY, session_json TEXT NOT NULL, expires_at INTEGER NOT NULL)');
db.prepare('DELETE FROM session_store WHERE expires_at <= ?').run(Date.now());

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/icons', express.static(path.join(__dirname, 'node_modules', 'lucide-static', 'icons'), { maxAge: '7d' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const profileUploadDir = path.join(uploadDir, 'profile');
if (!fs.existsSync(profileUploadDir)) fs.mkdirSync(profileUploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: function (_, __, cb) {
    cb(null, uploadDir);
  },
  filename: function (_, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname || '.png');
    cb(null, unique + ext);
  }
});
const upload = multer({ storage });
const profileStorage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, profileUploadDir),
  filename: (_, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname || '').toLowerCase());
  }
});
const profileUpload = multer({
  storage: profileStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_, file, cb) => {
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (!allowed.has(file.mimetype) || !['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) {
      return cb(new Error('Choose a JPG, PNG, or WEBP image under 5 MB.'));
    }
    cb(null, true);
  }
});
const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() || '';
const googleOAuthClient = googleClientId ? new OAuth2Client(googleClientId) : null;
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_, res) => renderLogin(res, { status: 429, error: 'Too many sign-in attempts. Wait a few minutes and try again.' })
});
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_, res) => renderRegistration(res, { status: 429, error: 'Too many account creation attempts. Try again later.' })
});
const googleLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_, res) => res.status(429).json({ error: 'Too many Google sign-in attempts. Try again later.' })
});
const recoveryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_, res) => res.status(429).render('forgot-password', {
    title: 'Forgot password', error: 'Too many recovery requests. Try again later.', notice: '', email: '', settings: getSettings()
  })
});
const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_, res) => res.status(429).render('reset-password', {
    title: 'Reset password', error: 'Too many password updates. Try again later.', token: '', settings: getSettings()
  })
});

const sessionSecret = process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'local-development-only-secret-change-before-deploy');
if (!sessionSecret) {
  throw new Error('SESSION_SECRET must be configured when NODE_ENV=production.');
}

class SQLiteSessionStore extends session.Store {
  constructor(database) {
    super();
    this.database = database;
    this.insert = database.prepare('INSERT INTO session_store (sid, session_json, expires_at) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET session_json = excluded.session_json, expires_at = excluded.expires_at');
    this.select = database.prepare('SELECT session_json, expires_at FROM session_store WHERE sid = ?');
    this.remove = database.prepare('DELETE FROM session_store WHERE sid = ?');
  }

  get(sessionId, callback) {
    try {
      const row = this.select.get(sessionId);
      if (!row || row.expires_at <= Date.now()) {
        if (row) this.remove.run(sessionId);
        return callback(null, null);
      }
      callback(null, JSON.parse(row.session_json));
    } catch (error) {
      callback(error);
    }
  }

  set(sessionId, value, callback) {
    try {
      const expiry = value.cookie?.expires
        ? new Date(value.cookie.expires).getTime()
        : Date.now() + (value.cookie?.originalMaxAge || 12 * 60 * 60 * 1000);
      this.insert.run(sessionId, JSON.stringify(value), expiry);
      if (callback) callback(null);
    } catch (error) {
      if (callback) callback(error);
    }
  }

  touch(sessionId, value, callback) {
    this.set(sessionId, value, callback);
  }

  destroy(sessionId, callback) {
    try {
      this.remove.run(sessionId);
      if (callback) callback(null);
    } catch (error) {
      if (callback) callback(error);
    }
  }
}

app.use(session({
  store: new SQLiteSessionStore(db),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 60 * 60 * 1000
  }
}));

const todayISO = () => new Date().toISOString().slice(0, 10);
const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const schoolDefaults = {
  school_name: APP_TITLE,
  logo_path: '',
  address: 'Addis Ababa, Ethiopia',
  phone: '+251 911 000 000',
  email: 'info@gmail.com',
  academic_year: '2025/2026',
  pass_mark: 50,
  grading_scale: 'A:90-100,B:80-89,C:70-79,D:60-69,F:0-59'
};

function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS school_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      school_name TEXT DEFAULT 'Secondary School – Student Information Management System',
      logo_path TEXT DEFAULT '',
      address TEXT DEFAULT 'Addis Ababa, Ethiopia',
      phone TEXT DEFAULT '+251 911 000 000',
      email TEXT DEFAULT 'info@gmail.com',
      academic_year TEXT DEFAULT '2025/2026',
      pass_mark INTEGER DEFAULT 50,
      grading_scale TEXT DEFAULT 'A:90-100,B:80-89,C:70-79,D:60-69,F:0-59'
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT UNIQUE,
      password_hash TEXT,
      role TEXT CHECK(role IN ('admin','teacher','student','parent')),
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT UNIQUE,
      first_name TEXT,
      middle_name TEXT,
      last_name TEXT,
      gender TEXT,
      dob TEXT,
      address TEXT,
      phone TEXT,
      parent_name TEXT,
      parent_phone TEXT,
      emergency_contact TEXT,
      admission_date TEXT,
      grade TEXT,
      section TEXT,
      academic_year TEXT,
      enrollment_status TEXT DEFAULT 'Active',
      photo TEXT,
      user_id INTEGER UNIQUE,
      parent_user_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id TEXT UNIQUE,
      first_name TEXT,
      last_name TEXT,
      gender TEXT,
      phone TEXT,
      email TEXT,
      qualification TEXT,
      subject TEXT,
      assigned_grade TEXT,
      status TEXT DEFAULT 'Active',
      user_id INTEGER UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      grade TEXT,
      section TEXT,
      class_teacher_id INTEGER,
      capacity INTEGER DEFAULT 40,
      academic_year TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      grade TEXT,
      teacher_id INTEGER,
      academic_year TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS student_classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER,
      class_id INTEGER,
      academic_year TEXT,
      UNIQUE(student_id, class_id, academic_year)
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER,
      class_id INTEGER,
      attendance_date TEXT,
      status TEXT CHECK(status IN ('Present','Absent','Late','Excused')),
      remark TEXT,
      recorded_by INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS examinations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      type TEXT,
      subject_id INTEGER,
      class_id INTEGER,
      academic_year TEXT,
      max_marks INTEGER DEFAULT 100,
      exam_date TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS grades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER,
      exam_id INTEGER,
      marks INTEGER,
      remark TEXT,
      entered_by INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      message TEXT,
      created_by INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUToincrement,
      description TEXT,
      type TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      event_date TEXT,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS parent_students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_user_id INTEGER,
      student_id INTEGER,
      UNIQUE(parent_user_id, student_id)
    );
  `);

  const userColumns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
  if (!userColumns.includes('profile_photo')) {
    db.exec('ALTER TABLE users ADD COLUMN profile_photo TEXT');
  }
  if (!userColumns.includes('google_sub')) {
    db.exec('ALTER TABLE users ADD COLUMN google_sub TEXT');
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL');

  db.transaction(() => {
    const legacyUsers = db.prepare("SELECT id, email FROM users WHERE lower(email) LIKE '%@bemilew.edu'").all();
    for (const account of legacyUsers) {
      const [localPart] = account.email.split('@');
      let candidate = `${localPart}@gmail.com`;
      let suffix = 0;
      while (db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(candidate, account.id)) {
        suffix += 1;
        candidate = `${localPart}+legacy${account.id}${suffix > 1 ? `-${suffix}` : ''}@gmail.com`;
      }
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(candidate, account.id);
    }
    db.prepare("UPDATE teachers SET email = replace(email, '@bemilew.edu', '@gmail.com') WHERE lower(email) LIKE '%@bemilew.edu'").run();
    db.prepare("UPDATE school_settings SET email = replace(email, '@bemilew.edu', '@gmail.com') WHERE lower(email) LIKE '%@bemilew.edu'").run();
    db.prepare('UPDATE teachers SET email = (SELECT email FROM users WHERE users.id = teachers.user_id) WHERE user_id IS NOT NULL AND EXISTS (SELECT 1 FROM users WHERE users.id = teachers.user_id)').run();
  })();

  const settingsCount = db.prepare('SELECT COUNT(*) AS count FROM school_settings').get().count;
  if (settingsCount === 0) {
    db.prepare('INSERT INTO school_settings (id, school_name, logo_path, address, phone, email, academic_year, pass_mark, grading_scale) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(1, schoolDefaults.school_name, schoolDefaults.logo_path, schoolDefaults.address, schoolDefaults.phone, schoolDefaults.email, schoolDefaults.academic_year, schoolDefaults.pass_mark, schoolDefaults.grading_scale);
  }
  db.prepare('UPDATE school_settings SET school_name = ? WHERE id = 1').run(APP_TITLE);

  if (process.env.NODE_ENV !== 'production') {
    const demoUsers = [
      ['System Administrator', 'admin@gmail.com', 'Admin123!', 'admin'],
      ['Mariam Teacher', 'teacher@gmail.com', 'Teacher123!', 'teacher'],
      ['Samuel Student', 'student@gmail.com', 'Student123!', 'student'],
      ['Helen Parent', 'parent@gmail.com', 'Parent123!', 'parent']
    ];
    const seedDemoUsers = db.transaction(() => {
      for (const [name, email, password, role] of demoUsers) {
        const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
        if (!existingUser) {
          const passwordHash = bcrypt.hashSync(password, 10);
          db.prepare('INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)')
            .run(name, email, passwordHash, role, 'active');
        }
      }
    });
    seedDemoUsers();

    const studentCount = db.prepare('SELECT COUNT(*) AS count FROM students').get().count;
    if (studentCount === 0) {
    const insertion = db.transaction(() => {
      const adminId = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@gmail.com').id;
      const teacherUserId = db.prepare('SELECT id FROM users WHERE email = ?').get('teacher@gmail.com').id;
      const parentUserId = db.prepare('SELECT id FROM users WHERE email = ?').get('parent@gmail.com').id;
      const studentUserId = db.prepare('SELECT id FROM users WHERE email = ?').get('student@gmail.com').id;

      const class1 = db.prepare('INSERT INTO classes (name, grade, section, class_teacher_id, capacity, academic_year) VALUES (?, ?, ?, ?, ?, ?)')
        .run('Grade 10 - Science', 'Grade 10', 'Science', teacherUserId, 35, '2025/2026');
      const class2 = db.prepare('INSERT INTO classes (name, grade, section, class_teacher_id, capacity, academic_year) VALUES (?, ?, ?, ?, ?, ?)')
        .run('Grade 11 - Arts', 'Grade 11', 'Arts', teacherUserId, 30, '2025/2026');

      const physics = db.prepare('INSERT INTO subjects (name, grade, teacher_id, academic_year) VALUES (?, ?, ?, ?)')
        .run('Physics', 'Grade 10', teacherUserId, '2025/2026');
      const biology = db.prepare('INSERT INTO subjects (name, grade, teacher_id, academic_year) VALUES (?, ?, ?, ?)')
        .run('Biology', 'Grade 10', teacherUserId, '2025/2026');
      const english = db.prepare('INSERT INTO subjects (name, grade, teacher_id, academic_year) VALUES (?, ?, ?, ?)')
        .run('English', 'Grade 11', teacherUserId, '2025/2026');

      const studentA = db.prepare('INSERT INTO students (student_id, first_name, middle_name, last_name, gender, dob, address, phone, parent_name, parent_phone, emergency_contact, admission_date, grade, section, academic_year, enrollment_status, photo, user_id, parent_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run('STD-0001', 'Samuel', 'Kebede', 'Bekele', 'Male', '2011-02-14', 'Bole, Addis Ababa', '+251 900 112 233', 'Helen Parent', '+251 911 111 111', '+251 900 200 300', '2024-09-15', 'Grade 10', 'Science', '2025/2026', 'Active', '', studentUserId, parentUserId);

      const studentB = db.prepare('INSERT INTO students (student_id, first_name, middle_name, last_name, gender, dob, address, phone, parent_name, parent_phone, emergency_contact, admission_date, grade, section, academic_year, enrollment_status, photo, user_id, parent_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run('STD-0002', 'Marta', 'Tesfaye', 'Alemu', 'Female', '2010-12-02', 'Piassa, Addis Ababa', '+251 900 444 555', 'Helen Parent', '+251 911 111 111', '+251 900 777 888', '2023-09-10', 'Grade 10', 'Science', '2025/2026', 'Active', '', null, parentUserId);

      const studentC = db.prepare('INSERT INTO students (student_id, first_name, middle_name, last_name, gender, dob, address, phone, parent_name, parent_phone, emergency_contact, admission_date, grade, section, academic_year, enrollment_status, photo, user_id, parent_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run('STD-0003', 'Yohannes', 'Assefa', 'Haile', 'Male', '2011-04-26', 'Kirkos, Addis Ababa', '+251 900 333 222', 'Amanuel Doe', '+251 911 222 333', '+251 900 111 222', '2024-09-16', 'Grade 11', 'Arts', '2025/2026', 'Active', '', null, null);

      db.prepare('INSERT INTO student_classes (student_id, class_id, academic_year) VALUES (?, ?, ?)').run(studentA.lastInsertRowid, class1.lastInsertRowid, '2025/2026');
      db.prepare('INSERT INTO student_classes (student_id, class_id, academic_year) VALUES (?, ?, ?)').run(studentB.lastInsertRowid, class1.lastInsertRowid, '2025/2026');
      db.prepare('INSERT INTO student_classes (student_id, class_id, academic_year) VALUES (?, ?, ?)').run(studentC.lastInsertRowid, class2.lastInsertRowid, '2025/2026');

      db.prepare('INSERT INTO parent_students (parent_user_id, student_id) VALUES (?, ?)').run(parentUserId, studentA.lastInsertRowid);
      db.prepare('INSERT INTO parent_students (parent_user_id, student_id) VALUES (?, ?)').run(parentUserId, studentB.lastInsertRowid);

      const teacherData = db.prepare('INSERT INTO teachers (teacher_id, first_name, last_name, gender, phone, email, qualification, subject, assigned_grade, status, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run('TCH-0001', 'Mariam', 'Tekle', 'Female', '+251 923 456 999', 'teacher@gmail.com', 'BSc in Physics', 'Physics', 'Grade 10', 'Active', teacherUserId);

      db.prepare('INSERT INTO attendance (student_id, class_id, attendance_date, status, remark, recorded_by) VALUES (?, ?, ?, ?, ?, ?)')
        .run(studentA.lastInsertRowid, class1.lastInsertRowid, todayISO(), 'Present', 'On time', teacherUserId);
      db.prepare('INSERT INTO attendance (student_id, class_id, attendance_date, status, remark, recorded_by) VALUES (?, ?, ?, ?, ?, ?)')
        .run(studentB.lastInsertRowid, class1.lastInsertRowid, todayISO(), 'Absent', 'Doctor appointment', teacherUserId);
      db.prepare('INSERT INTO attendance (student_id, class_id, attendance_date, status, remark, recorded_by) VALUES (?, ?, ?, ?, ?, ?)')
        .run(studentC.lastInsertRowid, class2.lastInsertRowid, todayISO(), 'Late', 'Traffic delay', teacherUserId);

      const assessment = db.prepare('INSERT INTO examinations (name, type, subject_id, class_id, academic_year, max_marks, exam_date) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('Midterm Physics', 'Midterm', physics.lastInsertRowid, class1.lastInsertRowid, '2025/2026', 100, todayISO());
      db.prepare('INSERT INTO grades (student_id, exam_id, marks, remark, entered_by) VALUES (?, ?, ?, ?, ?)')
        .run(studentA.lastInsertRowid, assessment.lastInsertRowid, 89, 'Excellent', teacherUserId);
      db.prepare('INSERT INTO grades (student_id, exam_id, marks, remark, entered_by) VALUES (?, ?, ?, ?, ?)')
        .run(studentB.lastInsertRowid, assessment.lastInsertRowid, 65, 'Good', teacherUserId);
      db.prepare('INSERT INTO grades (student_id, exam_id, marks, remark, entered_by) VALUES (?, ?, ?, ?, ?)')
        .run(studentC.lastInsertRowid, assessment.lastInsertRowid, 58, 'Needs support', teacherUserId);

      db.prepare('INSERT INTO announcements (title, message, created_by) VALUES (?, ?, ?)')
        .run('Welcome to the new term', 'Parents are reminded to attend the term briefing on Friday.', adminId);
      db.prepare('INSERT INTO announcements (title, message, created_by) VALUES (?, ?, ?)')
        .run('Science Fair', 'The school science fair registration will close next week.', adminId);

      db.prepare('INSERT INTO activities (description, type) VALUES (?, ?)')
        .run('Student portal updated with attendance records', 'System');
      db.prepare('INSERT INTO activities (description, type) VALUES (?, ?)')
        .run('Teacher added new exam marks', 'Academic');

      db.prepare('INSERT INTO events (title, event_date, description) VALUES (?, ?, ?)')
        .run('Parent-Teacher Meeting', '2025-11-10', 'Discuss academic performance and attendance.');
      db.prepare('INSERT INTO events (title, event_date, description) VALUES (?, ?, ?)')
        .run('School Anniversary', '2025-12-04', 'Annual celebration and awards ceremony.');
    });

      insertion();
    }
  }
}

initializeDatabase();

function getSettings() {
  const settings = db.prepare('SELECT * FROM school_settings WHERE id = 1').get() || { ...schoolDefaults };
  return { ...settings, school_name: APP_TITLE };
}

function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function dashboardPathForRole(role) {
  const paths = {
    admin: '/admin/dashboard',
    teacher: '/teacher/dashboard',
    student: '/student/dashboard',
    parent: '/parent/dashboard'
  };
  return paths[role] || '/dashboard';
}

function dashboardTitleForRole(role) {
  const titles = {
    admin: 'Admin Dashboard',
    teacher: 'Teacher Dashboard',
    student: 'Student Dashboard',
    parent: 'Parent Dashboard'
  };
  return `${APP_TITLE} — ${titles[role] || 'Dashboard'}`;
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isValidEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function getPasswordError(password) {
  if (typeof password !== 'string' || password.length < 10) return 'Use a password with at least 10 characters.';
  if (password.length > 128) return 'Password must be 128 characters or fewer.';
  return '';
}

function createAuthenticatedSession(req, user, rememberMe, callback) {
  const userSession = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    profile_photo: user.profile_photo || ''
  };
  if (user.role === 'student') {
    const profile = db.prepare('SELECT id FROM students WHERE user_id = ?').get(user.id);
    if (profile) userSession.student_id = profile.id;
  }
  if (user.role === 'parent') {
    const linked = db.prepare('SELECT student_id FROM parent_students WHERE parent_user_id = ? LIMIT 1').get(user.id);
    if (linked) userSession.parent_student_id = linked.student_id;
  }

  req.session.regenerate((error) => {
    if (error) return callback(error);
    req.session.user = userSession;
    req.session.cookie.maxAge = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
    req.session.save(callback);
  });
}

function createUserAccount({ name, email, password, role }) {
  if (getUserByEmail(email)) {
    const error = new Error('An account with this email already exists.');
    error.code = 'ACCOUNT_EXISTS';
    throw error;
  }
  const passwordHash = bcrypt.hashSync(password, 12);
  return db.prepare('INSERT INTO users (name, email, password_hash, role, status) VALUES (?, ?, ?, ?, ?)')
    .run(name, email, passwordHash, role, 'active');
}

function createMailTransporter() {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: smtpPort,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

function requireRole(roles) {
  return function (req, res, next) {
    const user = req.session.user;
    if (!user || !roles.includes(user.role)) {
      return res.status(403).render('error', {
        title: 'Access not allowed',
        message: 'You do not have permission to access this section.',
        user,
        settings: getSettings(),
        active: 'dashboard'
      });
    }
    next();
  };
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function getDashboardStats(year) {
  const settings = getSettings();
  const totalStudents = db.prepare('SELECT COUNT(*) AS count FROM students WHERE academic_year = ?').get(year)?.count || 0;
  const maleStudents = db.prepare('SELECT COUNT(*) AS count FROM students WHERE academic_year = ? AND gender = ?').get(year, 'Male')?.count || 0;
  const femaleStudents = db.prepare('SELECT COUNT(*) AS count FROM students WHERE academic_year = ? AND gender = ?').get(year, 'Female')?.count || 0;
  const totalTeachers = db.prepare('SELECT COUNT(*) AS count FROM teachers').get()?.count || 0;
  const totalParents = db.prepare('SELECT COUNT(DISTINCT parent_user_id) AS count FROM parent_students').get()?.count || 0;
  const totalClasses = db.prepare('SELECT COUNT(*) AS count FROM classes WHERE academic_year = ?').get(year)?.count || 0;
  const totalSubjects = db.prepare('SELECT COUNT(*) AS count FROM subjects WHERE academic_year = ?').get(year)?.count || 0;
  const studentsPresent = db.prepare('SELECT COUNT(*) AS count FROM attendance WHERE attendance_date = ? AND status = ?').get(todayISO(), 'Present')?.count || 0;
  const studentsAbsent = db.prepare('SELECT COUNT(*) AS count FROM attendance WHERE attendance_date = ? AND status = ?').get(todayISO(), 'Absent')?.count || 0;
  const lateArrivals = db.prepare('SELECT COUNT(*) AS count FROM attendance WHERE attendance_date = ? AND status = ?').get(todayISO(), 'Late')?.count || 0;
  const averageScore = db.prepare('SELECT AVG(marks) AS score FROM grades JOIN examinations ON examinations.id = grades.exam_id WHERE examinations.academic_year = ?').get(year)?.score || 0;
  const passMark = settings.pass_mark || 50;
  const passed = db.prepare('SELECT COUNT(*) AS count FROM grades JOIN examinations ON examinations.id = grades.exam_id WHERE examinations.academic_year = ? AND grades.marks >= ?').get(year, passMark)?.count || 0;
  const failed = db.prepare('SELECT COUNT(*) AS count FROM grades JOIN examinations ON examinations.id = grades.exam_id WHERE examinations.academic_year = ? AND grades.marks < ?').get(year, passMark)?.count || 0;

  return {
    totalStudents,
    maleStudents,
    femaleStudents,
    totalTeachers,
    totalParents,
    totalClasses,
    totalSubjects,
    studentsPresent,
    studentsAbsent,
    lateArrivals,
    averageScore: Number(averageScore || 0).toFixed(1),
    passed,
    failed,
    passMark
  };
}

function getAcademicYearContext(req) {
  const settings = getSettings();
  const requestedYear = req.query.year || settings.academic_year;
  return requestedYear;
}

function buildUserProfile(user) {
  if (!user) return null;
  if (user.role === 'student') {
    return db.prepare('SELECT * FROM students WHERE user_id = ?').get(user.id) || null;
  }
  if (user.role === 'teacher') {
    return db.prepare('SELECT * FROM teachers WHERE user_id = ?').get(user.id) || null;
  }
  return null;
}

function hasValidImageSignature(filePath, mimeType) {
  const bytes = fs.readFileSync(filePath);
  if (mimeType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/webp') return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

function removeStoredProfilePhoto(photoPath) {
  if (!photoPath) return;
  const filename = path.basename(photoPath);
  if (photoPath !== 'profile/' + filename && !photoPath.startsWith('/uploads/')) return;
  const filePath = photoPath.startsWith('/uploads/')
    ? path.join(uploadDir, filename)
    : path.join(profileUploadDir, filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function studentListData(year) {
  return db.prepare(`
    SELECT s.*, c.name AS class_name
    FROM students s
    LEFT JOIN student_classes sc ON sc.student_id = s.id AND sc.academic_year = s.academic_year
    LEFT JOIN classes c ON c.id = sc.class_id
    WHERE s.academic_year = ?
    ORDER BY s.created_at DESC
  `).all(year);
}

function teacherListData() {
  return db.prepare(`
    SELECT t.*, c.name AS class_name
    FROM teachers t
    LEFT JOIN classes c ON c.class_teacher_id = t.id
    ORDER BY t.created_at DESC
  `).all();
}

app.use((req, res, next) => {
  res.locals.settings = getSettings();
  const academicYears = db.prepare(`
    SELECT academic_year AS year FROM students WHERE academic_year IS NOT NULL
    UNION SELECT academic_year AS year FROM classes WHERE academic_year IS NOT NULL
    UNION SELECT academic_year AS year FROM examinations WHERE academic_year IS NOT NULL
    ORDER BY year DESC
  `).all().map((row) => row.year);
  if (!academicYears.includes(res.locals.settings.academic_year)) academicYears.unshift(res.locals.settings.academic_year);
  res.locals.academicYears = academicYears;
  res.locals.activeAcademicYear = academicYears.includes(req.query.year) ? req.query.year : res.locals.settings.academic_year;
  res.locals.user = req.session.user || null;
  res.locals.appTitle = APP_TITLE;
  res.locals.googleClientId = googleClientId;
  res.locals.dashboardPath = dashboardPathForRole(req.session.user?.role);
  if (req.session.user) {
    res.locals.userProfile = buildUserProfile(req.session.user);
  }
  next();
});

app.get('/', (req, res) => {
  res.render('home', { title: APP_TITLE });
});

app.get('/about', (req, res) => {
  res.render('about');
});

app.get('/contact', (req, res) => {
  res.render('contact');
});

function renderLogin(res, { status = 200, error = '', email = '', notice = '' } = {}) {
  return res.status(status).render('login', { title: 'Sign in', error, email, notice, googleClientId, settings: getSettings() });
}

function renderRegistration(res, { status = 200, error = '', name = '', email = '', role = 'student' } = {}) {
  return res.status(status).render('register', { title: 'Create account', error, name, email, role, googleClientId, settings: getSettings() });
}

app.get('/login', (req, res) => {
  const notice = req.query.registered === '1'
    ? 'Your account was created. Sign in to continue.'
    : req.query.reset === '1' ? 'Your password was updated. Sign in with your new password.' : '';
  renderLogin(res, { notice });
});

app.get('/register', (req, res) => {
  renderRegistration(res);
});

app.post('/register', registrationLimiter, (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const email = normalizeEmail(req.body.email);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const confirmPassword = typeof req.body.confirmPassword === 'string' ? req.body.confirmPassword : '';
  const role = typeof req.body.role === 'string' ? req.body.role : '';
  const formValues = { name, email, role };

  if (name.length < 2 || name.length > 100) return renderRegistration(res, { status: 400, error: 'Enter a name between 2 and 100 characters.', ...formValues });
  if (!isValidEmail(email)) return renderRegistration(res, { status: 400, error: 'Enter a valid email address.', ...formValues });
  if (!['student', 'parent'].includes(role)) return renderRegistration(res, { status: 400, error: 'Choose an available account role.', ...formValues });
  const passwordError = getPasswordError(password);
  if (passwordError) return renderRegistration(res, { status: 400, error: passwordError, ...formValues });
  if (password !== confirmPassword) return renderRegistration(res, { status: 400, error: 'The passwords do not match.', ...formValues });
  if (req.body.acceptTerms !== 'on') return renderRegistration(res, { status: 400, error: 'Accept the terms and conditions to create an account.', ...formValues });

  try {
    createUserAccount({ name, email, password, role });
    res.redirect('/login?registered=1');
  } catch (error) {
    if (error.code === 'ACCOUNT_EXISTS' || error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return renderRegistration(res, { status: 409, error: 'An account with this email already exists.', ...formValues });
    }
    console.error('Account registration failed:', error);
    renderRegistration(res, { status: 503, error: 'Account creation is temporarily unavailable.', ...formValues });
  }
});

app.post('/login', loginLimiter, (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!isValidEmail(email) || !password || password.length > 128) {
    return renderLogin(res, { status: 400, error: 'Enter a valid email address and password.', email });
  }

  let user;
  try {
    user = getUserByEmail(email);
    if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
      return renderLogin(res, { status: 401, error: 'Email or password is incorrect. Check your details and try again.', email });
    }
  } catch (error) {
    console.error('Login authentication failed:', error);
    return renderLogin(res, { status: 503, error: 'Sign-in is temporarily unavailable. Please try again shortly.', email });
  }

  if (user.status !== 'active') {
    return renderLogin(res, { status: 403, error: 'This account is inactive. Contact a school administrator.', email });
  }

  createAuthenticatedSession(req, user, req.body.rememberMe === 'on', (error) => {
    if (error) {
      console.error('Could not establish login session:', error);
      return renderLogin(res, { status: 503, error: 'Sign-in is temporarily unavailable. Please try again shortly.', email });
    }
    res.redirect(dashboardPathForRole(user.role));
  });
});

app.post('/auth/google', googleLimiter, async (req, res) => {
  if (!googleOAuthClient) return res.status(503).json({ error: 'Google sign-in is not configured.' });
  const credential = typeof req.body.credential === 'string' ? req.body.credential : '';
  if (!credential || credential.length > 10000) return res.status(400).json({ error: 'Google credential is invalid.' });

  try {
    const ticket = await googleOAuthClient.verifyIdToken({ idToken: credential, audience: googleClientId });
    const payload = ticket.getPayload();
    if (!payload?.email_verified || !payload.email || !payload.sub) {
      return res.status(401).json({ error: 'Google could not verify this email address.' });
    }

    const email = normalizeEmail(payload.email);
    const user = getUserByEmail(email);
    if (!user) return res.status(403).json({ error: 'Create an account with this email before continuing with Google.' });
    if (user.status !== 'active') return res.status(403).json({ error: 'This account is inactive. Contact a school administrator.' });
    if (user.google_sub && user.google_sub !== payload.sub) {
      return res.status(409).json({ error: 'A different Google account is already linked to this email.' });
    }
    if (!user.google_sub) {
      const linkResult = db.prepare('UPDATE users SET google_sub = ? WHERE id = ? AND google_sub IS NULL').run(payload.sub, user.id);
      const linkedUser = db.prepare('SELECT google_sub FROM users WHERE id = ?').get(user.id);
      if (!linkResult.changes && linkedUser?.google_sub !== payload.sub) {
        return res.status(409).json({ error: 'A different Google account is already linked to this email.' });
      }
    }

    createAuthenticatedSession(req, user, false, (error) => {
      if (error) {
        console.error('Could not establish Google login session:', error);
        return res.status(503).json({ error: 'Google sign-in is temporarily unavailable.' });
      }
      res.json({ redirect: dashboardPathForRole(user.role) });
    });
  } catch (error) {
    console.warn('Google ID token verification failed:', error.message);
    res.status(401).json({ error: 'Google sign-in could not be verified. Please try again.' });
  }
});

app.get('/forgot-password', (req, res) => {
  res.render('forgot-password', { title: 'Forgot password', error: '', notice: '', email: '', settings: getSettings() });
});

app.post('/forgot-password', recoveryLimiter, async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!isValidEmail(email)) {
    return res.status(400).render('forgot-password', { title: 'Forgot password', error: 'Enter a valid email address.', notice: '', email, settings: getSettings() });
  }

  const transporter = createMailTransporter();
  const appBaseUrl = process.env.APP_BASE_URL || (process.env.NODE_ENV === 'production' ? '' : `http://localhost:${PORT}`);
  if (!transporter || !appBaseUrl) {
    return res.render('forgot-password', {
      title: 'Forgot password',
      error: '',
      notice: 'Password recovery is not configured yet. Contact the school administrator.',
      email: '',
      settings: getSettings()
    });
  }

  const user = getUserByEmail(email);
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = Date.now() + 30 * 60 * 1000;
    const resetUrl = new URL('/reset-password', appBaseUrl);
    resetUrl.searchParams.set('token', token);
    db.transaction(() => {
      db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(user.id);
      db.prepare('INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
        .run(tokenHash, user.id, expiresAt, Date.now());
    })();

    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: user.email,
        subject: 'Reset your school account password',
        text: `Hello ${user.name},\n\nUse this one-time link to reset your password. It expires in 30 minutes.\n\n${resetUrl.toString()}\n\nIf you did not request a reset, you can ignore this email.`
      });
    } catch (error) {
      db.prepare('DELETE FROM password_reset_tokens WHERE token_hash = ?').run(tokenHash);
      console.error('Password reset email delivery failed:', error.message);
    }
  }

  res.render('forgot-password', {
    title: 'Forgot password',
    error: '',
    notice: 'If an account exists for that address, a password reset link has been sent.',
    email: '',
    settings: getSettings()
  });
});

app.get('/reset-password', (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const tokenHash = token.length === 64 ? crypto.createHash('sha256').update(token).digest('hex') : '';
  const valid = tokenHash && db.prepare('SELECT 1 FROM password_reset_tokens WHERE token_hash = ? AND expires_at > ?').get(tokenHash, Date.now());
  res.render('reset-password', {
    title: 'Reset password',
    error: valid ? '' : 'This password reset link is invalid or has expired.',
    token: valid ? token : '',
    settings: getSettings()
  });
});

app.post('/reset-password', resetPasswordLimiter, (req, res) => {
  const token = typeof req.body.token === 'string' ? req.body.token : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const confirmPassword = typeof req.body.confirmPassword === 'string' ? req.body.confirmPassword : '';
  const tokenHash = token.length === 64 ? crypto.createHash('sha256').update(token).digest('hex') : '';
  const reset = tokenHash
    ? db.prepare('SELECT user_id FROM password_reset_tokens WHERE token_hash = ? AND expires_at > ?').get(tokenHash, Date.now())
    : null;
  const passwordError = getPasswordError(password);
  if (!reset) return res.status(400).render('reset-password', { title: 'Reset password', error: 'This password reset link is invalid or has expired.', token: '', settings: getSettings() });
  if (passwordError) return res.status(400).render('reset-password', { title: 'Reset password', error: passwordError, token, settings: getSettings() });
  if (password !== confirmPassword) return res.status(400).render('reset-password', { title: 'Reset password', error: 'The passwords do not match.', token, settings: getSettings() });

  const passwordHash = bcrypt.hashSync(password, 12);
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, reset.user_id);
    db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(reset.user_id);
    const sessions = db.prepare('SELECT sid, session_json FROM session_store').all();
    for (const storedSession of sessions) {
      try {
        if (JSON.parse(storedSession.session_json).user?.id === reset.user_id) {
          db.prepare('DELETE FROM session_store WHERE sid = ?').run(storedSession.sid);
        }
      } catch (_) {
        db.prepare('DELETE FROM session_store WHERE sid = ?').run(storedSession.sid);
      }
    }
  })();
  res.redirect('/login?reset=1');
});

app.get('/logout', (req, res) => {
  if (!req.session) return res.redirect('/login');
  req.session.destroy((error) => {
    if (error) {
      console.error('Could not end login session:', error);
      return res.status(500).send('Logout could not be completed. Please try again.');
    }
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
});

function renderDashboard(req, res) {
  const year = getAcademicYearContext(req);
  const stats = getDashboardStats(year);
  const recentStudents = db.prepare('SELECT * FROM students WHERE academic_year = ? ORDER BY created_at DESC LIMIT 5').all(year);
  const recentAnnouncements = db.prepare('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 5').all();
  const upcomingExams = db.prepare('SELECT e.*, s.name AS subject_name FROM examinations e JOIN subjects s ON s.id = e.subject_id WHERE e.academic_year = ? AND e.exam_date >= ? ORDER BY e.exam_date ASC LIMIT 5').all(year, todayISO());
  const upcomingEvents = db.prepare('SELECT * FROM events WHERE event_date >= ? ORDER BY event_date ASC LIMIT 5').all(todayISO());
  const activities = db.prepare('SELECT * FROM activities ORDER BY created_at DESC LIMIT 8').all();

  const currentRole = req.session.user.role;
  const rollup = {
    ...stats,
    recentStudents,
    recentAnnouncements,
    upcomingExams,
    upcomingEvents,
    activities
  };

  if (currentRole === 'student') {
    const profile = db.prepare('SELECT * FROM students WHERE user_id = ?').get(req.session.user.id);
    const ownGrades = db.prepare(`
      SELECT g.marks, e.name, e.type, s.name AS subject_name
      FROM grades g
      JOIN examinations e ON e.id = g.exam_id
      JOIN subjects s ON s.id = e.subject_id
      WHERE g.student_id = ?
      ORDER BY e.exam_date DESC
      LIMIT 5
    `).all(profile?.id || 0);
    const ownAttendance = db.prepare('SELECT status, attendance_date FROM attendance WHERE student_id = ? ORDER BY attendance_date DESC LIMIT 5').all(profile?.id || 0);
    res.render('dashboard', { title: dashboardTitleForRole(currentRole), stats: rollup, user: req.session.user, ownGrades, ownAttendance, profile, settings: getSettings(), active: 'dashboard' });
    return;
  }

  if (currentRole === 'parent') {
    const childRows = db.prepare(`
      SELECT s.* FROM parent_students ps
      JOIN students s ON s.id = ps.student_id
      WHERE ps.parent_user_id = ?
      ORDER BY s.first_name ASC
    `).all(req.session.user.id);
    res.render('dashboard', { title: dashboardTitleForRole(currentRole), stats: rollup, user: req.session.user, childRows, settings: getSettings(), active: 'dashboard' });
    return;
  }

  res.render('dashboard', { title: dashboardTitleForRole(currentRole), stats: rollup, user: req.session.user, settings: getSettings(), active: 'dashboard' });
}

app.get('/dashboard', requireAuth, renderDashboard);
app.get('/admin/dashboard', requireAuth, requireRole(['admin']), renderDashboard);
app.get('/teacher/dashboard', requireAuth, requireRole(['teacher']), renderDashboard);
app.get('/student/dashboard', requireAuth, requireRole(['student']), renderDashboard);
app.get('/parent/dashboard', requireAuth, requireRole(['parent']), renderDashboard);

app.get('/students', requireAuth, requireRole(['admin', 'teacher']), (req, res) => {
  const year = getAcademicYearContext(req);
  const search = (req.query.search || '').trim();
  const status = req.query.status || 'All';
  const gender = req.query.gender || 'All';
  let query = `
    SELECT s.*, c.name AS class_name
    FROM students s
    LEFT JOIN student_classes sc ON sc.student_id = s.id AND sc.academic_year = s.academic_year
    LEFT JOIN classes c ON c.id = sc.class_id
    WHERE s.academic_year = ?
  `;
  const params = [year];
  if (search) {
    query += ' AND (s.student_id LIKE ? OR s.first_name LIKE ? OR s.last_name LIKE ? OR c.name LIKE ?)';
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }
  if (status !== 'All') { query += ' AND s.enrollment_status = ?'; params.push(status); }
  if (gender !== 'All') { query += ' AND s.gender = ?'; params.push(gender); }
  query += ' ORDER BY s.created_at DESC';
  const students = db.prepare(query).all(...params);
  const classes = db.prepare('SELECT * FROM classes WHERE academic_year = ? ORDER BY name ASC').all(year);
  res.render('students', { title: 'Students', students, classes, search, status, gender, user: req.session.user, settings: getSettings(), active: 'students' });
});

app.post('/students', requireAuth, requireRole(['admin', 'teacher']), upload.single('photo'), (req, res) => {
  const { first_name, middle_name, last_name, gender, dob, address, phone, parent_name, parent_phone, emergency_contact, admission_date, grade, section, academic_year, enrollment_status } = req.body;
  const studentId = `STD-${String((db.prepare('SELECT COUNT(*) AS count FROM students').get().count || 0) + 1).padStart(4, '0')}`;
  const photo = req.file ? '/uploads/' + req.file.filename : '';
  const insert = db.prepare('INSERT INTO students (student_id, first_name, middle_name, last_name, gender, dob, address, phone, parent_name, parent_phone, emergency_contact, admission_date, grade, section, academic_year, enrollment_status, photo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const result = insert.run(studentId, first_name, middle_name || '', last_name, gender, dob, address, phone, parent_name, parent_phone, emergency_contact, admission_date, grade, section, academic_year || getSettings().academic_year, enrollment_status || 'Active', photo);

  const addedStudentId = result.lastInsertRowid;
  const className = `${grade} - ${section}`;
  const classRow = db.prepare('SELECT id FROM classes WHERE name = ? AND academic_year = ?').get(className, academic_year || getSettings().academic_year);
  if (classRow) {
    db.prepare('INSERT OR IGNORE INTO student_classes (student_id, class_id, academic_year) VALUES (?, ?, ?)').run(addedStudentId, classRow.id, academic_year || getSettings().academic_year);
  }
  db.prepare('INSERT INTO activities (description, type) VALUES (?, ?)').run(`New student registered: ${first_name} ${last_name}`, 'Student');
  res.redirect('/students');
});

app.get('/students/:id', requireAuth, (req, res) => {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!student) return res.status(404).render('error', { title: 'Student not found', message: 'The requested student was not found.', user: req.session.user, settings: getSettings(), active: 'students' });

  const userRole = req.session.user.role;
  if (userRole === 'student' && student.user_id !== req.session.user.id) {
    return res.status(403).render('error', { title: 'Access denied', message: 'You can only view your own student profile.', user: req.session.user, settings: getSettings(), active: 'students' });
  }

  if (userRole === 'parent') {
    const linked = db.prepare('SELECT 1 FROM parent_students WHERE parent_user_id = ? AND student_id = ?').get(req.session.user.id, student.id);
    if (!linked) {
      return res.status(403).render('error', { title: 'Access denied', message: 'This student record is not linked to your parent account.', user: req.session.user, settings: getSettings(), active: 'students' });
    }
  }

  const attendance = db.prepare('SELECT * FROM attendance WHERE student_id = ? ORDER BY attendance_date DESC LIMIT 10').all(student.id);
  const records = db.prepare(`
    SELECT g.marks, e.name AS exam_name, s.name AS subject_name, e.type AS exam_type
    FROM grades g
    JOIN examinations e ON e.id = g.exam_id
    JOIN subjects s ON s.id = e.subject_id
    WHERE g.student_id = ?
    ORDER BY e.exam_date DESC
  `).all(student.id);
  const classInfo = db.prepare(`
    SELECT c.* FROM student_classes sc JOIN classes c ON c.id = sc.class_id WHERE sc.student_id = ? ORDER BY sc.academic_year DESC LIMIT 1
  `).get(student.id);
  res.render('student-profile', { title: 'Student Profile', student, attendance, records, classInfo, user: req.session.user, settings: getSettings(), active: 'students' });
});

app.post('/students/:id/delete', requireAuth, requireRole(['admin']), (req, res) => {
  db.prepare('DELETE FROM students WHERE id = ?').run(req.params.id);
  res.redirect('/students');
});

app.get('/teachers', requireAuth, requireRole(['admin', 'teacher']), (req, res) => {
  const search = (req.query.search || '').trim();
  const teachers = search
    ? db.prepare(`
        SELECT t.*, c.name AS class_name
        FROM teachers t
        LEFT JOIN classes c ON c.class_teacher_id = t.id
        WHERE t.first_name LIKE ? OR t.last_name LIKE ? OR t.teacher_id LIKE ? OR t.subject LIKE ?
        ORDER BY t.created_at DESC
      `).all(...Array(4).fill(`%${search}%`))
    : teacherListData();
  const classes = db.prepare('SELECT * FROM classes ORDER BY name ASC').all();
  res.render('teachers', { title: 'Teachers', teachers, classes, search, user: req.session.user, settings: getSettings(), active: 'teachers' });
});

app.post('/teachers', requireAuth, requireRole(['admin']), (req, res) => {
  const { first_name, last_name, gender, phone, email, qualification, subject, assigned_grade, status } = req.body;
  const teacherId = `TCH-${String((db.prepare('SELECT COUNT(*) AS count FROM teachers').get().count || 0) + 1).padStart(4, '0')}`;
  db.prepare('INSERT INTO teachers (teacher_id, first_name, last_name, gender, phone, email, qualification, subject, assigned_grade, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(teacherId, first_name, last_name, gender, phone, email, qualification, subject, assigned_grade, status || 'Active');
  db.prepare('INSERT INTO activities (description, type) VALUES (?, ?)').run(`New teacher added: ${first_name} ${last_name}`, 'Teacher');
  res.redirect('/teachers');
});

app.get('/classes', requireAuth, requireRole(['admin', 'teacher']), (req, res) => {
  const classes = db.prepare("SELECT c.*, t.first_name || ' ' || t.last_name AS teacher_name, COUNT(sc.student_id) AS student_count FROM classes c LEFT JOIN teachers t ON t.id = c.class_teacher_id LEFT JOIN student_classes sc ON sc.class_id = c.id AND sc.academic_year = c.academic_year GROUP BY c.id ORDER BY c.created_at DESC").all();
  const teachers = db.prepare('SELECT * FROM teachers ORDER BY first_name ASC').all();
  res.render('classes', { title: 'Classes', classes, teachers, user: req.session.user, settings: getSettings(), active: 'classes' });
});

app.post('/classes', requireAuth, requireRole(['admin']), (req, res) => {
  const { name, grade, section, class_teacher_id, capacity, academic_year } = req.body;
  db.prepare('INSERT INTO classes (name, grade, section, class_teacher_id, capacity, academic_year) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name, grade, section, class_teacher_id || null, Number(capacity) || 40, academic_year || getSettings().academic_year);
  res.redirect('/classes');
});

app.get('/subjects', requireAuth, requireRole(['admin', 'teacher']), (req, res) => {
  const subjects = db.prepare(`
    SELECT s.*, t.first_name || ' ' || t.last_name AS teacher_name
    FROM subjects s
    LEFT JOIN teachers t ON t.id = s.teacher_id
    ORDER BY s.created_at DESC
  `).all();
  const teachers = db.prepare('SELECT * FROM teachers ORDER BY first_name ASC').all();
  res.render('subjects', { title: 'Subjects', subjects, teachers, user: req.session.user, settings: getSettings(), active: 'subjects' });
});

app.post('/subjects', requireAuth, requireRole(['admin']), (req, res) => {
  const { name, grade, teacher_id, academic_year } = req.body;
  db.prepare('INSERT INTO subjects (name, grade, teacher_id, academic_year) VALUES (?, ?, ?, ?)')
    .run(name, grade, teacher_id || null, academic_year || getSettings().academic_year);
  res.redirect('/subjects');
});

app.get('/attendance', requireAuth, requireRole(['admin', 'teacher']), (req, res) => {
  const year = getAcademicYearContext(req);
  const classFilter = req.query.classId || 'all';
  const dateFilter = req.query.date || todayISO();
  let attendance = [];
  if (classFilter === 'all') {
    attendance = db.prepare(`
      SELECT a.*, s.student_id, s.first_name, s.last_name, c.name AS class_name
      FROM attendance a
      JOIN students s ON s.id = a.student_id
      LEFT JOIN classes c ON c.id = a.class_id
      WHERE a.attendance_date = ? AND s.academic_year = ?
      ORDER BY s.first_name ASC
    `).all(dateFilter, year);
  } else {
    attendance = db.prepare(`
      SELECT a.*, s.student_id, s.first_name, s.last_name, c.name AS class_name
      FROM attendance a
      JOIN students s ON s.id = a.student_id
      LEFT JOIN classes c ON c.id = a.class_id
      WHERE a.attendance_date = ? AND a.class_id = ? AND s.academic_year = ?
      ORDER BY s.first_name ASC
    `).all(dateFilter, Number(classFilter), year);
  }
  const students = db.prepare('SELECT * FROM students WHERE academic_year = ? ORDER BY first_name ASC').all(year);
  const classes = db.prepare('SELECT * FROM classes WHERE academic_year = ? ORDER BY name ASC').all(year);
  res.render('attendance', { title: 'Attendance', attendance, students, classes, dateFilter, classFilter, year, user: req.session.user, settings: getSettings(), active: 'attendance' });
});

app.post('/attendance', requireAuth, requireRole(['admin', 'teacher']), (req, res) => {
  const { student_id, class_id, attendance_date, status, remark } = req.body;
  db.prepare('INSERT INTO attendance (student_id, class_id, attendance_date, status, remark, recorded_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(Number(student_id), Number(class_id), attendance_date || todayISO(), status || 'Present', remark || '', req.session.user.id);
  res.redirect('/attendance');
});

app.get('/examinations', requireAuth, requireRole(['admin', 'teacher']), (req, res) => {
  const year = getAcademicYearContext(req);
  const exams = db.prepare(`
    SELECT e.*, s.name AS subject_name, c.name AS class_name
    FROM examinations e
    JOIN subjects s ON s.id = e.subject_id
    JOIN classes c ON c.id = e.class_id
    WHERE e.academic_year = ?
    ORDER BY e.exam_date DESC
  `).all(year);
  const students = db.prepare('SELECT * FROM students WHERE academic_year = ? ORDER BY first_name ASC').all(year);
  const subjects = db.prepare('SELECT * FROM subjects WHERE academic_year = ? ORDER BY name ASC').all(year);
  const classes = db.prepare('SELECT * FROM classes WHERE academic_year = ? ORDER BY name ASC').all(year);
  res.render('examinations', { title: 'Examinations', exams, students, subjects, classes, year, user: req.session.user, settings: getSettings(), active: 'examinations' });
});

app.post('/examinations', requireAuth, requireRole(['admin', 'teacher']), (req, res) => {
  const { name, type, subject_id, class_id, academic_year, max_marks, exam_date } = req.body;
  db.prepare('INSERT INTO examinations (name, type, subject_id, class_id, academic_year, max_marks, exam_date) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(name, type, Number(subject_id), Number(class_id), academic_year || getSettings().academic_year, Number(max_marks) || 100, exam_date || todayISO());
  res.redirect('/examinations');
});

app.post('/grades', requireAuth, requireRole(['admin', 'teacher']), (req, res) => {
  const { student_id, exam_id, marks, remark } = req.body;
  db.prepare('INSERT INTO grades (student_id, exam_id, marks, remark, entered_by) VALUES (?, ?, ?, ?, ?)')
    .run(Number(student_id), Number(exam_id), Number(marks), remark || '', req.session.user.id);
  db.prepare('INSERT INTO activities (description, type) VALUES (?, ?)').run(`Marks awarded to student ID ${student_id}`, 'Result');
  res.redirect('/examinations');
});

app.get('/reports', requireAuth, (req, res) => {
  const year = getAcademicYearContext(req);
  const userRole = req.session.user.role;
  let gradesQuery = `
    SELECT g.*, e.name AS exam_name, s.name AS subject_name
    FROM grades g
    JOIN examinations e ON e.id = g.exam_id
    JOIN subjects s ON s.id = e.subject_id
    WHERE e.academic_year = ?
  `;
  const params = [year];

  if (userRole === 'student') {
    const profile = db.prepare('SELECT id FROM students WHERE user_id = ?').get(req.session.user.id);
    if (!profile) {
      return res.render('reports', { title: 'Reports', students: [], grades: [], year, user: req.session.user, settings: getSettings(), active: 'reports' });
    }
    gradesQuery += ' AND g.student_id = ?';
    params.push(profile.id);
  }

  if (userRole === 'parent') {
    const childIds = db.prepare('SELECT student_id FROM parent_students WHERE parent_user_id = ?').all(req.session.user.id).map((row) => row.student_id);
    if (!childIds.length) {
      return res.render('reports', { title: 'Reports', students: [], grades: [], year, user: req.session.user, settings: getSettings(), active: 'reports' });
    }
    gradesQuery += ' AND g.student_id IN (' + childIds.map(() => '?').join(',') + ')';
    params.push(...childIds);
  }

  gradesQuery += ' ORDER BY g.created_at DESC';
  const students = db.prepare('SELECT * FROM students WHERE academic_year = ? ORDER BY first_name ASC').all(year);
  const grades = db.prepare(gradesQuery).all(...params);
  res.render('reports', { title: 'Reports', students, grades, year, user: req.session.user, settings: getSettings(), active: 'reports' });
});

app.get('/announcements', requireAuth, (req, res) => {
  const messages = db.prepare('SELECT a.*, u.name AS author_name FROM announcements a LEFT JOIN users u ON u.id = a.created_by ORDER BY a.created_at DESC').all();
  res.render('announcements', { title: 'Announcements', messages, user: req.session.user, settings: getSettings(), active: 'announcements' });
});

app.post('/announcements', requireAuth, requireRole(['admin']), (req, res) => {
  const { title, message } = req.body;
  db.prepare('INSERT INTO announcements (title, message, created_by) VALUES (?, ?, ?)').run(title, message, req.session.user.id);
  res.redirect('/announcements');
});

function renderSchoolSettings(res, { status = 200, accountError = '', accountNotice = '', accountName = '', accountEmail = '', accountRole = 'student' } = {}) {
  return res.status(status).render('settings', {
    title: 'School Settings',
    settings: getSettings(),
    user: res.locals.user,
    accountError,
    accountNotice,
    accountName,
    accountEmail,
    accountRole,
    active: 'settings'
  });
}

app.get('/settings', requireAuth, requireRole(['admin']), (req, res) => {
  renderSchoolSettings(res, {
    accountNotice: req.query.userCreated === '1' ? 'The account was created.' : ''
  });
});

app.post('/admin/users', requireAuth, requireRole(['admin']), (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const email = normalizeEmail(req.body.email);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const role = typeof req.body.role === 'string' ? req.body.role : '';
  const values = { accountName: name, accountEmail: email, accountRole: role };
  if (name.length < 2 || name.length > 100) return renderSchoolSettings(res, { status: 400, accountError: 'Enter a name between 2 and 100 characters.', ...values });
  if (!isValidEmail(email)) return renderSchoolSettings(res, { status: 400, accountError: 'Enter a valid email address.', ...values });
  if (!['admin', 'teacher', 'student', 'parent'].includes(role)) return renderSchoolSettings(res, { status: 400, accountError: 'Choose a valid system role.', ...values });
  const passwordError = getPasswordError(password);
  if (passwordError) return renderSchoolSettings(res, { status: 400, accountError: passwordError, ...values });
  try {
    createUserAccount({ name, email, password, role });
    res.redirect('/settings?userCreated=1');
  } catch (error) {
    if (error.code === 'ACCOUNT_EXISTS' || error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return renderSchoolSettings(res, { status: 409, accountError: 'An account with this email already exists.', ...values });
    }
    console.error('Administrator account provisioning failed:', error);
    renderSchoolSettings(res, { status: 503, accountError: 'Account creation is temporarily unavailable.', ...values });
  }
});

app.post('/settings', requireAuth, requireRole(['admin']), upload.single('logo'), (req, res) => {
  const { address, phone, email, academic_year, pass_mark, grading_scale } = req.body;
  let logoPath = req.file ? '/uploads/' + req.file.filename : (req.body.logo_path || '');
  if (!logoPath) logoPath = getSettings().logo_path || '';
  db.prepare('UPDATE school_settings SET school_name = ?, address = ?, phone = ?, email = ?, academic_year = ?, pass_mark = ?, grading_scale = ?, logo_path = ? WHERE id = 1')
    .run(APP_TITLE, address, phone, email, academic_year, Number(pass_mark) || 50, grading_scale, logoPath);
  res.redirect('/settings');
});

app.get('/profile', requireAuth, (req, res) => {
  const user = req.session.user;
  const student = buildUserProfile(user);
  const teacher = user.role === 'teacher' ? db.prepare('SELECT * FROM teachers WHERE user_id = ?').get(user.id) : null;
  const children = user.role === 'parent' ? db.prepare(`
    SELECT s.* FROM parent_students ps JOIN students s ON s.id = ps.student_id WHERE ps.parent_user_id = ?
  `).all(user.id) : [];
  res.render('profile', { title: 'My Profile', student, teacher, children, user, photoError: req.query.photoError || '', settings: getSettings(), active: 'profile' });
});

app.post('/profile/photo', requireAuth, (req, res) => {
  profileUpload.single('photo')(req, res, (uploadError) => {
    if (uploadError) {
      return res.redirect('/profile?photoError=' + encodeURIComponent(uploadError.message));
    }
    if (!req.file || !hasValidImageSignature(req.file.path, req.file.mimetype)) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.redirect('/profile?photoError=' + encodeURIComponent('The selected file is not a valid JPG, PNG, or WEBP image.'));
    }

    const photoPath = 'profile/' + req.file.filename;
    const previousPhoto = db.prepare('SELECT profile_photo FROM users WHERE id = ?').get(req.session.user.id)?.profile_photo;
    db.prepare('UPDATE users SET profile_photo = ? WHERE id = ?').run(photoPath, req.session.user.id);
    req.session.user.profile_photo = photoPath;
    removeStoredProfilePhoto(previousPhoto);
    req.session.save((saveError) => {
      if (saveError) return res.status(500).redirect('/profile?photoError=' + encodeURIComponent('The photo could not be saved to your session. Please try again.'));
      res.redirect('/profile');
    });
  });
});

app.get('/profile/photo', requireAuth, (req, res) => {
  const photoPath = db.prepare('SELECT profile_photo FROM users WHERE id = ?').get(req.session.user.id)?.profile_photo;
  if (!photoPath || !photoPath.startsWith('profile/')) return res.sendStatus(404);
  const filename = path.basename(photoPath);
  const filePath = path.join(profileUploadDir, filename);
  if (!fs.existsSync(filePath)) return res.sendStatus(404);
  res.set('Cache-Control', 'private, no-store');
  res.sendFile(filePath);
});

app.post('/profile/photo/remove', requireAuth, (req, res) => {
  const previousPhoto = db.prepare('SELECT profile_photo FROM users WHERE id = ?').get(req.session.user.id)?.profile_photo;
  db.prepare('UPDATE users SET profile_photo = NULL WHERE id = ?').run(req.session.user.id);
  req.session.user.profile_photo = '';
  removeStoredProfilePhoto(previousPhoto);
  req.session.save((saveError) => {
    if (saveError) return res.status(500).redirect('/profile?photoError=' + encodeURIComponent('The photo could not be removed from your session. Please try again.'));
    res.redirect('/profile');
  });
});

app.get('/api/dashboard', requireAuth, (req, res) => {
  const year = getAcademicYearContext(req);
  res.json(getDashboardStats(year));
});

const translationTargets = new Set(['am', 'om', 'ti', 'so', 'ar', 'fr', 'es', 'de', 'pt', 'sw', 'it', 'zh-CN', 'hi']);
app.post('/api/translate', async (req, res) => {
  const { language, texts } = req.body || {};
  if (!translationTargets.has(language) || !Array.isArray(texts) || texts.length > 150 || texts.some((text) => typeof text !== 'string' || text.length > 500)) {
    return res.status(400).json({ error: 'Invalid translation request.' });
  }

  const normalized = texts.map((text) => text.replace(/[\r\n]+/g, ' '));
  if (normalized.reduce((total, text) => total + text.length, 0) > 5000) {
    return res.status(413).json({ error: 'Translation request is too large.' });
  }

  try {
    const translations = [];
    for (let index = 0; index < normalized.length; index += 30) {
      const batch = normalized.slice(index, index + 30);
      const url = new URL('https://translate.googleapis.com/translate_a/single');
      url.searchParams.set('client', 'gtx');
      url.searchParams.set('sl', 'en');
      url.searchParams.set('tl', language);
      url.searchParams.set('dt', 't');
      url.searchParams.set('q', batch.join('\n'));
      const providerResponse = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!providerResponse.ok) throw new Error('Translation service returned an error.');
      const providerData = await providerResponse.json();
      const translatedBatch = providerData[0].map((segment) => segment[0] || '').join('').split('\n');
      if (translatedBatch.length !== batch.length) throw new Error('Translation service returned an incomplete result.');
      translations.push(...translatedBatch);
    }
    res.json({ translations });
  } catch (error) {
    console.error('Page translation failed:', error.message);
    res.status(502).json({ error: 'Translation is temporarily unavailable.' });
  }
});

app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Page not found',
    message: 'The page you requested is not available in this school management system.',
    user: req.session.user || null,
    settings: getSettings(),
    active: 'dashboard'
  });
});

app.listen(PORT, () => {
  console.log(`${APP_TITLE} running on http://localhost:${PORT}`);
});
