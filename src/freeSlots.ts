/**
 * StudyPilot - Free Slot Detection & Auto-Scheduler Module
 *
 * Automatically calculates free study windows by subtracting:
 * 1. Scheduled Classes (Lectures, Labs, Tutorials)
 * 2. Blocked Times & Breaks (e.g. Gym, Meals)
 * 3. Non-Study Hours (Outside defined study_hours_start & study_hours_end)
 */

export interface TimetableSlot {
  id: string;
  day: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  start_time: string; // HH:MM
  end_time: string; // HH:MM
  subject_id: string;
  subject_name?: string;
  type: 'lecture' | 'lab' | 'tutorial';
  room?: string;
}

export interface BlockedSlot {
  id: string;
  day?: number; // 0-6 if recurring weekly, or null
  start_time: string; // HH:MM
  end_time: string; // HH:MM
  title: string;
}

export interface StudentSettings {
  study_hours_start: string; // HH:MM e.g. "08:00" or "17:00"
  study_hours_end: string; // HH:MM e.g. "22:00"
}

export interface CalculatedFreeSlot {
  id: string;
  dateStr: string; // YYYY-MM-DD
  dayName: string; // "Monday", "Tuesday", etc.
  dayIndex: number; // 0-6
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  durationMins: number;
  assignedTaskTitle?: string;
  assignedSubjectColor?: string;
}

export interface ScheduleOverloadWarning {
  isOverloaded: boolean;
  totalTaskHoursDue: number;
  totalAvailableFreeHours: number;
  deficitHours: number;
  nextCriticalDeadline?: string;
  message: string;
}

/**
 * Converts HH:MM to minutes from midnight
 */
function timeToMins(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Converts minutes from midnight to HH:MM
 */
function minsToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Calculates free time slots for a specific date given timetable classes and study hours.
 */
export function calculateDailyFreeSlots(
  targetDate: Date,
  classes: TimetableSlot[],
  blocked: BlockedSlot[],
  settings: StudentSettings
): CalculatedFreeSlot[] {
  const dayIndex = targetDate.getDay();
  const dateStr = targetDate.toISOString().split('T')[0];
  const dayName = targetDate.toLocaleDateString('en-US', { weekday: 'long' });

  const studyStartMins = timeToMins(settings.study_hours_start || '08:00');
  const studyEndMins = timeToMins(settings.study_hours_end || '22:00');

  // Filter classes & blocked slots for this day
  const dayClasses = classes.filter(c => c.day === dayIndex);
  const dayBlocked = blocked.filter(b => b.day === undefined || b.day === null || b.day === dayIndex);

  // Combine busy intervals
  const busyIntervals: { start: number; end: number }[] = [];

  for (const c of dayClasses) {
    busyIntervals.push({
      start: timeToMins(c.start_time),
      end: timeToMins(c.end_time),
    });
  }

  for (const b of dayBlocked) {
    busyIntervals.push({
      start: timeToMins(b.start_time),
      end: timeToMins(b.end_time),
    });
  }

  // Sort busy intervals by start time
  busyIntervals.sort((a, b) => a.start - b.start);

  // Merge overlapping busy intervals
  const mergedBusy: { start: number; end: number }[] = [];
  for (const curr of busyIntervals) {
    if (mergedBusy.length === 0) {
      mergedBusy.push({ ...curr });
    } else {
      const prev = mergedBusy[mergedBusy.length - 1];
      if (curr.start <= prev.end) {
        prev.end = Math.max(prev.end, curr.end);
      } else {
        mergedBusy.push({ ...curr });
      }
    }
  }

  // Calculate free slots between studyStartMins and studyEndMins
  const freeSlots: CalculatedFreeSlot[] = [];
  let currentPtr = studyStartMins;

  for (const busy of mergedBusy) {
    // Only care about busy slots within study hours
    const bStart = Math.max(studyStartMins, Math.min(studyEndMins, busy.start));
    const bEnd = Math.max(studyStartMins, Math.min(studyEndMins, busy.end));

    if (bStart > currentPtr) {
      const durationMins = bStart - currentPtr;
      if (durationMins >= 20) { // minimum 20 mins for a study slot
        freeSlots.push({
          id: `slot_${dateStr}_${currentPtr}`,
          dateStr,
          dayName,
          dayIndex,
          startTime: minsToTime(currentPtr),
          endTime: minsToTime(bStart),
          durationMins,
        });
      }
    }
    currentPtr = Math.max(currentPtr, bEnd);
  }

  if (currentPtr < studyEndMins) {
    const durationMins = studyEndMins - currentPtr;
    if (durationMins >= 20) {
      freeSlots.push({
        id: `slot_${dateStr}_${currentPtr}`,
        dateStr,
        dayName,
        dayIndex,
        startTime: minsToTime(currentPtr),
        endTime: minsToTime(studyEndMins),
        durationMins,
      });
    }
  }

  return freeSlots;
}

/**
 * Calculates upcoming free slots for the next N days.
 */
export function getUpcomingFreeSlots(
  daysCount: number = 7,
  classes: TimetableSlot[],
  blocked: BlockedSlot[],
  settings: StudentSettings,
  now: Date = new Date()
): CalculatedFreeSlot[] {
  const allFreeSlots: CalculatedFreeSlot[] = [];

  for (let i = 0; i < daysCount; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);

    const dailySlots = calculateDailyFreeSlots(d, classes, blocked, settings);
    
    // If today, filter out slots in the past
    if (i === 0) {
      const currentMins = now.getHours() * 60 + now.getMinutes();
      const futureSlots = dailySlots.filter(slot => {
        const slotEndMins = timeToMins(slot.endTime);
        return slotEndMins > currentMins;
      }).map(slot => {
        const slotStartMins = timeToMins(slot.startTime);
        if (slotStartMins < currentMins) {
          // Truncate start time to current time rounded up to 5 mins
          const adjustedStart = Math.ceil(currentMins / 5) * 5;
          return {
            ...slot,
            startTime: minsToTime(adjustedStart),
            durationMins: timeToMins(slot.endTime) - adjustedStart,
          };
        }
        return slot;
      }).filter(s => s.durationMins >= 15);

      allFreeSlots.push(...futureSlots);
    } else {
      allFreeSlots.push(...dailySlots);
    }
  }

  return allFreeSlots;
}

/**
 * Checks if total effort for pending tasks exceeds available free time before deadlines.
 */
export function checkWorkloadOverload(
  pendingTasks: { id: string; deadline: string; hoursRemaining: number }[],
  freeSlots: CalculatedFreeSlot[],
  now: Date = new Date()
): ScheduleOverloadWarning {
  let totalTaskHours = 0;
  let totalAvailableFreeMins = 0;

  // Filter tasks due within next 7 days
  const upcomingTasks = pendingTasks.filter(t => {
    const diffHours = (new Date(t.deadline).getTime() - now.getTime()) / (1000 * 60 * 60);
    return diffHours > 0 && diffHours <= 168;
  });

  for (const task of upcomingTasks) {
    totalTaskHours += task.hoursRemaining;
  }

  // Calculate total free slots available in next 7 days
  for (const slot of freeSlots) {
    totalAvailableFreeMins += slot.durationMins;
  }

  const totalAvailableFreeHours = Math.round((totalAvailableFreeMins / 60) * 10) / 10;
  const isOverloaded = totalTaskHours > totalAvailableFreeHours;
  const deficitHours = Math.round(Math.max(0, totalTaskHours - totalAvailableFreeHours) * 10) / 10;

  let message = 'Your study schedule is well balanced with sufficient free slots.';
  if (isOverloaded) {
    message = `Overload Warning: You have ${totalTaskHours.toFixed(1)} hrs of coursework due this week, but only ${totalAvailableFreeHours.toFixed(1)} hrs of free time in your study slots (${deficitHours} hrs deficit). Consider extending study hours or breaking down tasks!`;
  }

  return {
    isOverloaded,
    totalTaskHoursDue: Math.round(totalTaskHours * 10) / 10,
    totalAvailableFreeHours,
    deficitHours,
    message,
  };
}
