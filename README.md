# StudyPilot - Smart Academic Planner for College Students

StudyPilot is a personal academic planning web application built for college students. Students upload their assignments, course syllabus, and weekly timetable, and StudyPilot calculates what to work on first based on free time slots between classes and multi-factor priority scoring.

---

## Key Features

1. **Uploads & AI Extraction**
   - **3 Dedicated Upload Zones**: Timetable, Syllabus, Assignments.
   - **Multi-Format Support**: Accept PDF, DOCX, photos/images, CSV/XLSX, or raw pasted text.
   - **AI/LLM Extraction**: Parses structured schedule slots, syllabus topics, weightages, exam dates, and assignment details.
   - **Editable Review Table**: Review and edit extracted rows before saving to the database.
   - **Manual Creation**: Instant manual entry for classes, assignments, and syllabus topics.

2. **Timetable & Free-Slot Detection**
   - **Interactive Calendar Grid**: Mon-Sun weekly timetable view.
   - **Automatic Free Slot Engine**: Computes gaps between lectures, labs, and tutorials within defined daily study hours.
   - **Blocked Slots & Breaks**: Support for recurring breaks (meals, gym, commuting).

3. **Smart Prioritization ("Do This First")**
   - **Top Priority Hero Card**: Highlights the single #1 task to focus on right now with a clear reason.
   - **Formula-Driven Scoring**: Ranks tasks based on deadline urgency, grade weightage, remaining effort, and exam proximity.
   - **"Today's Plan" Auto-Scheduler**: Maps tasks into today's free slots automatically.
   - **Workload Overload Warning**: Alerts students when total required task hours exceed total available free study time before deadlines.

4. **Task Management**
   - **Status Pipeline**: Not Started / In Progress / Completed.
   - **Progress Slider & Subtasks**: Real-time progress updates with instant schedule recalculation.
   - **Filtering**: Filter by subject, completion status, and priority.

5. **Syllabus Tracker & Exam Roadmaps**
   - **Topic Checklists**: Per-subject unit checklists with % completion bars.
   - **AI Exam Revision Plans**: Step-by-step revision schedules leading up to exam dates.

6. **In-App Reminders**
   - Notifications for tasks due within 48 hours and upcoming free study slots.

---

## Priority Scoring Formula

The smart prioritization engine assigns a **Priority Score (0 to 100+)** to every non-completed assignment using a weighted multi-factor formula:

$$\text{Priority Score} = (0.40 \times U) + (0.25 \times W) + (0.20 \times E) + (0.15 \times P)$$

### Formula Breakdown

1. **Deadline Urgency Score ($U$: 0 - 110)**
   - Overdue tasks ($< 0$ hours remaining): $U = 110$ (Top Priority)
   - Due within 12 hours: $U = 100$
   - Due within 24 hours: $U = 90$
   - Due within 48 hours: $U = 80$
   - Linear decay for deadlines further out.

2. **Grade Marks / Weightage Score ($W$: 0 - 100)**
   - Scales the assignment's weight towards the final course grade:
   - $W = \min(100, \text{marks\_weight} \times 3.33)$
   - An assignment worth 30% of final grade scores $\approx 100$.

3. **Remaining Effort Score ($E$: 0 - 100)**
   - Takes into account progress already done:
   - $\text{Hours Remaining} = \text{Estimated Hours} \times (1 - \frac{\text{Progress \%}}{100})$
   - $E = \min(100, \text{Hours Remaining} \times 20)$

4. **Academic Exam/Class Proximity Boost ($P$: 0 - 30)**
   - $+25$ points if an upcoming exam exists in the same subject within 7 days.
   - $+10$ points if a class occurs on the same day.

---

## Setup & Deployment Instructions

### Environment Setup

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

### Running in SpaceDO / Cloudflare Worker

```json
{
  "main": "src/index.ts",
  "compatibility_date": "2025-04-01",
  "assets": {
    "directory": "./public",
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "single-page-application"
  }
}
```

Deploy using SpaceDO deployment:

```bash
deploy_space
```

---

## Seed Sample Data

The application automatically seeds a sample student (**Alex Vance - Computer Science Major**) on first load, including:
- 4 color-coded subjects (Data Structures & Algorithms, Computer Systems Architecture, Linear Algebra, Full-Stack Web Engineering).
- Weekly timetable with lectures, labs, and tutorials.
- Active assignments with varying deadlines, weightages, effort hours, and subtasks.
- Syllabus topics with unit completion bars.
- Upcoming exams with step-by-step AI revision plans.

To reset or re-seed sample data at any time, go to **Settings -> Re-seed Sample Student Data**.
