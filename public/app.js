import React, { useState, useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  Upload,
  Calendar,
  CheckSquare,
  BookOpen,
  Settings,
  Bell,
  Sun,
  Moon,
  Clock,
  AlertTriangle,
  Zap,
  Plus,
  Trash2,
  Edit2,
  Check,
  ChevronRight,
  Search,
  FileText,
  Sparkles,
  RefreshCw,
  X,
  Filter,
  CheckCircle2,
  ArrowUpRight,
  PieChart,
  User,
  GraduationCap,
  Layers,
  ChevronDown
} from "lucide-react";

// Formatters & Helpers
const formatTime12h = window.StudyPilotFreeSlots?.formatTime12h || ((t) => t);

function App() {
  const [activePage, setActivePage] = useState("dashboard");
  const [theme, setTheme] = useState(localStorage.getItem("theme") || "system");
  const [student, setStudent] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [timetable, setTimetable] = useState({ slots: [], blocked: [] });
  const [assignments, setAssignments] = useState([]);
  const [syllabus, setSyllabus] = useState({ topics: [], exams: [] });
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  // Modals state
  const [isAddAssignmentOpen, setIsAddAssignmentOpen] = useState(false);
  const [isAddSubjectOpen, setIsAddSubjectOpen] = useState(false);
  const [isAddSlotOpen, setIsAddSlotOpen] = useState(false);
  const [isAddExamOpen, setIsAddExamOpen] = useState(false);
  const [isAddTopicOpen, setIsAddTopicOpen] = useState(false);

  // Upload state
  const [extractionReview, setExtractionReview] = useState(null);

  // Apply Dark Mode Class
  useEffect(() => {
    if (theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme]);

  // Load All Data from API
  const loadData = async () => {
    try {
      setRefreshing(true);
      const [stRes, subRes, ttRes, asRes, sylRes, anaRes] = await Promise.all([
        fetch("./api/auth/me").then(r => r.json()),
        fetch("./api/subjects").then(r => r.json()),
        fetch("./api/timetable").then(r => r.json()),
        fetch("./api/assignments").then(r => r.json()),
        fetch("./api/syllabus").then(r => r.json()),
        fetch("./api/schedule/analyze").then(r => r.json()),
      ]);

      if (stRes.student) setStudent(stRes.student);
      if (subRes.subjects) setSubjects(subRes.subjects);
      if (ttRes) setTimetable({ slots: ttRes.slots || [], blocked: ttRes.blocked || [] });
      if (asRes.assignments) setAssignments(asRes.assignments);
      if (sylRes) setSyllabus({ topics: sylRes.topics || [], exams: sylRes.exams || [] });
      if (anaRes) setAnalysis(anaRes);
    } catch (err) {
      console.error("Failed loading StudyPilot data", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Notifications calculation
  const notifications = useMemo(() => {
    const list = [];
    const now = new Date();

    // Tasks due within 48h
    assignments.filter(a => a.status !== 'done').forEach(a => {
      const diffHours = (new Date(a.deadline).getTime() - now.getTime()) / (1000 * 60 * 60);
      if (diffHours > 0 && diffHours <= 48) {
        list.push({
          id: `notif_asgn_${a.id}`,
          type: 'urgent',
          title: `Assignment Due Soon: ${a.title}`,
          message: `Due in ${Math.round(diffHours)} hours. Worth ${a.marks_weight}% of grade.`,
          time: `${Math.round(diffHours)}h remaining`
        });
      }
    });

    // Upcoming exams within 7 days
    syllabus.exams.forEach(e => {
      const diffHours = (new Date(e.date).getTime() - now.getTime()) / (1000 * 60 * 60);
      if (diffHours > 0 && diffHours <= 168) {
        const days = Math.ceil(diffHours / 24);
        list.push({
          id: `notif_exam_${e.id}`,
          type: 'exam',
          title: `Upcoming Exam: ${e.title}`,
          message: `Exam scheduled in ${days} day(s) on ${new Date(e.date).toLocaleDateString()}.`,
          time: `${days}d left`
        });
      }
    });

    // Next study slot reminder
    if (analysis && analysis.todaySlots && analysis.todaySlots.length > 0) {
      const nextSlot = analysis.todaySlots[0];
      list.push({
        id: 'notif_slot_next',
        type: 'slot',
        title: `Next Free Study Slot`,
        message: `Today ${formatTime12h(nextSlot.startTime)} - ${formatTime12h(nextSlot.endTime)} (${nextSlot.durationMins} mins available)`,
        time: 'Today'
      });
    }

    return list;
  }, [assignments, syllabus, analysis]);

  // Actions
  const handleToggleAssignmentStatus = async (id, currentStatus) => {
    const nextStatus = currentStatus === 'done' ? 'in_progress' : 'done';
    await fetch(`./api/assignments/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus })
    });
    loadData();
  };

  const handleUpdateAssignmentProgress = async (id, newProgress) => {
    const status = newProgress === 100 ? 'done' : newProgress > 0 ? 'in_progress' : 'not_started';
    await fetch(`./api/assignments/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progress: newProgress, status })
    });
    loadData();
  };

  const handleToggleSubtask = async (assignment, subtaskId) => {
    const updatedSubtasks = assignment.subtasks.map(st =>
      st.id === subtaskId ? { ...st, completed: !st.completed } : st
    );
    const completedCount = updatedSubtasks.filter(st => st.completed).length;
    const calcProgress = Math.round((completedCount / updatedSubtasks.length) * 100);

    await fetch(`./api/assignments/${assignment.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subtasks: updatedSubtasks,
        progress: calcProgress,
        status: calcProgress === 100 ? 'done' : 'in_progress'
      })
    });
    loadData();
  };

  const handleToggleSyllabusTopic = async (topicId) => {
    await fetch(`./api/syllabus/topics/${topicId}/toggle`, { method: 'PUT' });
    loadData();
  };

  const handleResetSampleData = async () => {
    if (confirm("Reset StudyPilot to pristine sample student data?")) {
      await fetch("./api/seed/reset", { method: "POST" });
      loadData();
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-sm text-slate-500 font-medium">Loading StudyPilot Academic Planner...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden">
      {/* SIDEBAR */}
      <aside className="w-64 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col shrink-0">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold shadow-sm">
            <GraduationCap className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-semibold text-base leading-none tracking-tight">StudyPilot</h1>
            <p className="text-xs text-slate-500 mt-1">Smart Academic Planner</p>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          <NavItem id="dashboard" icon={<LayoutDashboard className="w-4 h-4" />} label="Dashboard" activePage={activePage} setActivePage={setActivePage} />
          <NavItem id="upload" icon={<Upload className="w-4 h-4" />} label="Upload Center" activePage={activePage} setActivePage={setActivePage} badge="AI Extract" />
          <NavItem id="timetable" icon={<Calendar className="w-4 h-4" />} label="Timetable" activePage={activePage} setActivePage={setActivePage} />
          <NavItem id="assignments" icon={<CheckSquare className="w-4 h-4" />} label="Assignments" activePage={activePage} setActivePage={setActivePage} badge={assignments.filter(a => a.status !== 'done').length.toString()} />
          <NavItem id="syllabus" icon={<BookOpen className="w-4 h-4" />} label="Syllabus & Exams" activePage={activePage} setActivePage={setActivePage} />
          <NavItem id="settings" icon={<Settings className="w-4 h-4" />} label="Settings" activePage={activePage} setActivePage={setActivePage} />
        </nav>

        {/* Subjects list summary */}
        <div className="p-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold uppercase text-slate-400 tracking-wider px-2">
            <span>Enrolled Subjects</span>
            <button onClick={() => setIsAddSubjectOpen(true)} className="hover:text-indigo-600 transition-colors">
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="space-y-1">
            {subjects.map(s => (
              <div key={s.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                <span className="truncate flex-1 font-medium">{s.code || s.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Student Profile Footer */}
        <div className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 flex items-center justify-center font-semibold text-xs shrink-0">
              {student?.name?.charAt(0) || "S"}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">{student?.name || "Student"}</p>
              <p className="text-[11px] text-slate-500 truncate">{student?.email}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* TOP HEADER BAR */}
        <header className="h-14 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold capitalize text-slate-900 dark:text-slate-100">
              {activePage === 'dashboard' ? 'Academic Command Center' : activePage.replace('-', ' ')}
            </h2>
            {refreshing && (
              <span className="text-xs text-indigo-600 flex items-center gap-1 animate-pulse">
                <RefreshCw className="w-3 h-3 animate-spin" /> Syncing...
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Dark Mode Toggle */}
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Toggle Theme"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {/* Notification Dropdown Trigger */}
            <div className="relative">
              <button
                onClick={() => setNotificationsOpen(!notificationsOpen)}
                className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors relative"
              >
                <Bell className="w-4 h-4" />
                {notifications.length > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white dark:ring-slate-900" />
                )}
              </button>

              {/* Notification Drawer Popover */}
              {notificationsOpen && (
                <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-800 p-3 z-50 animate-popover-enter">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 uppercase tracking-wider">In-App Notifications</span>
                    <span className="text-xs bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 font-medium px-2 py-0.5 rounded-full">{notifications.length}</span>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-80 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <p className="text-xs text-slate-500 py-4 text-center">No active reminders right now.</p>
                    ) : (
                      notifications.map(n => (
                        <div key={n.id} className="py-2.5 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">{n.title}</span>
                            <span className="text-[10px] text-slate-400">{n.time}</span>
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-400">{n.message}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Quick Add Assignment Button */}
            <button
              onClick={() => setIsAddAssignmentOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Task</span>
            </button>
          </div>
        </header>

        {/* PAGE CONTENT CONTAINER */}
        <main className="flex-1 overflow-y-auto p-6">
          {activePage === "dashboard" && (
            <DashboardPage
              analysis={analysis}
              assignments={assignments}
              subjects={subjects}
              syllabus={syllabus}
              onToggleStatus={handleToggleAssignmentStatus}
              onProgressChange={handleUpdateAssignmentProgress}
              onNavigate={setActivePage}
            />
          )}

          {activePage === "upload" && (
            <UploadPage
              subjects={subjects}
              onExtractedData={(type, data) => setExtractionReview({ type, data })}
              onRefresh={loadData}
              onOpenAddAssignment={() => setIsAddAssignmentOpen(true)}
              onOpenAddSlot={() => setIsAddSlotOpen(true)}
              onOpenAddTopic={() => setIsAddTopicOpen(true)}
            />
          )}

          {activePage === "timetable" && (
            <TimetablePage
              timetable={timetable}
              subjects={subjects}
              student={student}
              freeSlots={analysis?.todaySlots || []}
              onRefresh={loadData}
              onOpenAddSlot={() => setIsAddSlotOpen(true)}
            />
          )}

          {activePage === "assignments" && (
            <AssignmentsPage
              assignments={assignments}
              subjects={subjects}
              exams={syllabus.exams}
              onToggleStatus={handleToggleAssignmentStatus}
              onProgressChange={handleUpdateAssignmentProgress}
              onToggleSubtask={handleToggleSubtask}
              onOpenAdd={() => setIsAddAssignmentOpen(true)}
              onRefresh={loadData}
            />
          )}

          {activePage === "syllabus" && (
            <SyllabusPage
              syllabus={syllabus}
              subjects={subjects}
              onToggleTopic={handleToggleSyllabusTopic}
              onOpenAddExam={() => setIsAddExamOpen(true)}
              onOpenAddTopic={() => setIsAddTopicOpen(true)}
              onRefresh={loadData}
            />
          )}

          {activePage === "settings" && (
            <SettingsPage
              student={student}
              subjects={subjects}
              theme={theme}
              setTheme={setTheme}
              onRefresh={loadData}
              onResetSampleData={handleResetSampleData}
              onOpenAddSubject={() => setIsAddSubjectOpen(true)}
            />
          )}
        </main>
      </div>

      {/* --- MODALS --- */}

      {/* 1. Add Assignment Modal */}
      {isAddAssignmentOpen && (
        <AddAssignmentModal
          subjects={subjects}
          onClose={() => setIsAddAssignmentOpen(false)}
          onCreated={loadData}
        />
      )}

      {/* 2. Add Subject Modal */}
      {isAddSubjectOpen && (
        <AddSubjectModal
          onClose={() => setIsAddSubjectOpen(false)}
          onCreated={loadData}
        />
      )}

      {/* 3. Add Timetable Slot Modal */}
      {isAddSlotOpen && (
        <AddSlotModal
          subjects={subjects}
          onClose={() => setIsAddSlotOpen(false)}
          onCreated={loadData}
        />
      )}

      {/* 4. Add Exam Modal */}
      {isAddExamOpen && (
        <AddExamModal
          subjects={subjects}
          onClose={() => setIsAddExamOpen(false)}
          onCreated={loadData}
        />
      )}

      {/* 5. Extraction Review Modal Drawer */}
      {extractionReview && (
        <ExtractionReviewModal
          review={extractionReview}
          subjects={subjects}
          onClose={() => setExtractionReview(null)}
          onSaved={() => {
            setExtractionReview(null);
            loadData();
          }}
        />
      )}
    </div>
  );
}

// NavItem Primitive
function NavItem({ id, icon, label, activePage, setActivePage, badge }) {
  const active = activePage === id;
  return (
    <button
      onClick={() => setActivePage(id)}
      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
        active
          ? "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-semibold"
          : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
      }`}
    >
      <div className="flex items-center gap-2.5">
        {icon}
        <span>{label}</span>
      </div>
      {badge && (
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
          active ? "bg-indigo-200 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-200" : "bg-slate-100 dark:bg-slate-800 text-slate-500"
        }`}>
          {badge}
        </span>
      )}
    </button>
  );
}

// ==========================================
// 1. DASHBOARD PAGE
// ==========================================
function DashboardPage({ analysis, assignments, subjects, syllabus, onToggleStatus, onProgressChange, onNavigate }) {
  const topTask = analysis?.doFirstTask;
  const overload = analysis?.overloadInfo;
  const todayPlan = analysis?.scheduledTodayPlan || [];

  const pendingCount = assignments.filter(a => a.status !== 'done').length;
  const totalTopics = syllabus?.topics?.length || 1;
  const completedTopics = syllabus?.topics?.filter(t => t.is_completed)?.length || 0;
  const syllabusPct = Math.round((completedTopics / totalTopics) * 100);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* OVERLOAD WARNING BANNER */}
      {overload && overload.isOverloaded && (
        <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 text-xs">
            <h4 className="font-semibold text-sm">Workload Overload Alert</h4>
            <p className="mt-0.5">{overload.message}</p>
          </div>
          <button onClick={() => onNavigate('timetable')} className="px-3 py-1 rounded bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 transition-colors">
            Adjust Study Hours
          </button>
        </div>
      )}

      {/* TOP SECTION: DO THIS FIRST HERO CARD */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="bg-gradient-to-br from-indigo-900 via-slate-900 to-slate-900 text-white rounded-2xl p-6 border border-indigo-800 shadow-md relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
              <Zap className="w-48 h-48 text-indigo-400" />
            </div>

            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                  Do This First
                </span>
                {topTask && (
                  <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[11px] font-semibold border border-rose-500/30">
                    Priority Score: {topTask.priorityScore} ({topTask.urgencyLevel} Urgency)
                  </span>
                )}
              </div>
              <span className="text-xs text-slate-400">AI Priority Engine</span>
            </div>

            {topTask ? (
              <div className="space-y-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: topTask.subject_color || '#5E6AD2' }} />
                    <span className="text-xs font-medium text-slate-300">{topTask.subject_name || 'Academic'}</span>
                  </div>
                  <h3 className="text-xl font-bold mt-1 text-white tracking-tight">{topTask.title}</h3>
                  <p className="text-xs text-slate-300 mt-2 line-clamp-2">{topTask.description}</p>
                </div>

                {/* AI Reason Badge */}
                <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700/60 text-xs text-indigo-200 flex items-start gap-2">
                  <Zap className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-white">Why right now?</strong> {topTask.reason}.
                  </div>
                </div>

                {/* Progress & Quick Actions */}
                <div className="space-y-2 pt-1">
                  <div className="flex justify-between text-xs text-slate-300">
                    <span>Progress Done</span>
                    <span className="font-mono">{topTask.progress}% ({topTask.hoursRemaining.toFixed(1)}h remaining)</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${topTask.progress}%` }} />
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    onClick={() => onToggleStatus(topTask.id, topTask.status)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors shadow-sm"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Mark Task Done</span>
                  </button>
                  <button
                    onClick={() => onNavigate('assignments')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors border border-slate-700"
                  >
                    <span>View Task Subtasks</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-slate-300 space-y-2">
                <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
                <h3 className="text-base font-semibold text-white">All caught up!</h3>
                <p className="text-xs text-slate-400">No active pending assignments right now. Enjoy your free time!</p>
              </div>
            )}
          </div>
        </div>

        {/* KPI CARDS */}
        <div className="space-y-3">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Pending Assignments</span>
              <CheckSquare className="w-4 h-4 text-indigo-500" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono">{pendingCount}</span>
              <span className="text-xs text-slate-400">active tasks</span>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Free Study Hours Today</span>
              <Clock className="w-4 h-4 text-emerald-500" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono">{analysis?.overloadInfo?.totalAvailableFreeHours || 0}</span>
              <span className="text-xs text-slate-400">hours available</span>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Syllabus Completion</span>
              <BookOpen className="w-4 h-4 text-amber-500" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono">{syllabusPct}%</span>
              <span className="text-xs text-slate-400">{completedTopics}/{totalTopics} topics</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 mt-2 overflow-hidden">
              <div className="h-full bg-amber-500" style={{ width: `${syllabusPct}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* TODAY'S SCHEDULE TIMELINE & UPCOMING DEADLINES */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* TODAY'S PLAN TIMELINE */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold tracking-tight">Today's Plan</h3>
              <p className="text-xs text-slate-500">Auto-scheduled task slots based on your timetable</p>
            </div>
            <button onClick={() => onNavigate('timetable')} className="text-xs text-indigo-600 font-medium hover:underline flex items-center gap-1">
              <span>View Full Week</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-3">
            {todayPlan.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">No free study slots detected for today.</p>
            ) : (
              todayPlan.map((item, idx) => (
                <div key={idx} className="flex items-start gap-3 p-3 rounded-lg border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <div className="w-20 shrink-0 text-xs font-mono font-medium text-slate-500">
                    <div>{formatTime12h(item.slot.startTime)}</div>
                    <div className="text-[10px] text-slate-400">{item.durationMins} min</div>
                  </div>

                  <div className="w-1 h-10 rounded-full shrink-0" style={{ backgroundColor: item.subjectColor || '#5E6AD2' }} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">{item.taskTitle}</h4>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-medium">{item.subjectName}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate">{item.recommendationReason}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* UPCOMING DEADLINES RANKED TABLE */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold tracking-tight">Upcoming Deadlines</h3>
              <p className="text-xs text-slate-500">Ranked by smart multi-factor priority score</p>
            </div>
            <button onClick={() => onNavigate('assignments')} className="text-xs text-indigo-600 font-medium hover:underline">
              Manage Tasks
            </button>
          </div>

          <div className="space-y-2">
            {analysis?.rankedTasks?.slice(0, 4).map(task => (
              <div key={task.id} className="flex items-center justify-between p-3 rounded-lg border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: task.subject_color || '#5E6AD2' }} />
                  <div className="min-w-0">
                    <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">{task.title}</h4>
                    <p className="text-[11px] text-slate-500">{task.subject_name} · Due {new Date(task.deadline).toLocaleDateString()}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                    task.urgencyLevel === 'High' ? 'bg-rose-50 dark:bg-rose-950 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900' :
                    task.urgencyLevel === 'Medium' ? 'bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-900' :
                    'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                  }`}>
                    {task.urgencyLevel} ({task.priorityScore})
                  </span>
                  <button
                    onClick={() => onToggleStatus(task.id, task.status)}
                    className="p-1 rounded text-slate-400 hover:text-emerald-600 transition-colors"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 2. UPLOAD CENTER PAGE
// ==========================================
function UploadPage({ subjects, onExtractedData, onRefresh, onOpenAddAssignment, onOpenAddSlot, onOpenAddTopic }) {
  const [activeTab, setActiveTab] = useState("timetable");
  const [isProcessing, setIsProcessing] = useState(false);
  const [pasteContent, setPasteContent] = useState("");

  const handleSimulatedFileUpload = async (type, sampleText) => {
    setIsProcessing(true);
    try {
      const res = await fetch("./api/ai/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          content: sampleText || pasteContent || "Sample academic file uploaded"
        })
      }).then(r => r.json());

      if (res.extracted) {
        onExtractedData(type, res.extracted);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Upload Center</h2>
          <p className="text-xs text-slate-500 mt-0.5">Upload PDF, DOCX, Images, or CSV/XLSX to automatically extract structured schedule data.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onOpenAddAssignment} className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800">
            + Manual Task
          </button>
          <button onClick={onOpenAddSlot} className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800">
            + Manual Class
          </button>
        </div>
      </div>

      {/* 3 Zone Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-6">
        <button
          onClick={() => setActiveTab("timetable")}
          className={`pb-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === "timetable" ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" : "border-transparent text-slate-500 hover:text-slate-900"
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>Zone 1: Timetable Schedule</span>
        </button>
        <button
          onClick={() => setActiveTab("syllabus")}
          className={`pb-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === "syllabus" ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" : "border-transparent text-slate-500 hover:text-slate-900"
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>Zone 2: Syllabus per Subject</span>
        </button>
        <button
          onClick={() => setActiveTab("assignments")}
          className={`pb-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === "assignments" ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" : "border-transparent text-slate-500 hover:text-slate-900"
          }`}
        >
          <CheckSquare className="w-4 h-4" />
          <span>Zone 3: Assignments & Rubrics</span>
        </button>
      </div>

      {/* DRAG & DROP ZONE & PASTE BOX */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upload Dropzone */}
        <div className="bg-white dark:bg-slate-900 border-2 border-dashed border-slate-300 dark:border-slate-800 rounded-2xl p-8 text-center flex flex-col items-center justify-center space-y-4 hover:border-indigo-500 transition-colors">
          <div className="w-12 h-12 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-600 flex items-center justify-center">
            <Upload className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Drop your {activeTab} document here</h3>
            <p className="text-xs text-slate-500 mt-1">Supports PDF, DOCX, JPG/PNG photo, or CSV/XLSX file</p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => handleSimulatedFileUpload(activeTab, getSampleTextForZone(activeTab))}
              disabled={isProcessing}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-1.5 shadow-sm"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>AI Parsing File...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Parse Sample {activeTab} Document</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Text Paste Fallback */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Or Paste Raw Text directly</h3>
            <span className="text-[10px] text-slate-400">OCR / Text Extraction</span>
          </div>
          <textarea
            value={pasteContent}
            onChange={(e) => setPasteContent(e.target.value)}
            placeholder={`Paste raw ${activeTab} content here (e.g., lecture times, syllabus topics, assignment requirements)...`}
            className="w-full h-36 p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs focus:outline-none focus:border-indigo-600"
          />
          <button
            onClick={() => handleSimulatedFileUpload(activeTab, pasteContent)}
            disabled={!pasteContent || isProcessing}
            className="w-full py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            Extract Structured Data
          </button>
        </div>
      </div>
    </div>
  );
}

function getSampleTextForZone(type) {
  if (type === 'timetable') {
    return "Monday 09:00 - 10:30 Data Structures Lecture Room 302\nMonday 14:00 - 16:00 Computer Systems Lab 4B\nWednesday 11:00 - 12:30 Linear Algebra Tutorial Math 101";
  } else if (type === 'syllabus') {
    return "Unit 1: Foundations\nSystem Architecture & Memory Hierarchy\nUnit 2: Concurrent Systems\nThread Scheduling & Concurrency\nMidterm Exam October 24 2:00 PM";
  } else {
    return "Assignment 1: Virtual Memory Simulation Lab\nDue in 2 days. Worth 20% of final grade.\nImplement LRU cache page replacement and plot fault metrics.";
  }
}

// ==========================================
// 3. TIMETABLE PAGE
// ==========================================
function TimetablePage({ timetable, subjects, student, freeSlots, onRefresh, onOpenAddSlot }) {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const hours = Array.from({ length: 14 }, (_, i) => i + 8); // 8 AM to 9 PM

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Weekly Timetable</h2>
          <p className="text-xs text-slate-500">Classes, recurring blocked times, and automatically computed free slots.</p>
        </div>
        <button onClick={onOpenAddSlot} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 flex items-center gap-1">
          <Plus className="w-3.5 h-3.5" />
          <span>Add Class</span>
        </button>
      </div>

      {/* WEEKLY GRID */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
        <div className="grid grid-cols-8 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs font-semibold text-slate-500">
          <div className="p-3 border-r border-slate-200 dark:border-slate-800 text-center">Time</div>
          {days.map((d, i) => (
            <div key={d} className="p-3 text-center border-r border-slate-200 dark:border-slate-800 last:border-r-0">
              {d}
            </div>
          ))}
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800/60 max-h-[600px] overflow-y-auto">
          {hours.map(h => (
            <div key={h} className="grid grid-cols-8 min-h-[50px] text-xs">
              <div className="p-2 border-r border-slate-200 dark:border-slate-800 text-slate-400 font-mono text-[11px] text-center">
                {h}:00
              </div>
              {days.map((_, dayIdx) => {
                const dayNum = dayIdx === 6 ? 0 : dayIdx + 1; // Mon=1..Sun=0
                const matchedSlots = timetable.slots.filter(s => {
                  const sH = parseInt(s.start_time.split(':')[0], 10);
                  return s.day === dayNum && sH === h;
                });

                return (
                  <div key={dayIdx} className="border-r border-slate-100 dark:border-slate-800/40 p-1 relative last:border-r-0">
                    {matchedSlots.map(s => (
                      <div
                        key={s.id}
                        className="p-1.5 rounded text-[11px] text-white font-medium shadow-2xs space-y-0.5"
                        style={{ backgroundColor: s.subject_color || '#5E6AD2' }}
                      >
                        <div className="font-semibold truncate">{s.subject_code || s.subject_name}</div>
                        <div className="text-[10px] opacity-90 truncate">{s.start_time}-{s.end_time} ({s.type})</div>
                        {s.room && <div className="text-[9px] opacity-80 truncate">{s.room}</div>}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 4. ASSIGNMENTS PAGE
// ==========================================
function AssignmentsPage({ assignments, subjects, exams, onToggleStatus, onProgressChange, onToggleSubtask, onOpenAdd, onRefresh }) {
  const [filterSubject, setFilterSubject] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const filtered = assignments.filter(a => {
    if (filterSubject !== "all" && a.subject_id !== filterSubject) return false;
    if (filterStatus !== "all" && a.status !== filterStatus) return false;
    return true;
  });

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Assignment Task Manager</h2>
          <p className="text-xs text-slate-500">Track progress, subtasks, estimated hours, and formula-backed priority ranking.</p>
        </div>
        <button onClick={onOpenAdd} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors shadow-sm self-start sm:self-auto flex items-center gap-1.5">
          <Plus className="w-4 h-4" />
          <span>New Assignment</span>
        </button>
      </div>

      {/* FILTER BAR */}
      <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs">
        <Filter className="w-4 h-4 text-slate-400" />
        <div className="flex items-center gap-2">
          <span className="text-slate-500 font-medium">Subject:</span>
          <select
            value={filterSubject}
            onChange={(e) => setFilterSubject(e.target.value)}
            className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs"
          >
            <option value="all">All Subjects</option>
            {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-slate-500 font-medium">Status:</span>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs"
          >
            <option value="all">All Statuses</option>
            <option value="not_started">Not Started</option>
            <option value="in_progress">In Progress</option>
            <option value="done">Completed</option>
          </select>
        </div>
      </div>

      {/* TASK LIST CARDS */}
      <div className="space-y-4">
        {filtered.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl text-slate-400 text-xs space-y-2">
            <CheckSquare className="w-8 h-8 mx-auto text-slate-300" />
            <p>No assignments match your filter query.</p>
          </div>
        ) : (
          filtered.map(a => (
            <div key={a.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800/60 pb-3">
                <div className="flex items-center gap-2.5">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: a.subject_color || '#5E6AD2' }} />
                  <div>
                    <span className="text-[11px] font-semibold text-slate-500 uppercase">{a.subject_name}</span>
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{a.title}</h3>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs font-mono font-medium">
                    {a.marks_weight}% Weight
                  </span>
                  <span className="px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 text-xs font-mono font-medium">
                    {a.estimated_hours}h Effort
                  </span>
                  <button
                    onClick={() => onToggleStatus(a.id, a.status)}
                    className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                      a.status === 'done' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 hover:bg-slate-200'
                    }`}
                  >
                    {a.status === 'done' ? 'Completed' : a.status === 'in_progress' ? 'In Progress' : 'Not Started'}
                  </button>
                </div>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-400">{a.description}</p>

              {/* Progress Slider */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500 font-medium">Progress Slider</span>
                  <span className="font-mono text-indigo-600 font-semibold">{a.progress}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={a.progress}
                  onChange={(e) => onProgressChange(a.id, parseInt(e.target.value, 10))}
                  className="w-full accent-indigo-600 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              {/* Subtasks Checklist */}
              {a.subtasks && a.subtasks.length > 0 && (
                <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-lg space-y-2 border border-slate-100 dark:border-slate-800">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Subtasks</span>
                  <div className="space-y-1.5">
                    {a.subtasks.map(st => (
                      <label key={st.id} className="flex items-center gap-2 text-xs cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={st.completed}
                          onChange={() => onToggleSubtask(a, st.id)}
                          className="rounded text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className={st.completed ? "line-through text-slate-400" : "text-slate-700 dark:text-slate-300"}>
                          {st.title}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ==========================================
// 5. SYLLABUS & EXAMS PAGE
// ==========================================
function SyllabusPage({ syllabus, subjects, onToggleTopic, onOpenAddExam, onOpenAddTopic, onRefresh }) {
  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* UPCOMING EXAMS SECTION */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight">Upcoming Exams & AI Revision Plans</h2>
            <p className="text-xs text-slate-500">Exams with automated step-by-step revision schedules.</p>
          </div>
          <button onClick={onOpenAddExam} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700">
            + Schedule Exam
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {syllabus.exams.map(exam => (
            <div key={exam.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[11px] font-semibold text-slate-400 uppercase">{exam.subject_name}</span>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{exam.title}</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Date: {new Date(exam.date).toLocaleDateString()} · {exam.duration_mins} mins</p>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-rose-50 dark:bg-rose-950 text-rose-600 dark:text-rose-400 text-xs font-bold border border-rose-200 dark:border-rose-900">
                  {exam.weightage}% Grade
                </span>
              </div>

              {/* AI Revision Plan Timeline */}
              {exam.revision_plan && exam.revision_plan.length > 0 && (
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>AI Revision Roadmap</span>
                  </div>
                  <div className="space-y-1.5">
                    {exam.revision_plan.map((step, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400">
                        <span className="font-mono text-[10px] bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-1.5 py-0.5 rounded shrink-0">
                          Day {step.dayOffset}
                        </span>
                        <span>{step.task}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* SYLLABUS TRACKER PER SUBJECT */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold">Syllabus Topic Checklist</h3>
          <button onClick={onOpenAddTopic} className="text-xs text-indigo-600 font-medium hover:underline">
            + Add Topic
          </button>
        </div>

        <div className="space-y-4">
          {subjects.map(subj => {
            const subjTopics = syllabus.topics.filter(t => t.subject_id === subj.id);
            const completed = subjTopics.filter(t => t.is_completed).length;
            const pct = subjTopics.length > 0 ? Math.round((completed / subjTopics.length) * 100) : 0;

            return (
              <div key={subj.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: subj.color }} />
                    <h4 className="text-sm font-bold">{subj.name} ({subj.code})</h4>
                  </div>
                  <span className="text-xs font-mono font-semibold text-indigo-600">{pct}% Completed</span>
                </div>

                <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div className="h-full bg-indigo-600 transition-all" style={{ width: `${pct}%` }} />
                </div>

                <div className="divide-y divide-slate-100 dark:divide-slate-800 pt-2">
                  {subjTopics.map(topic => (
                    <label key={topic.id} className="py-2.5 flex items-center justify-between text-xs cursor-pointer select-none">
                      <div className="flex items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={topic.is_completed}
                          onChange={() => onToggleTopic(topic.id)}
                          className="rounded text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className={topic.is_completed ? "line-through text-slate-400" : "text-slate-700 dark:text-slate-300 font-medium"}>
                          {topic.title}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">{topic.unit}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 6. SETTINGS PAGE
// ==========================================
function SettingsPage({ student, subjects, theme, setTheme, onRefresh, onResetSampleData, onOpenAddSubject }) {
  const [studyStart, setStudyStart] = useState(student?.study_hours_start || '16:00');
  const [studyEnd, setStudyEnd] = useState(student?.study_hours_end || '22:00');
  const [name, setName] = useState(student?.name || 'Alex Vance');

  const handleSaveSettings = async () => {
    await fetch("./api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        study_hours_start: studyStart,
        study_hours_end: studyEnd,
        name,
        theme
      })
    });
    alert("Settings saved!");
    onRefresh();
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Student Settings</h2>
        <p className="text-xs text-slate-500">Configure daily study windows, color preferences, and seed demo data.</p>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-5 shadow-xs">
        <h3 className="text-sm font-bold border-b border-slate-100 dark:border-slate-800 pb-2">Daily Study Hours Window</h3>
        
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Study Window Start Time</label>
            <input
              type="time"
              value={studyStart}
              onChange={(e) => setStudyStart(e.target.value)}
              className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs font-mono"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Study Window End Time</label>
            <input
              type="time"
              value={studyEnd}
              onChange={(e) => setStudyEnd(e.target.value)}
              className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs font-mono"
            />
          </div>
        </div>

        <button
          onClick={handleSaveSettings}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors"
        >
          Save Study Hours
        </button>
      </div>

      {/* RE-SEED DEMO DATA */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 shadow-xs">
        <h3 className="text-sm font-bold text-rose-600">Sample Demo Data Reset</h3>
        <p className="text-xs text-slate-500">Instantly populate StudyPilot with rich sample student data (4 subjects, timetable, assignments, exams).</p>
        <button
          onClick={onResetSampleData}
          className="px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 transition-colors"
        >
          Re-seed Sample Student Data
        </button>
      </div>
    </div>
  );
}

// ==========================================
// MODALS
// ==========================================

function AddAssignmentModal({ subjects, onClose, onCreated }) {
  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState(subjects[0]?.id || "");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState(new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 16));
  const [marksWeight, setMarksWeight] = useState(15);
  const [estimatedHours, setEstimatedHours] = useState(3);

  const handleSubmit = async (e) => {
    e.preventDefault();
    await fetch("./api/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        subject_id: subjectId,
        description,
        deadline: new Date(deadline).toISOString(),
        marks_weight: parseFloat(marksWeight),
        estimated_hours: parseFloat(estimatedHours),
        subtasks: [
          { id: "st1", title: "Read specification sheet", completed: false },
          { id: "st2", title: "Core work draft", completed: false }
        ]
      })
    });
    onCreated();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 w-full max-w-md shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <h3 className="text-base font-bold">New Assignment Task</h3>
          <button onClick={onClose} className="p-1 rounded text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <div>
            <label className="block font-medium mb-1">Title</label>
            <input required value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Lab Report 3" className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950" />
          </div>

          <div>
            <label className="block font-medium mb-1">Subject</label>
            <select value={subjectId} onChange={e => setSubjectId(e.target.value)} className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block font-medium mb-1">Deadline Date & Time</label>
            <input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium mb-1">Marks Weight (%)</label>
              <input type="number" value={marksWeight} onChange={e => setMarksWeight(e.target.value)} className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950" />
            </div>
            <div>
              <label className="block font-medium mb-1">Est. Effort (Hours)</label>
              <input type="number" step="0.5" value={estimatedHours} onChange={e => setEstimatedHours(e.target.value)} className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950" />
            </div>
          </div>

          <div>
            <label className="block font-medium mb-1">Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Task guidelines..." className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 h-20" />
          </div>

          <button type="submit" className="w-full py-2.5 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition-colors">
            Create Assignment
          </button>
        </form>
      </div>
    </div>
  );
}

function AddSubjectModal({ onClose, onCreated }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [color, setColor] = useState("#5E6AD2");

  const handleSubmit = async (e) => {
    e.preventDefault();
    await fetch("./api/subjects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, code, color })
    });
    onCreated();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 w-full max-w-sm shadow-xl space-y-4">
        <h3 className="text-base font-bold">Add Subject</h3>
        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <input required placeholder="Subject Name" value={name} onChange={e => setName(e.target.value)} className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950" />
          <input required placeholder="Subject Code (e.g. CS101)" value={code} onChange={e => setCode(e.target.value)} className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950" />
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Color Tag:</span>
            <input type="color" value={color} onChange={e => setColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0" />
          </div>
          <button type="submit" className="w-full py-2 rounded-lg bg-indigo-600 text-white font-semibold">Save Subject</button>
        </form>
      </div>
    </div>
  );
}

function AddSlotModal({ subjects, onClose, onCreated }) {
  const [day, setDay] = useState(1);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:30");
  const [subjectId, setSubjectId] = useState(subjects[0]?.id || "");
  const [type, setType] = useState("lecture");

  const handleSubmit = async (e) => {
    e.preventDefault();
    await fetch("./api/timetable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day: parseInt(day, 10), start_time: startTime, end_time: endTime, subject_id: subjectId, type })
    });
    onCreated();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 w-full max-w-sm shadow-xl space-y-4">
        <h3 className="text-base font-bold">Add Timetable Class Slot</h3>
        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <select value={day} onChange={e => setDay(e.target.value)} className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
            <option value="1">Monday</option>
            <option value="2">Tuesday</option>
            <option value="3">Wednesday</option>
            <option value="4">Thursday</option>
            <option value="5">Friday</option>
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950" />
            <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950" />
          </div>
          <select value={subjectId} onChange={e => setSubjectId(e.target.value)} className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
            {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={type} onChange={e => setType(e.target.value)} className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
            <option value="lecture">Lecture</option>
            <option value="lab">Lab</option>
            <option value="tutorial">Tutorial</option>
          </select>
          <button type="submit" className="w-full py-2 rounded-lg bg-indigo-600 text-white font-semibold">Save Class Slot</button>
        </form>
      </div>
    </div>
  );
}

function AddExamModal({ subjects, onClose, onCreated }) {
  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState(subjects[0]?.id || "");
  const [date, setDate] = useState(new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 16));

  const handleSubmit = async (e) => {
    e.preventDefault();
    await fetch("./api/exams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, subject_id: subjectId, date: new Date(date).toISOString() })
    });
    onCreated();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 w-full max-w-sm shadow-xl space-y-4">
        <h3 className="text-base font-bold">Schedule Exam</h3>
        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <input required placeholder="Exam Title" value={title} onChange={e => setTitle(e.target.value)} className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950" />
          <select value={subjectId} onChange={e => setSubjectId(e.target.value)} className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
            {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input type="datetime-local" value={date} onChange={e => setDate(e.target.value)} className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950" />
          <button type="submit" className="w-full py-2 rounded-lg bg-indigo-600 text-white font-semibold">Save Exam & AI Roadmap</button>
        </form>
      </div>
    </div>
  );
}

function ExtractionReviewModal({ review, subjects, onClose, onSaved }) {
  const [items, setItems] = useState(review.data || []);

  const handleSaveAll = async () => {
    if (review.type === 'assignments') {
      for (const item of items) {
        await fetch("./api/assignments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item)
        });
      }
    } else if (review.type === 'timetable') {
      for (const item of items) {
        await fetch("./api/timetable", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item)
        });
      }
    }
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 w-full max-w-2xl shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <h3 className="text-base font-bold">Review Extracted {review.type} Data</h3>
            <p className="text-xs text-slate-500">Edit any details before saving into your database.</p>
          </div>
          <button onClick={onClose} className="p-1 rounded text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>

        <div className="max-h-96 overflow-y-auto space-y-3">
          {Array.isArray(items) && items.map((item, idx) => (
            <div key={idx} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs space-y-2">
              <input
                value={item.title || item.subject_name || ""}
                onChange={(e) => {
                  const copy = [...items];
                  if (copy[idx].title) copy[idx].title = e.target.value;
                  else copy[idx].subject_name = e.target.value;
                  setItems(copy);
                }}
                className="font-bold w-full bg-transparent border-b border-slate-200 dark:border-slate-800"
              />
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-semibold">Cancel</button>
          <button onClick={handleSaveAll} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700">Confirm & Save Data</button>
        </div>
      </div>
    </div>
  );
}

// Render Root
const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(<App />);
}
