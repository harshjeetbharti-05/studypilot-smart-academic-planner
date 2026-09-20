/**
 * StudyPilot - Smart Prioritization Engine Module
 *
 * Priorities tasks based on a weighted multi-factor scoring formula:
 * 1. Deadline Urgency (40%): Exponential/linear decay as deadline approaches.
 * 2. Marks / Weightage (25%): Relative grade weight of the assignment.
 * 3. Remaining Effort (20%): Hours required considering progress already completed.
 * 4. Academic Proximity Boost (15%): Upcoming exams or classes in the same subject.
 */

export interface Assignment {
  id: string;
  title: string;
  subject_id: string;
  subject_name?: string;
  subject_color?: string;
  description: string;
  deadline: string; // ISO string
  marks_weight: number; // e.g. 20 for 20%
  estimated_hours: number;
  progress: number; // 0 to 100
  status: 'not_started' | 'in_progress' | 'done';
}

export interface Exam {
  id: string;
  subject_id: string;
  title: string;
  date: string; // ISO string
}

export interface FreeSlot {
  dayName: string;
  dateStr: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  durationMins: number;
}

export interface PrioritizedTask extends Assignment {
  priorityScore: number; // 0 - 100+
  urgencyLevel: 'High' | 'Medium' | 'Low';
  hoursRemaining: number;
  hoursUntilDue: number;
  reason: string;
  assignedSlot?: FreeSlot | null;
}

/**
 * Calculates priority score and detailed metrics for an assignment.
 */
export function calculateTaskPriority(
  task: Assignment,
  exams: Exam[] = [],
  now: Date = new Date()
): { priorityScore: number; urgencyLevel: 'High' | 'Medium' | 'Low'; hoursRemaining: number; hoursUntilDue: number; reason: string } {
  const deadlineDate = new Date(task.deadline);
  const diffMs = deadlineDate.getTime() - now.getTime();
  const hoursUntilDue = Math.max(-24, diffMs / (1000 * 60 * 60)); // Allow negative for overdue

  // 1. Deadline Urgency Score (U: 0 - 100)
  let urgencyScore = 0;
  if (hoursUntilDue <= 0) {
    urgencyScore = 110; // Overdue tasks take absolute top urgency
  } else if (hoursUntilDue <= 12) {
    urgencyScore = 100;
  } else if (hoursUntilDue <= 24) {
    urgencyScore = 90;
  } else if (hoursUntilDue <= 48) {
    urgencyScore = 80;
  } else if (hoursUntilDue <= 72) {
    urgencyScore = 65;
  } else if (hoursUntilDue <= 168) { // within 1 week
    urgencyScore = Math.max(20, 65 - ((hoursUntilDue - 72) / 96) * 35);
  } else {
    urgencyScore = Math.max(5, 30 - ((hoursUntilDue - 168) / 168) * 20);
  }

  // 2. Marks / Weightage Score (W: 0 - 100)
  // 30 marks or higher maps to ~100
  const marksScore = Math.min(100, Math.max(10, task.marks_weight * 3.33));

  // 3. Remaining Effort Score (E: 0 - 100)
  const remainingEffortRatio = 1 - (task.progress / 100);
  const hoursRemaining = Math.max(0.25, task.estimated_hours * remainingEffortRatio);
  const effortScore = Math.min(100, hoursRemaining * 20);

  // 4. Academic Proximity Boost (P: 0 - 30)
  let proximityBoost = 0;
  const subjectExams = exams.filter(e => e.subject_id === task.subject_id);
  for (const exam of subjectExams) {
    const examDiffHours = (new Date(exam.date).getTime() - now.getTime()) / (1000 * 60 * 60);
    if (examDiffHours > 0 && examDiffHours <= 168) { // Exam within 7 days
      proximityBoost += 25;
      break;
    }
  }

  // Final Weighted Priority Formula
  // 40% Urgency + 25% Weightage + 20% Remaining Effort + 15% Proximity
  const rawScore = (0.40 * urgencyScore) + (0.25 * marksScore) + (0.20 * effortScore) + (0.15 * proximityBoost);
  const priorityScore = Math.round(Math.max(0, rawScore) * 10) / 10;

  // Urgency Level Classification
  let urgencyLevel: 'High' | 'Medium' | 'Low' = 'Low';
  if (priorityScore >= 65 || hoursUntilDue <= 36) {
    urgencyLevel = 'High';
  } else if (priorityScore >= 40 || hoursUntilDue <= 96) {
    urgencyLevel = 'Medium';
  }

  // Short human-readable reason for the "Do This First" card
  const dueDays = Math.ceil(hoursUntilDue / 24);
  let dueText = '';
  if (hoursUntilDue < 0) {
    dueText = 'Overdue';
  } else if (hoursUntilDue <= 24) {
    dueText = `Due in ${Math.round(hoursUntilDue)} hours`;
  } else {
    dueText = `Due in ${dueDays} days`;
  }

  const reasonParts = [];
  reasonParts.push(dueText);
  if (task.marks_weight > 0) {
    reasonParts.push(`worth ${task.marks_weight}% of grade`);
  }
  reasonParts.push(`${hoursRemaining.toFixed(1)}h effort remaining`);
  if (proximityBoost > 0) {
    reasonParts.push(`upcoming exam in subject`);
  }

  const reason = reasonParts.join(', ');

  return {
    priorityScore,
    urgencyLevel,
    hoursRemaining,
    hoursUntilDue,
    reason,
  };
}

/**
 * Ranks all non-completed assignments by priority score.
 */
export function rankAssignments(
  assignments: Assignment[],
  exams: Exam[] = [],
  now: Date = new Date()
): PrioritizedTask[] {
  const pending = assignments.filter(a => a.status !== 'done');
  
  const prioritized = pending.map(task => {
    const metrics = calculateTaskPriority(task, exams, now);
    return {
      ...task,
      ...metrics,
    };
  });

  return prioritized.sort((a, b) => b.priorityScore - a.priorityScore);
}
