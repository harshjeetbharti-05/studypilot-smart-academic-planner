import { DurableObject } from "cloudflare:workers";
import { Hono } from "hono";
import { rankAssignments, calculateTaskPriority } from "./prioritization";
import { getUpcomingFreeSlots, checkWorkloadOverload, TimetableSlot, BlockedSlot, StudentSettings } from "./freeSlots";

// Types
export interface Env {}

export class App extends DurableObject {
  private app = new Hono();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.initDatabase();
    this.setupRoutes();
  }

  private initDatabase() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS students (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        study_hours_start TEXT NOT NULL DEFAULT '17:00',
        study_hours_end TEXT NOT NULL DEFAULT '22:00',
        theme TEXT NOT NULL DEFAULT 'system',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS subjects (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        color TEXT NOT NULL,
        teacher TEXT,
        room TEXT
      );

      CREATE TABLE IF NOT EXISTS timetable_slots (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        day INTEGER NOT NULL, -- 0 = Sun, 1 = Mon ...
        start_time TEXT NOT NULL, -- HH:MM
        end_time TEXT NOT NULL, -- HH:MM
        subject_id TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'lecture', -- lecture, lab, tutorial
        room TEXT
      );

      CREATE TABLE IF NOT EXISTS blocked_slots (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        day INTEGER, -- NULL if date specific or 0-6 for recurring
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        title TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assignments (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        deadline TEXT NOT NULL, -- ISO
        marks_weight REAL NOT NULL DEFAULT 10,
        estimated_hours REAL NOT NULL DEFAULT 2,
        status TEXT NOT NULL DEFAULT 'not_started', -- not_started, in_progress, done
        progress INTEGER NOT NULL DEFAULT 0,
        subtasks TEXT NOT NULL DEFAULT '[]', -- JSON array of {id, title, completed}
        notes TEXT DEFAULT '',
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS syllabus_topics (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        unit TEXT NOT NULL DEFAULT 'Unit 1',
        title TEXT NOT NULL,
        weightage REAL DEFAULT 10,
        is_completed INTEGER NOT NULL DEFAULT 0,
        linked_assignment_ids TEXT DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS exams (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        title TEXT NOT NULL,
        date TEXT NOT NULL, -- ISO
        duration_mins INTEGER NOT NULL DEFAULT 120,
        weightage REAL DEFAULT 20,
        topics_covered TEXT DEFAULT '[]',
        revision_plan TEXT DEFAULT '[]' -- JSON
      );
    `);
  }

  private setupRoutes() {
    // Middleware to ensure default student exists
    this.app.use("*", async (c, next) => {
      await this.ensureSeedData();
      await next();
    });

    // --- AUTH & STUDENT SETTINGS ---
    this.app.get("/api/auth/me", (c) => {
      const student = this.ctx.storage.sql
        .exec(`SELECT * FROM students LIMIT 1`)
        .one();
      return c.json({ student });
    });

    this.app.post("/api/auth/login", async (c) => {
      const { email, name } = await c.req.json<{ email: string; name?: string }>();
      let student = this.ctx.storage.sql
        .exec(`SELECT * FROM students WHERE email = ?`, email)
        .toArray()[0];

      if (!student) {
        const id = "st_" + Math.random().toString(36).substring(2, 9);
        this.ctx.storage.sql.exec(
          `INSERT INTO students (id, email, name, study_hours_start, study_hours_end, theme, created_at)
           VALUES (?, ?, ?, '17:00', '22:00', 'system', ?)`,
          id,
          email,
          name || email.split("@")[0],
          Date.now()
        );
        student = this.ctx.storage.sql
          .exec(`SELECT * FROM students WHERE id = ?`, id)
          .one();
      }
      return c.json({ student });
    });

    this.app.put("/api/settings", async (c) => {
      const { study_hours_start, study_hours_end, theme, name } = await c.req.json();
      const student = this.ctx.storage.sql
        .exec(`SELECT id FROM students LIMIT 1`)
        .one();

      this.ctx.storage.sql.exec(
        `UPDATE students SET study_hours_start = ?, study_hours_end = ?, theme = ?, name = ? WHERE id = ?`,
        study_hours_start || '17:00',
        study_hours_end || '22:00',
        theme || 'system',
        name || 'Student',
        student.id
      );

      const updated = this.ctx.storage.sql
        .exec(`SELECT * FROM students WHERE id = ?`, student.id)
        .one();
      return c.json({ student: updated });
    });

    // --- SUBJECTS ---
    this.app.get("/api/subjects", (c) => {
      const subjects = this.ctx.storage.sql
        .exec(`SELECT * FROM subjects ORDER BY name ASC`)
        .toArray();
      return c.json({ subjects });
    });

    this.app.post("/api/subjects", async (c) => {
      const body = await c.req.json();
      const student = this.ctx.storage.sql.exec(`SELECT id FROM students LIMIT 1`).one();
      const id = "subj_" + Math.random().toString(36).substring(2, 9);

      this.ctx.storage.sql.exec(
        `INSERT INTO subjects (id, student_id, name, code, color, teacher, room)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id,
        student.id,
        body.name,
        body.code || body.name.substring(0, 4).toUpperCase(),
        body.color || '#5E6AD2',
        body.teacher || '',
        body.room || ''
      );

      const created = this.ctx.storage.sql.exec(`SELECT * FROM subjects WHERE id = ?`, id).one();
      return c.json({ subject: created });
    });

    // --- TIMETABLE & BLOCKED SLOTS ---
    this.app.get("/api/timetable", (c) => {
      const slots = this.ctx.storage.sql
        .exec(`
          SELECT ts.*, s.name as subject_name, s.code as subject_code, s.color as subject_color
          FROM timetable_slots ts
          LEFT JOIN subjects s ON ts.subject_id = s.id
          ORDER BY ts.day ASC, ts.start_time ASC
        `)
        .toArray();

      const blocked = this.ctx.storage.sql
        .exec(`SELECT * FROM blocked_slots ORDER BY day ASC, start_time ASC`)
        .toArray();

      return c.json({ slots, blocked });
    });

    this.app.post("/api/timetable", async (c) => {
      const body = await c.req.json();
      const student = this.ctx.storage.sql.exec(`SELECT id FROM students LIMIT 1`).one();
      const id = "tt_" + Math.random().toString(36).substring(2, 9);

      this.ctx.storage.sql.exec(
        `INSERT INTO timetable_slots (id, student_id, day, start_time, end_time, subject_id, type, room)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        student.id,
        body.day,
        body.start_time,
        body.end_time,
        body.subject_id,
        body.type || 'lecture',
        body.room || ''
      );

      return c.json({ ok: true, id });
    });

    this.app.delete("/api/timetable/:id", (c) => {
      const id = c.req.param("id");
      this.ctx.storage.sql.exec(`DELETE FROM timetable_slots WHERE id = ?`, id);
      return c.json({ ok: true });
    });

    this.app.post("/api/blocked-slots", async (c) => {
      const body = await c.req.json();
      const student = this.ctx.storage.sql.exec(`SELECT id FROM students LIMIT 1`).one();
      const id = "block_" + Math.random().toString(36).substring(2, 9);

      this.ctx.storage.sql.exec(
        `INSERT INTO blocked_slots (id, student_id, day, start_time, end_time, title)
         VALUES (?, ?, ?, ?, ?, ?)`,
        id,
        student.id,
        body.day !== undefined ? body.day : null,
        body.start_time,
        body.end_time,
        body.title
      );

      return c.json({ ok: true, id });
    });

    this.app.delete("/api/blocked-slots/:id", (c) => {
      const id = c.req.param("id");
      this.ctx.storage.sql.exec(`DELETE FROM blocked_slots WHERE id = ?`, id);
      return c.json({ ok: true });
    });

    // --- ASSIGNMENTS ---
    this.app.get("/api/assignments", (c) => {
      const assignments = this.ctx.storage.sql
        .exec(`
          SELECT a.*, s.name as subject_name, s.code as subject_code, s.color as subject_color
          FROM assignments a
          LEFT JOIN subjects s ON a.subject_id = s.id
          ORDER BY a.deadline ASC
        `)
        .toArray();

      const parsed = assignments.map((a: any) => ({
        ...a,
        subtasks: JSON.parse(a.subtasks || '[]'),
      }));

      return c.json({ assignments: parsed });
    });

    this.app.post("/api/assignments", async (c) => {
      const body = await c.req.json();
      const student = this.ctx.storage.sql.exec(`SELECT id FROM students LIMIT 1`).one();
      const id = "asgn_" + Math.random().toString(36).substring(2, 9);

      this.ctx.storage.sql.exec(
        `INSERT INTO assignments (id, student_id, subject_id, title, description, deadline, marks_weight, estimated_hours, status, progress, subtasks, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        student.id,
        body.subject_id,
        body.title,
        body.description || '',
        body.deadline,
        body.marks_weight || 10,
        body.estimated_hours || 2,
        body.status || 'not_started',
        body.progress || 0,
        JSON.stringify(body.subtasks || []),
        body.notes || '',
        Date.now()
      );

      return c.json({ ok: true, id });
    });

    this.app.put("/api/assignments/:id", async (c) => {
      const id = c.req.param("id");
      const body = await c.req.json();

      const current = this.ctx.storage.sql
        .exec(`SELECT * FROM assignments WHERE id = ?`, id)
        .toArray()[0];

      if (!current) return c.json({ error: "Assignment not found" }, 404);

      const status = body.status !== undefined ? body.status : current.status;
      let progress = body.progress !== undefined ? body.progress : current.progress;
      if (status === 'done') progress = 100;
      if (status === 'not_started' && body.progress === undefined) progress = 0;

      this.ctx.storage.sql.exec(
        `UPDATE assignments SET
          subject_id = ?, title = ?, description = ?, deadline = ?,
          marks_weight = ?, estimated_hours = ?, status = ?, progress = ?,
          subtasks = ?, notes = ?
         WHERE id = ?`,
        body.subject_id !== undefined ? body.subject_id : current.subject_id,
        body.title !== undefined ? body.title : current.title,
        body.description !== undefined ? body.description : current.description,
        body.deadline !== undefined ? body.deadline : current.deadline,
        body.marks_weight !== undefined ? body.marks_weight : current.marks_weight,
        body.estimated_hours !== undefined ? body.estimated_hours : current.estimated_hours,
        status,
        progress,
        body.subtasks !== undefined ? JSON.stringify(body.subtasks) : current.subtasks,
        body.notes !== undefined ? body.notes : current.notes,
        id
      );

      return c.json({ ok: true });
    });

    this.app.delete("/api/assignments/:id", (c) => {
      const id = c.req.param("id");
      this.ctx.storage.sql.exec(`DELETE FROM assignments WHERE id = ?`, id);
      return c.json({ ok: true });
    });

    // --- SYLLABUS & EXAMS ---
    this.app.get("/api/syllabus", (c) => {
      const topics = this.ctx.storage.sql
        .exec(`
          SELECT st.*, s.name as subject_name, s.code as subject_code, s.color as subject_color
          FROM syllabus_topics st
          LEFT JOIN subjects s ON st.subject_id = s.id
          ORDER BY st.subject_id ASC, st.unit ASC, st.id ASC
        `)
        .toArray();

      const exams = this.ctx.storage.sql
        .exec(`
          SELECT e.*, s.name as subject_name, s.code as subject_code, s.color as subject_color
          FROM exams e
          LEFT JOIN subjects s ON e.subject_id = s.id
          ORDER BY e.date ASC
        `)
        .toArray();

      const parsedTopics = topics.map((t: any) => ({
        ...t,
        is_completed: Boolean(t.is_completed),
        linked_assignment_ids: JSON.parse(t.linked_assignment_ids || '[]'),
      }));

      const parsedExams = exams.map((e: any) => ({
        ...e,
        topics_covered: JSON.parse(e.topics_covered || '[]'),
        revision_plan: JSON.parse(e.revision_plan || '[]'),
      }));

      return c.json({ topics: parsedTopics, exams: parsedExams });
    });

    this.app.post("/api/syllabus/topics", async (c) => {
      const body = await c.req.json();
      const student = this.ctx.storage.sql.exec(`SELECT id FROM students LIMIT 1`).one();
      const id = "topic_" + Math.random().toString(36).substring(2, 9);

      this.ctx.storage.sql.exec(
        `INSERT INTO syllabus_topics (id, student_id, subject_id, unit, title, weightage, is_completed, linked_assignment_ids)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        student.id,
        body.subject_id,
        body.unit || 'Unit 1',
        body.title,
        body.weightage || 10,
        body.is_completed ? 1 : 0,
        JSON.stringify(body.linked_assignment_ids || [])
      );

      return c.json({ ok: true, id });
    });

    this.app.put("/api/syllabus/topics/:id/toggle", async (c) => {
      const id = c.req.param("id");
      const current = this.ctx.storage.sql
        .exec(`SELECT is_completed FROM syllabus_topics WHERE id = ?`, id)
        .one();

      const nextVal = current.is_completed ? 0 : 1;
      this.ctx.storage.sql.exec(`UPDATE syllabus_topics SET is_completed = ? WHERE id = ?`, nextVal, id);
      return c.json({ ok: true, is_completed: Boolean(nextVal) });
    });

    this.app.post("/api/exams", async (c) => {
      const body = await c.req.json();
      const student = this.ctx.storage.sql.exec(`SELECT id FROM students LIMIT 1`).one();
      const id = "exam_" + Math.random().toString(36).substring(2, 9);

      // Generate initial AI suggested revision plan
      const revisionPlan = body.revision_plan || [
        { dayOffset: -5, task: "Review core lecture concepts & chapter summaries" },
        { dayOffset: -3, task: "Solve past paper practice questions & linked assignments" },
        { dayOffset: -1, task: "Light review of formula sheets & active recall cards" },
      ];

      this.ctx.storage.sql.exec(
        `INSERT INTO exams (id, student_id, subject_id, title, date, duration_mins, weightage, topics_covered, revision_plan)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        student.id,
        body.subject_id,
        body.title,
        body.date,
        body.duration_mins || 120,
        body.weightage || 20,
        JSON.stringify(body.topics_covered || []),
        JSON.stringify(revisionPlan)
      );

      return c.json({ ok: true, id });
    });

    // --- SMART ANALYSIS & SCHEDULE AUTO-PLANNER ---
    this.app.get("/api/schedule/analyze", (c) => {
      const student: any = this.ctx.storage.sql.exec(`SELECT * FROM students LIMIT 1`).one();
      const assignments = this.ctx.storage.sql
        .exec(`
          SELECT a.*, s.name as subject_name, s.code as subject_code, s.color as subject_color
          FROM assignments a
          LEFT JOIN subjects s ON a.subject_id = s.id
        `)
        .toArray();

      const exams = this.ctx.storage.sql.exec(`SELECT * FROM exams`).toArray();
      const slots = this.ctx.storage.sql.exec(`SELECT * FROM timetable_slots`).toArray();
      const blocked = this.ctx.storage.sql.exec(`SELECT * FROM blocked_slots`).toArray();

      const parsedAssignments = assignments.map((a: any) => ({
        ...a,
        subtasks: JSON.parse(a.subtasks || '[]'),
      }));

      // Rank tasks by priority formula
      const rankedTasks = rankAssignments(parsedAssignments, exams as any[]);
      const doFirstTask = rankedTasks.length > 0 ? rankedTasks[0] : null;

      // Compute Free Slots for next 7 days
      const freeSlots = getUpcomingFreeSlots(
        7,
        slots as TimetableSlot[],
        blocked as BlockedSlot[],
        {
          study_hours_start: student.study_hours_start,
          study_hours_end: student.study_hours_end,
        }
      );

      // Map top priority tasks into upcoming free slots for "Today's Plan"
      const todayStr = new Date().toISOString().split('T')[0];
      const todaySlots = freeSlots.filter(s => s.dateStr === todayStr);

      let taskIdx = 0;
      const scheduledTodayPlan = todaySlots.map(slot => {
        let task = rankedTasks[taskIdx];
        if (task) {
          // Task assigned to slot
          const item = {
            slot,
            taskTitle: task.title,
            subjectName: task.subject_name,
            subjectColor: task.subject_color,
            taskId: task.id,
            durationMins: slot.durationMins,
            recommendationReason: `Priority Score: ${task.priorityScore} (${task.urgencyLevel} Urgency)`
          };
          taskIdx = (taskIdx + 1) % rankedTasks.length;
          return item;
        }
        return {
          slot,
          taskTitle: "Free Study / Review Session",
          subjectName: "Personal Review",
          subjectColor: "#64748B",
          taskId: null,
          durationMins: slot.durationMins,
          recommendationReason: "Unallocated slot for study buffer"
        };
      });

      // Workload Overload Warning check
      const pendingTasksForCheck = rankedTasks.map(t => ({
        id: t.id,
        deadline: t.deadline,
        hoursRemaining: t.hoursRemaining,
      }));

      const overloadInfo = checkWorkloadOverload(pendingTasksForCheck, freeSlots);

      return c.json({
        doFirstTask,
        rankedTasks,
        todaySlots,
        scheduledTodayPlan,
        freeSlots,
        overloadInfo,
      });
    });

    // --- AI FILE EXTRACTION & EFFORT ESTIMATOR API ---
    this.app.post("/api/ai/extract", async (c) => {
      const body = await c.req.json<{
        type: 'timetable' | 'syllabus' | 'assignments';
        content: string; // raw text, base64 or csv text
        fileName?: string;
      }>();

      const { type, content, fileName } = body;

      // Structured extraction with intelligent rules & LLM structured pattern simulation
      if (type === 'timetable') {
        const extracted = this.extractTimetableFromText(content);
        return c.json({ ok: true, type, extracted });
      } else if (type === 'syllabus') {
        const extracted = this.extractSyllabusFromText(content);
        return c.json({ ok: true, type, extracted });
      } else if (type === 'assignments') {
        const extracted = this.extractAssignmentsFromText(content);
        return c.json({ ok: true, type, extracted });
      }

      return c.json({ error: "Invalid extraction type" }, 400);
    });

    this.app.post("/api/ai/estimate-effort", async (c) => {
      const { description, title } = await c.req.json<{ description: string; title: string }>();

      const textLength = (description || '').length;
      let estimated_hours = 2.0;

      // Rule-based heuristic enhanced with key term analysis
      const lower = (title + ' ' + description).toLowerCase();

      if (lower.includes("essay") || lower.includes("research paper") || lower.includes("thesis")) {
        estimated_hours = 6.0;
      } else if (lower.includes("lab report") || lower.includes("project") || lower.includes("implementation")) {
        estimated_hours = 4.5;
      } else if (lower.includes("problem set") || lower.includes("math") || lower.includes("hw")) {
        estimated_hours = 3.0;
      } else if (lower.includes("quiz") || lower.includes("reading") || lower.includes("discussion")) {
        estimated_hours = 1.5;
      }

      if (textLength > 500) estimated_hours += 1.0;

      const subtasks = [
        { id: "st1", title: "Review instructions & initial outlines", completed: false },
        { id: "st2", title: "Core drafting / problem solving", completed: false },
        { id: "st3", title: "Review, proofread & final submission format check", completed: false }
      ];

      return c.json({
        estimated_hours: Math.round(estimated_hours * 10) / 10,
        subtasks,
        reasoning: `Based on assignment requirements, scope, and domain complexity.`
      });
    });

    // --- RE-SEED DATA ---
    this.app.post("/api/seed/reset", (c) => {
      this.clearAllData();
      this.seedInitialData();
      return c.json({ ok: true, message: "Sample data re-seeded successfully" });
    });
  }

  // --- AI SIMULATED EXTRACTION PARSERS ---
  private extractTimetableFromText(text: string) {
    const subjects: any[] = this.ctx.storage.sql.exec(`SELECT * FROM subjects`).toArray();
    const sub0 = subjects[0] || { id: "subj_cs101", name: "Computer Systems" };
    const sub1 = subjects[1] || { id: "subj_algo", name: "Data Structures & Algorithms" };
    const sub2 = subjects[2] || { id: "subj_math", name: "Linear Algebra" };

    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    const extractedSlots: any[] = [];

    // Smart regex parser for Day, Time, Subject
    const dayMap: Record<string, number> = {
      'mon': 1, 'monday': 1,
      'tue': 2, 'tuesday': 2,
      'wed': 3, 'wednesday': 3,
      'thu': 4, 'thursday': 4,
      'fri': 5, 'friday': 5,
      'sat': 6, 'saturday': 6,
      'sun': 0, 'sunday': 0,
    };

    lines.forEach((line, idx) => {
      const lower = line.toLowerCase();
      let detectedDay = (idx % 5) + 1; // Default Mon-Fri loop
      for (const [key, val] of Object.entries(dayMap)) {
        if (lower.includes(key)) {
          detectedDay = val;
          break;
        }
      }

      let type: 'lecture' | 'lab' | 'tutorial' = 'lecture';
      if (lower.includes("lab")) type = "lab";
      if (lower.includes("tut") || lower.includes("discussion")) type = "tutorial";

      let matchedSubj = sub0;
      if (lower.includes("algo") || lower.includes("struct") || lower.includes("code")) matchedSubj = sub1;
      if (lower.includes("math") || lower.includes("linear") || lower.includes("algebra")) matchedSubj = sub2;

      const timeMatch = line.match(/(\d{1,2})[:.]?(\d{2})?\s*(am|pm)?\s*[-to–]\s*(\d{1,2})[:.]?(\d{2})?\s*(am|pm)?/i);

      let startTime = "10:00";
      let endTime = "11:30";

      if (timeMatch) {
        let h1 = parseInt(timeMatch[1], 10);
        const m1 = timeMatch[2] || "00";
        const p1 = timeMatch[3];
        if (p1 && p1.toLowerCase() === "pm" && h1 < 12) h1 += 12;

        let h2 = parseInt(timeMatch[4], 10);
        const m2 = timeMatch[5] || "00";
        const p2 = timeMatch[6];
        if (p2 && p2.toLowerCase() === "pm" && h2 < 12) h2 += 12;

        startTime = `${String(h1).padStart(2, "0")}:${m1}`;
        endTime = `${String(h2).padStart(2, "0")}:${m2}`;
      } else {
        const startH = 9 + (idx % 6) * 2;
        startTime = `${String(startH).padStart(2, "0")}:00`;
        endTime = `${String(startH + 1).padStart(2, "0")}:30`;
      }

      extractedSlots.push({
        day: detectedDay,
        start_time: startTime,
        end_time: endTime,
        subject_id: matchedSubj.id,
        subject_name: matchedSubj.name,
        type,
        room: line.includes("Room") || line.includes("Hall") ? line.substring(line.indexOf("Room")) : `Hall ${101 + idx}`
      });
    });

    if (extractedSlots.length === 0) {
      // Fallback structured data
      return [
        { day: 1, start_time: "09:00", end_time: "10:30", subject_id: sub0.id, subject_name: sub0.name, type: "lecture", room: "CS Building 201" },
        { day: 1, start_time: "14:00", end_time: "16:00", subject_id: sub1.id, subject_name: sub1.name, type: "lab", room: "Lab 3B" },
        { day: 3, start_time: "11:00", end_time: "12:30", subject_id: sub2.id, subject_name: sub2.name, type: "lecture", room: "Math Hall A" },
      ];
    }

    return extractedSlots;
  }

  private extractSyllabusFromText(text: string) {
    const subjects: any[] = this.ctx.storage.sql.exec(`SELECT * FROM subjects`).toArray();
    const targetSubj = subjects[0] || { id: "subj_cs101", name: "Computer Systems" };

    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    const topics: any[] = [];
    const examDates: any[] = [];

    let currentUnit = "Unit 1: Overview";

    lines.forEach((line, idx) => {
      const lower = line.toLowerCase();
      if (lower.startsWith("unit") || lower.startsWith("chapter") || lower.startsWith("module")) {
        currentUnit = line.trim();
        return;
      }

      if (lower.includes("exam") || lower.includes("midterm") || lower.includes("quiz")) {
        examDates.push({
          subject_id: targetSubj.id,
          title: line.trim(),
          date: new Date(Date.now() + (idx + 3) * 86400000).toISOString().split('T')[0] + 'T14:00:00Z',
          weightage: 20,
        });
        return;
      }

      topics.push({
        subject_id: targetSubj.id,
        subject_name: targetSubj.name,
        unit: currentUnit,
        title: line.replace(/^[0-9.-]+\s*/, '').trim(),
        weightage: 10 + (idx % 3) * 5,
        is_completed: false,
      });
    });

    if (topics.length === 0) {
      topics.push(
        { subject_id: targetSubj.id, subject_name: targetSubj.name, unit: "Unit 1: Foundations", title: "System Architecture & Memory Hierarchy", weightage: 15, is_completed: true },
        { subject_id: targetSubj.id, subject_name: targetSubj.name, unit: "Unit 2: Processes", title: "Thread Scheduling & Concurrency Synchronization", weightage: 20, is_completed: false },
        { subject_id: targetSubj.id, subject_name: targetSubj.name, unit: "Unit 3: I/O & Storage", title: "Virtual Memory & Page Replacement Algorithms", weightage: 25, is_completed: false }
      );
    }

    return { subject_id: targetSubj.id, subject_name: targetSubj.name, topics, examDates };
  }

  private extractAssignmentsFromText(text: string) {
    const subjects: any[] = this.ctx.storage.sql.exec(`SELECT * FROM subjects`).toArray();
    const sub0 = subjects[0] || { id: "subj_cs101", name: "Computer Systems" };
    const sub1 = subjects[1] || { id: "subj_algo", name: "Data Structures & Algorithms" };

    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    const assignments: any[] = [];

    lines.forEach((line, idx) => {
      const lower = line.toLowerCase();
      const matchedSubj = idx % 2 === 0 ? sub0 : sub1;

      // Extract title and deadline if present
      const dueDaysAhead = 2 + idx * 3;
      const deadline = new Date(Date.now() + dueDaysAhead * 86400000).toISOString();

      assignments.push({
        subject_id: matchedSubj.id,
        subject_name: matchedSubj.name,
        title: line.replace(/^(assignment|hw|task)\s*\d*[:.-]?\s*/i, '').trim() || `Assignment ${idx + 1}`,
        description: `Complete all required exercises mentioned in ${line.trim()}`,
        deadline,
        marks_weight: 15 + (idx % 4) * 5,
        estimated_hours: 3.0 + (idx % 3),
        status: "not_started",
        progress: 0,
        subtasks: [
          { id: `st_${idx}_1`, title: "Read problem specifications", completed: false },
          { id: `st_${idx}_2`, title: "Implement solution draft", completed: false },
        ]
      });
    });

    if (assignments.length === 0) {
      assignments.push({
        subject_id: sub0.id,
        subject_name: sub0.name,
        title: "Virtual Memory Lab Report",
        description: "Analyze page fault metrics and implement LRU replacement simulation.",
        deadline: new Date(Date.now() + 2 * 86400000).toISOString(),
        marks_weight: 20,
        estimated_hours: 4.5,
        status: "in_progress",
        progress: 35,
        subtasks: [
          { id: "st1", title: "Run cache benchmarks", completed: true },
          { id: "st2", title: "Write performance comparison section", completed: false },
        ]
      });
    }

    return assignments;
  }

  // --- SEED SAMPLE DATA SETUP ---
  private async ensureSeedData() {
    const count = this.ctx.storage.sql.exec(`SELECT COUNT(*) as c FROM students`).one().c as number;
    if (count === 0) {
      this.seedInitialData();
    }
  }

  private clearAllData() {
    this.ctx.storage.sql.exec(`DELETE FROM students`);
    this.ctx.storage.sql.exec(`DELETE FROM subjects`);
    this.ctx.storage.sql.exec(`DELETE FROM timetable_slots`);
    this.ctx.storage.sql.exec(`DELETE FROM blocked_slots`);
    this.ctx.storage.sql.exec(`DELETE FROM assignments`);
    this.ctx.storage.sql.exec(`DELETE FROM syllabus_topics`);
    this.ctx.storage.sql.exec(`DELETE FROM exams`);
  }

  private seedInitialData() {
    const studentId = "st_alex_vance";
    this.ctx.storage.sql.exec(
      `INSERT INTO students (id, email, name, study_hours_start, study_hours_end, theme, created_at)
       VALUES (?, 'alex.vance@university.edu', 'Alex Vance', '16:00', '22:00', 'system', ?)`,
      studentId,
      Date.now()
    );

    // 4 Color-coded Subjects
    const subjects = [
      { id: "subj_algo", name: "Data Structures & Algorithms", code: "CS201", color: "#5E6AD2", teacher: "Dr. Eleanor Vance", room: "Hall 302" },
      { id: "subj_systems", name: "Computer Systems Architecture", code: "CS204", color: "#2563EB", teacher: "Prof. Alan Turing", room: "CS Lab 4B" },
      { id: "subj_math", name: "Linear Algebra & Optimization", code: "MATH210", color: "#059669", teacher: "Dr. Sofia Kovalevskaya", room: "Math Annex 101" },
      { id: "subj_web", name: "Full-Stack Web Engineering", code: "CS230", color: "#D97706", teacher: "Prof. Tim Berners", room: "Innovation Hub" },
    ];

    for (const s of subjects) {
      this.ctx.storage.sql.exec(
        `INSERT INTO subjects (id, student_id, name, code, color, teacher, room)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        s.id, studentId, s.name, s.code, s.color, s.teacher, s.room
      );
    }

    // Weekly Timetable Slots (Mon=1, Tue=2, Wed=3, Thu=4, Fri=5)
    const timetable = [
      // Monday
      { id: "tt1", day: 1, start_time: "09:00", end_time: "10:30", subject_id: "subj_algo", type: "lecture", room: "Hall 302" },
      { id: "tt2", day: 1, start_time: "11:00", end_time: "12:30", subject_id: "subj_math", type: "lecture", room: "Math Annex 101" },
      { id: "tt3", day: 1, start_time: "14:00", end_time: "16:00", subject_id: "subj_systems", type: "lab", room: "CS Lab 4B" },
      // Tuesday
      { id: "tt4", day: 2, start_time: "10:00", end_time: "11:30", subject_id: "subj_systems", type: "lecture", room: "Hall 201" },
      { id: "tt5", day: 2, start_time: "13:00", end_time: "15:00", subject_id: "subj_web", type: "lecture", room: "Innovation Hub" },
      // Wednesday
      { id: "tt6", day: 3, start_time: "09:00", end_time: "10:30", subject_id: "subj_algo", type: "lecture", room: "Hall 302" },
      { id: "tt7", day: 3, start_time: "11:00", end_time: "12:30", subject_id: "subj_math", type: "tutorial", room: "Math Annex 101" },
      // Thursday
      { id: "tt8", day: 4, start_time: "10:00", end_time: "11:30", subject_id: "subj_systems", type: "lecture", room: "Hall 201" },
      { id: "tt9", day: 4, start_time: "14:00", end_time: "16:30", subject_id: "subj_web", type: "lab", room: "Innovation Hub" },
      // Friday
      { id: "tt10", day: 5, start_time: "10:00", end_time: "12:00", subject_id: "subj_algo", type: "lab", room: "CS Lab 1A" },
    ];

    for (const t of timetable) {
      this.ctx.storage.sql.exec(
        `INSERT INTO timetable_slots (id, student_id, day, start_time, end_time, subject_id, type, room)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        t.id, studentId, t.day, t.start_time, t.end_time, t.subject_id, t.type, t.room
      );
    }

    // Blocked Slots / Recurring Breaks
    const blocked = [
      { id: "b1", day: null, start_time: "12:30", end_time: "13:30", title: "Lunch Break" },
      { id: "b2", day: null, start_time: "18:00", end_time: "19:00", title: "Dinner & Gym Break" },
    ];

    for (const b of blocked) {
      this.ctx.storage.sql.exec(
        `INSERT INTO blocked_slots (id, student_id, day, start_time, end_time, title)
         VALUES (?, ?, ?, ?, ?, ?)`,
        b.id, studentId, b.day, b.start_time, b.end_time, b.title
      );
    }

    // Assignments
    const now = Date.now();
    const dayMs = 86400000;

    const assignments = [
      {
        id: "asgn_1",
        subject_id: "subj_algo",
        title: "Dynamic Programming & Graph Algorithms Problem Set",
        description: "Implement Dijkstra's algorithm with binary heap optimization and solve 5 recurrence relation problems.",
        deadline: new Date(now + 1.8 * dayMs).toISOString(), // ~43 hours from now
        marks_weight: 25,
        estimated_hours: 4.5,
        status: "in_progress",
        progress: 40,
        subtasks: [
          { id: "st1", title: "Solve Bellman-Ford & Dijkstra recurrence proofs", completed: true },
          { id: "st2", title: "Implement binary min-heap priority queue in C++", completed: true },
          { id: "st3", title: "Benchmark graph traversal performance metrics", completed: false },
          { id: "st4", title: "Write final PDF report with complexity analysis", completed: false },
        ],
        notes: "Remember to include edge case analysis for negative cycle detection."
      },
      {
        id: "asgn_2",
        subject_id: "subj_systems",
        title: "Virtual Memory & Page Replacement Lab Report",
        description: "Measure page fault overhead across FIFO, LRU, and Clock replacement policies using the OS kernel simulator.",
        deadline: new Date(now + 3.2 * dayMs).toISOString(),
        marks_weight: 20,
        estimated_hours: 3.5,
        status: "not_started",
        progress: 0,
        subtasks: [
          { id: "st1", title: "Run paging simulator with trace files", completed: false },
          { id: "st2", title: "Plot page fault frequency vs frame size graph", completed: false },
          { id: "st3", title: "Draft lab report discussion and conclusions", completed: false },
        ],
        notes: "Use gnuplot or Python matplotlib for the fault curve figures."
      },
      {
        id: "asgn_3",
        subject_id: "subj_math",
        title: "Eigenvalues & Singular Value Decomposition Problem Sheet",
        description: "Matrix diagonalization problems, power iteration algorithm code, and image compression application using SVD.",
        deadline: new Date(now + 5.0 * dayMs).toISOString(),
        marks_weight: 15,
        estimated_hours: 3.0,
        status: "in_progress",
        progress: 25,
        subtasks: [
          { id: "st1", title: "Compute characteristic polynomials for 4x4 matrices", completed: true },
          { id: "st2", title: "Write Python SVD script for grayscale image compression", completed: false },
        ],
        notes: "Check numpy.linalg.svd against manual calculation."
      },
      {
        id: "asgn_4",
        subject_id: "subj_web",
        title: "RESTful API & Database Migration Sprint",
        description: "Build asynchronous Express/Hono backend endpoints with SQLite transaction handling and JWT authentication.",
        deadline: new Date(now + 6.5 * dayMs).toISOString(),
        marks_weight: 30,
        estimated_hours: 6.0,
        status: "not_started",
        progress: 0,
        subtasks: [
          { id: "st1", title: "Design database schema & foreign key relationships", completed: false },
          { id: "st2", title: "Implement auth middleware & password hashing", completed: false },
          { id: "st3", title: "Write Postman integration test suite", completed: false },
        ],
        notes: "Include OpenAPI / Swagger spec file."
      },
    ];

    for (const a of assignments) {
      this.ctx.storage.sql.exec(
        `INSERT INTO assignments (id, student_id, subject_id, title, description, deadline, marks_weight, estimated_hours, status, progress, subtasks, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        a.id, studentId, a.subject_id, a.title, a.description, a.deadline, a.marks_weight, a.estimated_hours, a.status, a.progress, JSON.stringify(a.subtasks), a.notes, now
      );
    }

    // Syllabus Topics
    const syllabus = [
      // Algorithms
      { id: "top_1", subject_id: "subj_algo", unit: "Unit 1: Asymptotic Analysis & Recurrences", title: "Master Theorem & Divide-and-Conquer Recurrences", weightage: 15, is_completed: true },
      { id: "top_2", subject_id: "subj_algo", unit: "Unit 2: Graph Theory & Shortest Paths", title: "Dijkstra, Bellman-Ford & All-Pairs Shortest Paths", weightage: 25, is_completed: false },
      { id: "top_3", subject_id: "subj_algo", unit: "Unit 3: Dynamic Programming", title: "Knapsack, Sequence Alignment & Matrix Chain Multiplication", weightage: 30, is_completed: false },
      // Systems Architecture
      { id: "top_4", subject_id: "subj_systems", unit: "Unit 1: Processor Microarchitecture", title: "Pipelining, Hazard Detection & Branch Prediction", weightage: 20, is_completed: true },
      { id: "top_5", subject_id: "subj_systems", unit: "Unit 2: Memory Hierarchy", title: "Cache Line Mapping, Write Policies & Translation Lookaside Buffers", weightage: 25, is_completed: false },
      { id: "top_6", subject_id: "subj_systems", unit: "Unit 3: Virtual Memory", title: "Page Tables, Paging Overhead & Page Replacement Algorithms", weightage: 25, is_completed: false },
      // Linear Algebra
      { id: "top_7", subject_id: "subj_math", unit: "Unit 1: Vector Spaces & Linear Transformations", title: "Basis, Dimension, Nullspace & Column Space", weightage: 20, is_completed: true },
      { id: "top_8", subject_id: "subj_math", unit: "Unit 2: Eigenvalues & Diagonalization", title: "Eigenspaces, Symmetric Matrices & Spectral Theorem", weightage: 25, is_completed: false },
      // Web Engineering
      { id: "top_9", subject_id: "subj_web", unit: "Unit 1: Modern JavaScript & Async Operations", title: "Promises, Event Loop & Event-Driven Architecture", weightage: 15, is_completed: true },
      { id: "top_10", subject_id: "subj_web", unit: "Unit 2: RESTful API & Server-Side Persistence", title: "HTTP Semantics, ORM/SQL Storage & Security Auth", weightage: 25, is_completed: false },
    ];

    for (const t of syllabus) {
      this.ctx.storage.sql.exec(
        `INSERT INTO syllabus_topics (id, student_id, subject_id, unit, title, weightage, is_completed, linked_assignment_ids)
         VALUES (?, ?, ?, ?, ?, ?, ?, '[]')`,
        t.id, studentId, t.subject_id, t.unit, t.title, t.weightage, t.is_completed ? 1 : 0
      );
    }

    // Exams
    const exams = [
      {
        id: "exam_1",
        subject_id: "subj_algo",
        title: "Midterm Examination: Advanced Algorithms",
        date: new Date(now + 4 * dayMs).toISOString(),
        duration_mins: 120,
        weightage: 30,
        topics_covered: ["Recurrences", "Graph Algorithms", "Priority Queues"],
        revision_plan: [
          { dayOffset: -3, task: "Review Master Theorem formulas and graph proofs" },
          { dayOffset: -2, task: "Solve past exam papers (2023 & 2024)" },
          { dayOffset: -1, task: "Active recall sheet for time complexities" }
        ]
      },
      {
        id: "exam_2",
        subject_id: "subj_math",
        title: "Quiz 2: Diagonalization & SVD",
        date: new Date(now + 8 * dayMs).toISOString(),
        duration_mins: 60,
        weightage: 15,
        topics_covered: ["Eigenvalues", "Matrix Diagonalization", "SVD"],
        revision_plan: [
          { dayOffset: -2, task: "Practice 3x3 matrix eigenvalue calculations" },
          { dayOffset: -1, task: "Review SVD step-by-step procedure" }
        ]
      }
    ];

    for (const e of exams) {
      this.ctx.storage.sql.exec(
        `INSERT INTO exams (id, student_id, subject_id, title, date, duration_mins, weightage, topics_covered, revision_plan)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        e.id, studentId, e.subject_id, e.title, e.date, e.duration_mins, e.weightage, JSON.stringify(e.topics_covered), JSON.stringify(e.revision_plan)
      );
    }
  }

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request);
  }
}
