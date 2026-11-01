# Secondary School – Student Information Management System

A full-stack web application for managing students, teachers, classes, attendance, assessments, reports, and school communications.

## Features
- Secure login with role-based access for admin, teacher, student, and parent
- Real dashboard metrics powered by SQLite data
- Student, teacher, class, and subject management
- Attendance tracking and exam mark entry
- Announcements and school settings management

## Run locally
1. `npm install`
2. `npm start`
3. Open `http://localhost:3000`

Demo users are seeded idempotently at startup only outside production. Existing accounts are not overwritten. Production runs require `SESSION_SECRET` to be set in the environment.

## Demo credentials
- Admin: `admin@bemilew.edu` / `Admin123!`
- Teacher: `teacher@bemilew.edu` / `Teacher123!`
- Student: `student@bemilew.edu` / `Student123!`
- Parent: `parent@bemilew.edu` / `Parent123!`
