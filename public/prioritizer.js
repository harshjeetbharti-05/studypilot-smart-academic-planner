/**
 * StudyPilot - Client Prioritizer Mirror
 */

window.StudyPilotPrioritizer = {
  calculateTaskPriority(task, exams = [], now = new Date()) {
    const deadlineDate = new Date(task.deadline);
    const diffMs = deadlineDate.getTime() - now.getTime();
    const hoursUntilDue = Math.max(-24, diffMs / (1000 * 60 * 60));

    let urgencyScore = 0;
    if (hoursUntilDue <= 0) {
      urgencyScore = 110;
    } else if (hoursUntilDue <= 12) {
      urgencyScore = 100;
    } else if (hoursUntilDue <= 24) {
      urgencyScore = 90;
    } else if (hoursUntilDue <= 48) {
      urgencyScore = 80;
    } else if (hoursUntilDue <= 72) {
      urgencyScore = 65;
    } else if (hoursUntilDue <= 168) {
      urgencyScore = Math.max(20, 65 - ((hoursUntilDue - 72) / 96) * 35);
    } else {
      urgencyScore = Math.max(5, 30 - ((hoursUntilDue - 168) / 168) * 20);
    }

    const marksScore = Math.min(100, Math.max(10, (task.marks_weight || 10) * 3.33));
    const remainingRatio = 1 - ((task.progress || 0) / 100);
    const hoursRemaining = Math.max(0.25, (task.estimated_hours || 2) * remainingRatio);
    const effortScore = Math.min(100, hoursRemaining * 20);

    let proximityBoost = 0;
    const subjectExams = exams.filter(e => e.subject_id === task.subject_id);
    for (const exam of subjectExams) {
      const examDiffHours = (new Date(exam.date).getTime() - now.getTime()) / (1000 * 60 * 60);
      if (examDiffHours > 0 && examDiffHours <= 168) {
        proximityBoost += 25;
        break;
      }
    }

    const rawScore = (0.40 * urgencyScore) + (0.25 * marksScore) + (0.20 * effortScore) + (0.15 * proximityBoost);
    const priorityScore = Math.round(Math.max(0, rawScore) * 10) / 10;

    let urgencyLevel = 'Low';
    if (priorityScore >= 65 || hoursUntilDue <= 36) {
      urgencyLevel = 'High';
    } else if (priorityScore >= 40 || hoursUntilDue <= 96) {
      urgencyLevel = 'Medium';
    }

    const dueDays = Math.ceil(hoursUntilDue / 24);
    let dueText = hoursUntilDue < 0 ? 'Overdue' : hoursUntilDue <= 24 ? `Due in ${Math.round(hoursUntilDue)}h` : `Due in ${dueDays} days`;

    const reason = `${dueText}, worth ${task.marks_weight}% grade, ${hoursRemaining.toFixed(1)}h effort left`;

    return {
      priorityScore,
      urgencyLevel,
      hoursRemaining,
      hoursUntilDue,
      reason
    };
  }
};
