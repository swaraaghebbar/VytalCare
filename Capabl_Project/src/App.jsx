import React, { useState, useEffect, useCallback, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
// >> IMPORTED: orderBy, limit, where <<
import { getFirestore, collection, query, onSnapshot, addDoc, doc, deleteDoc, orderBy, limit, setDoc, writeBatch, getDocs, where, updateDoc } from 'firebase/firestore';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend, Area
} from 'recharts';
import appIcon from "./assets/iconn.png";



import { Plus, X, Trash2, Calendar, Clock, MessageSquare, Bell, Send, Link, Activity, Heart, Moon, Sun, Eye, CheckCircle, AlertCircle, ChevronRight, Droplet, Minus, Phone, Copy, User, Edit2, Save, Ruler, Footprints, Info, Mic, MicOff, Volume2, VolumeX, Globe, Paperclip, RefreshCw, ExternalLink } from 'lucide-react';

/** ---------------------------------------
 * App Config (unchanged)
 * -------------------------------------- */
const isLocalRun = typeof __initial_auth_token === 'undefined';

//Firebase Config 
const FIREBASE_LOCAL_CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MSG_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};


// Gemini & Google Fit keys (local)
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;


const appId = (typeof __app_id !== 'undefined' ? __app_id : 'local-health-app').replace(/[\/.]/g, '-');
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
const firebaseConfig = isLocalRun
  ? FIREBASE_LOCAL_CONFIG
  : (typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {});

// Health constants
const DAILY_STEP_GOAL = 10000;
const RECOMMENDED_SLEEP_HOURS = 7.5;

// COLOR SCHEME - Removed in favor of Tailwind classes
// const COLORS = { ... };

/** ---------------------------------------
 * Small UI Helpers (unchanged)
 * -------------------------------------- */
const LoadingSpinner = () => (
  <div className="flex justify-center items-center py-4">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin" />
    <span className="ml-3 text-primary font-medium">Loading...</span>
  </div>
);

const ColorBlindFilters = () => (
  <svg style={{ display: 'none' }}>
    <defs>
      <filter id="protanopia">
        <feColorMatrix type="matrix" values="0.567 0.433 0 0 0  0.558 0.442 0 0 0  0 0.242 0.758 0 0  0 0 0 1 0" />
      </filter>
      <filter id="deuteranopia">
        <feColorMatrix type="matrix" values="0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0" />
      </filter>
      <filter id="tritanopia">
        <feColorMatrix type="matrix" values="0.95 0.05 0 0 0  0 0.433 0.567 0 0  0 0.475 0.525 0 0  0 0 0 1 0" />
      </filter>
      <filter id="achromatopsia">
        <feColorMatrix type="matrix" values="0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0 0 0 1 0" />
      </filter>
    </defs>
  </svg>
);

const StepCompletionRing = ({ steps, goal, size = 150 }) => {
  const rawPercentage = (steps / goal) * 100;
  const percentage = Math.min(100, Math.round(rawPercentage));
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;
  const isComplete = percentage >= 100;

  return (
    <div className="relative flex flex-col items-center justify-center p-4">
      <svg width={size} height={size} viewBox="0 0 120 120" className="-rotate-90">
        <circle cx="60" cy="60" r={radius} fill="none" className="stroke-slate-200" strokeWidth="10" />
        <circle cx="60" cy="60" r={radius} fill="none"
          className={`transition-all duration-1000 ease-out ${isComplete ? 'stroke-green-500' : 'stroke-primary'}`}
          strokeWidth="10"
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center">
        <p className={`text-4xl font-extrabold ${isComplete ? 'text-green-600' : 'text-primary'}`}>{percentage}%</p>
        <p className="text-sm font-semibold mt-1 text-text-muted">Completed</p>
      </div>
    </div>
  );
};

const formatTime = (timeStr) => {
  if (!timeStr) return timeStr;
  // Handle HH:MM format (5 chars with colon)
  if (timeStr.length === 5 && timeStr.includes(':')) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    if (isNaN(hours) || isNaN(minutes)) return timeStr;
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  }
  // Handle HHMM format (4 chars without colon) - legacy
  if (timeStr.length === 4) {
    const hours = parseInt(timeStr.substring(0, 2), 10);
    const minutes = timeStr.substring(2, 4);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes} ${ampm}`;
  }
  return timeStr;
};

const formatTimeSeparator = (timestamp) => {
  if (!timestamp) return "Earlier";
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return isToday ? `Today · ${time}` : `${date.toLocaleDateString()} · ${time}`;
};

// Format time showing 24hr with 12hr in parentheses
const formatTimeWithBoth = (timeStr) => {
  if (!timeStr) return { time24: '', time12: '' };
  let hours, minutes;
  if (timeStr.length === 5 && timeStr.includes(':')) {
    [hours, minutes] = timeStr.split(':').map(Number);
  } else if (timeStr.length === 4) {
    hours = parseInt(timeStr.substring(0, 2), 10);
    minutes = parseInt(timeStr.substring(2, 4), 10);
  } else {
    return { time24: timeStr, time12: '' };
  }
  if (isNaN(hours) || isNaN(minutes)) return { time24: timeStr, time12: '' };
  const time24 = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const time12 = `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  return { time24, time12 };
};

const HealthScoreRing = ({ score, size = 180 }) => {
  const percentage = Math.min(100, Math.max(0, score));
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  let color = 'text-red-500';
  if (percentage >= 70) color = 'text-green-500'; // 36 - 70 is yellow ring
  else if (percentage >= 35) color = 'text-yellow-500'; //0-35 is red ring

  return (
    <div className="relative flex flex-col items-center justify-center">
      <svg width={size} height={size} viewBox="0 0 160 160" className="-rotate-90">
        <circle cx="80" cy="80" r={radius} fill="none" className="stroke-slate-100" strokeWidth="12" />
        <circle cx="80" cy="80" r={radius} fill="none"
          className={`transition-all duration-1000 ease-out ${color} stroke-current`}
          strokeWidth="12"
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center">
        <p className={`text-5xl font-extrabold ${color}`}>{percentage}%</p>
        <p className="text-sm font-semibold mt-1 text-text-muted">Health Score</p>
      </div>
    </div>
  );
};

const BMIGauge = ({ bmi, theme, colorBlindMode }) => {
  const isLight = theme === 'light';
  const isColorBlind = colorBlindMode && colorBlindMode !== 'none';

  // Palette changes for colour-blind modes
  const segments = isColorBlind
    ? [
      { label: "Underweight", range: [10, 18.5], color: "#6366F1" }, // indigo
      { label: "Normal", range: [18.5, 25], color: "#22C55E" }, // green
      { label: "Overweight", range: [25, 30], color: "#EC4899" }, // pink
      { label: "Obesity", range: [30, 40], color: "#F97316" }, // orange
    ]
    : [
      { label: "Underweight", range: [10, 18.5], color: isLight ? "#F97373" : "#FB7185" },
      { label: "Normal", range: [18.5, 25], color: "#22C55E" },
      { label: "Overweight", range: [25, 30], color: "#FBBF24" },
      { label: "Obesity", range: [30, 40], color: "#EF4444" },
    ];

  const minBMI = 10;
  const maxBMI = 40;

  const cx = 110;
  const cy = 110;
  const arcRadius = 80;
  const scaleRadius = 100;
  const pointerLength = 70;

  const scaleValues = [10, 15, 20, 25, 30, 35, 40];

  const angleForValue = (val) => {
    const ratio = (val - minBMI) / (maxBMI - minBMI);
    return ratio * Math.PI - Math.PI;
  };

  const numericBmi = bmi ? parseFloat(bmi) : minBMI;
  const clampedBmi = Math.min(maxBMI, Math.max(minBMI, numericBmi));
  const pointerAngle = angleForValue(clampedBmi);

  const pointerX = cx + pointerLength * Math.cos(pointerAngle);
  const pointerY = cy + pointerLength * Math.sin(pointerAngle);

  const pointerColor = isLight ? "#0F172A" : "#E5E7EB";
  const centerDotColor = isLight ? "#0F172A" : "#E5E7EB";

  return (
    <div className="flex flex-col items-center p-4">
      <svg width="220" height="140" viewBox="0 0 220 140">
        {/* COLOURED BMI SEGMENTS */}
        {segments.map((seg, i) => {
          const startAngle = angleForValue(seg.range[0]);
          const endAngle = angleForValue(seg.range[1]);

          const x1 = cx + arcRadius * Math.cos(startAngle);
          const y1 = cy + arcRadius * Math.sin(startAngle);
          const x2 = cx + arcRadius * Math.cos(endAngle);
          const y2 = cy + arcRadius * Math.sin(endAngle);

          const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

          return (
            <path
              key={i}
              d={`M${x1},${y1} A${arcRadius},${arcRadius} 0 ${largeArc} 1 ${x2},${y2}`}
              stroke={seg.color}
              strokeWidth="20"
              fill="none"
              strokeLinecap="round"
            />
          );
        })}

        {/* OUTER SCALE VALUES (10..40) */}
        {scaleValues.map((val) => {
          const a = angleForValue(val);
          const tx = cx + scaleRadius * Math.cos(a);
          const ty = cy + scaleRadius * Math.sin(a);

          return (
            <text
              key={val}
              x={tx}
              y={ty}
              fill={isLight ? "#4B5563" : "#E5E7EB"}
              fontSize="10"
              textAnchor="middle"
              alignmentBaseline="middle"
              style={{ pointerEvents: "none" }}
            >
              {val}
            </text>
          );
        })}

        {/* POINTER – needle + dots */}
        <line
          x1={cx}
          y1={cy}
          x2={pointerX}
          y2={pointerY}
          stroke={pointerColor}
          strokeWidth="4"
          strokeLinecap="round"
        />
        <circle cx={pointerX} cy={pointerY} r="5" fill={pointerColor} />
        <circle cx={cx} cy={cy} r="6" fill={centerDotColor} />
      </svg>

      <p className="mt-2 text-xl font-bold text-slate-900 dark:text-white">
        BMI = {bmi}
      </p>

      {/* LEGEND */}
      <div className="flex flex-wrap justify-center gap-3 mt-2 text-xs text-slate-700 dark:text-slate-300">
        <div className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm" style={{ background: segments[0].color }} />
          <span>{segments[0].label}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm" style={{ background: segments[1].color }} />
          <span>{segments[1].label}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm" style={{ background: segments[2].color }} />
          <span>{segments[2].label}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm" style={{ background: segments[3].color }} />
          <span>{segments[3].label}</span>
        </div>
      </div>
    </div>
  );
};



/** ---------------------------------------
 * Profile Section Component (UPDATED)
 * -------------------------------------- */
const calculateAge = (dob) => {
  if (!dob) return '';
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age.toString();
};

const ThinkingBubble = ({ stage = "analyzing" }) => {
  const messages = {
    analyzing: "VytalCare is analyzing medical sources",
    searching: "Searching MedlinePlus database",
    reasoning: "Synthesizing guidance"
  };

  return (
    <div className="flex justify-start animate-slide-up">
      <div className="flex max-w-[85%] flex-row">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-secondary/10 flex items-center justify-center mt-1 mr-3 text-secondary">
          <Heart size={16} className="animate-pulse" />
        </div>
        <div className="p-4 rounded-2xl rounded-tl-none bg-slate-800 text-slate-100 border border-slate-700 shadow-theme">
          <div className="flex items-center gap-2 text-sm">
            {messages[stage]}
            <span className="flex gap-1">
              <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
              <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
              <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

const ProfileSection = ({ db, userId, appId, theme, setTheme, colorBlindMode, setColorBlindMode, onCaregiverChange, onBmiChange }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [showColorBlindMenu, setShowColorBlindMenu] = useState(false);
  const [profile, setProfile] = useState({
    userName: '',
    userPhone: '',
    userEmail: '',
    userDob: '', // Date of Birth field for age calculation
    userSex: '',
    userAge: '',
    userHeight: '',
    userWeight: '',
    caregiverName: '',
    caregiverPhone: '',
    caregiverEmail: ''
  });
  const [loading, setLoading] = useState(true);
  // Easter egg: 5 taps on Profile icon -> open YouTube video
  const [profileIconClicks, setProfileIconClicks] = useState(0);
  const profileClickTimerRef = useRef(null);

  // CHANGED: Read directly from users/{userId}
  useEffect(() => {
    if (!db || !userId) return;
    // Old Path: .../users/${userId}/profile/data
    // New Path: .../users/${userId}
    const docRef = doc(db, `/artifacts/${appId}/users/${userId}`);

    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();

        // Auto-update age if DOB exists
        if (data.userDob) {
          const currentAge = calculateAge(data.userDob);
          if (currentAge !== data.userAge) {
            data.userAge = currentAge;
          }
        }

        // Update local profile state
        setProfile(prev => ({ ...prev, ...data }));

        // ✅ ALSO push caregiver info up to App on initial load
        if (onCaregiverChange) {
          onCaregiverChange(
            data.caregiverPhone || '',
            data.caregiverName || ''
          );
        }
        // ✅ Also compute BMI from loaded height/weight
        if (onBmiChange) {
          const heightStr = data.userHeight;
          const weightStr = data.userWeight;

          if (heightStr && weightStr) {
            const heightNum = parseFloat(String(heightStr).replace(/[^\d.]/g, ''));
            const weightNum = parseFloat(String(weightStr).replace(/[^\d.]/g, ''));

            if (heightNum && weightNum) {
              const heightMeters = heightNum > 3 ? heightNum / 100 : heightNum;
              if (heightMeters > 0) {
                const bmiValue = weightNum / (heightMeters * heightMeters);
                onBmiChange(bmiValue.toFixed(1));
              } else {
                onBmiChange(null);
              }
            } else {
              onBmiChange(null);
            }
          } else {
            onBmiChange(null);
          }
        }
      } else {
        // No profile → clear caregiver + BMI in App
        if (onCaregiverChange) onCaregiverChange('', '');
        if (onBmiChange) onBmiChange(null);
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, [db, userId, appId, onCaregiverChange, onBmiChange]);

  // CHANGED: Write directly to users/{userId}
  const handleSave = async () => {
    if (!db || !userId) return;
    try {
      // Old Path: .../users/${userId}/profile/data
      // New Path: .../users/${userId}
      const docRef = doc(db, `/artifacts/${appId}/users/${userId}`);

      // We also save the 'id' field explicitly, just in case n8n needs it in the body
      await setDoc(docRef, { ...profile, id: userId }, { merge: true });

      setIsEditing(false);
    } catch (e) {
      console.error("Error saving profile:", e);
      alert("Failed to save profile.");
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setProfile(prev => {
      const updated = { ...prev, [name]: value };

      // Auto-calculate age if DOB changes
      if (name === 'userDob') {
        updated.userAge = calculateAge(value);
      }

      // ✅ Whenever caregiver phone or name changes, inform parent (App)
      if (onCaregiverChange && (name === 'caregiverPhone' || name === 'caregiverName')) {
        const phone = name === 'caregiverPhone' ? value : updated.caregiverPhone;
        const careName = name === 'caregiverName' ? value : updated.caregiverName;
        onCaregiverChange(phone || '', careName || '');
      }

      return updated;
    });
  };

  const handleProfileIconClick = () => {
    // reset timer each tap
    if (profileClickTimerRef.current) {
      clearTimeout(profileClickTimerRef.current);
    }

    setProfileIconClicks((prev) => {
      const next = prev + 1;

      // 5 quick taps = trigger easter egg
      if (next >= 5) {
        window.open(
          "https://www.youtube.com/watch?v=dQw4w9WgXcQ", // your secret video
          "_blank",
          "noopener,noreferrer"
        );
        return 0; // reset count
      }

      return next;
    });

    // if user pauses >1.5s, reset counter
    profileClickTimerRef.current = setTimeout(() => {
      setProfileIconClicks(0);
      profileClickTimerRef.current = null;
    }, 1500);
  };

  useEffect(() => {
    return () => {
      if (profileClickTimerRef.current) {
        clearTimeout(profileClickTimerRef.current);
      }
    };
  }, []);


  if (loading) return <div className="p-4"><LoadingSpinner /></div>;

  return (
    <div className="space-y-4">
      {/* CARD 1: Profile + Caregiver */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden flex flex-col">
        <div className="p-6 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
          <h2 className="text-lg font-bold text-text-main dark:text-white flex items-center">
            <button
              type="button"
              onClick={handleProfileIconClick}
              className="mr-2 -ml-1 rounded-full p-1 text-primary hover:bg-primary/10 active:scale-95 transition"
              title="Profile"
            >
              <User size={20} />
            </button>
            Profile
          </h2>

          <button
            onClick={isEditing ? handleSave : () => setIsEditing(true)}
            className={`p-2 rounded-xl transition-all duration-200 ${isEditing
              ? 'bg-green-500 text-white shadow-md shadow-green-200 hover:bg-green-600'
              : 'bg-white text-slate-400 hover:text-primary hover:bg-primary/5 border border-slate-200 dark:bg-slate-700 dark:border-slate-600'
              }`}
            title={isEditing ? 'Save Profile' : 'Edit Profile'}
          >
            {isEditing ? <Save size={18} /> : <Edit2 size={18} />}
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-grow scrollbar-thin scrollbar-thumb-slate-200">
          {/* User Details */}
          <div className="mb-8">
            <h3 className="text-sm font-bold text-primary dark:text-slate-300 mb-4 flex items-center bg-slate-100 dark:bg-slate-800 p-2 rounded-lg dark:border dark:border-slate-700">
              User Details
            </h3>
            <InputField label="Name" name="userName" placeholder="John Doe" isEditing={isEditing} profile={profile} handleChange={handleChange} />
            <InputField label="Phone No" name="userPhone" type="tel" placeholder="+1 234 567 890" isEditing={isEditing} profile={profile} handleChange={handleChange} />
            <InputField label="Email ID" name="userEmail" type="email" placeholder="john@example.com" isEditing={isEditing} profile={profile} handleChange={handleChange} />
            <div className="grid grid-cols-2 gap-4">
              <InputField label="Date of Birth" name="userDob" type="date" placeholder="YYYY-MM-DD" isEditing={isEditing} profile={profile} handleChange={handleChange} />
              <InputField label="Age" name="userAge" type="number" placeholder="30" isEditing={isEditing} profile={profile} handleChange={handleChange} />
              <InputField label="Sex" name="userSex" placeholder="M/F" isEditing={isEditing} profile={profile} handleChange={handleChange} />
              <InputField label="Height" name="userHeight" placeholder="175 cm" isEditing={isEditing} profile={profile} handleChange={handleChange} />
              <InputField label="Weight" name="userWeight" placeholder="70 kg" isEditing={isEditing} profile={profile} handleChange={handleChange} />
            </div>
          </div>

          {/* Caregiver Details */}
          <div>
            <h3 className="text-sm font-bold text-secondary dark:text-slate-300 mb-4 flex items-center bg-slate-100 dark:bg-slate-800 p-2 rounded-lg dark:border dark:border-slate-700">
              Caregiver Details
            </h3>
            <InputField label="Name" name="caregiverName" placeholder="Jane Doe" isEditing={isEditing} profile={profile} handleChange={handleChange} />
            <InputField label="Phone No" name="caregiverPhone" type="tel" placeholder="+1 987 654 321" isEditing={isEditing} profile={profile} handleChange={handleChange} />
            <InputField label="Email" name="caregiverEmail" type="email" placeholder="jane@example.com" isEditing={isEditing} profile={profile} handleChange={handleChange} />
          </div>
        </div>
      </div>

      {/* CARD 2: Google Calendar (separate container) */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden flex flex-col">
        <div className="p-6 border-b border-slate-100 dark:border-slate-700 flex items-center bg-slate-50/50 dark:bg-slate-900/50">
          <h2 className="text-lg font-bold text-text-main dark:text-white flex items-center">
            <Calendar size={20} className="mr-2 text-primary" />
            Google Calendar
          </h2>
        </div>

        <div className="p-6 overflow-y-auto flex-grow scrollbar-thin scrollbar-thumb-slate-200">
          <a
            href="https://calendar.google.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-4 bg-white dark:bg-slate-700 rounded-xl border border-slate-200 dark:border-slate-600 hover:border-primary/50 hover:shadow-md transition-all group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
                <Calendar size={20} className="text-primary" />
              </div>
              <div>
                <p className="font-semibold text-text-main dark:text-white">
                  Open Google Calendar
                </p>
                <p className="text-xs text-text-muted dark:text-slate-400">
                  View your medication reminders
                </p>
              </div>
            </div>
            <ExternalLink
              size={18}
              className="text-slate-400 group-hover:text-primary transition-colors"
            />
          </a>
        </div>
      </div>

      {/* CARD 3: Accessibility (separate container) */}
      <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 flex flex-col">
        <div className="p-6 border-b border-slate-100 dark:border-slate-700 flex items-center bg-slate-50/50 dark:bg-slate-900/50">
          <h2 className="text-lg font-bold text-text-main dark:text-white flex items-center">
            <Eye size={20} className="mr-2 text-primary" />
            Accessibility
          </h2>
        </div>

        {/* NOTE: no overflow-y-auto / flex-grow here so the card can expand */}
        <div className={`p-6 ${showColorBlindMenu ? 'pb-8' : ''}`}>
          <div className="flex gap-2 mb-4">
            {/* Light theme */}
            <button
              onClick={() => {
                setTheme('light');
                setColorBlindMode('none');
                setShowColorBlindMenu(false);
              }}
              className={`flex-1 p-3 rounded-xl border flex flex-col items-center justify-center gap-2 transition-all ${theme === 'light' && colorBlindMode === 'none'
                ? 'bg-primary text-white border-primary shadow-lg shadow-primary/20'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 dark:bg-slate-700 dark:text-slate-300'
                }`}
              aria-pressed={theme === 'light' && colorBlindMode === 'none'}
            >
              <Sun size={20} />
              <span className="text-xs font-semibold">Light</span>
            </button>

            {/* Dark theme */}
            <button
              onClick={() => {
                setTheme('dark');
                setColorBlindMode('none');
                setShowColorBlindMenu(false);
              }}
              className={`flex-1 p-3 rounded-xl border flex flex-col items-center justify-center gap-2 transition-all ${theme === 'dark' && colorBlindMode === 'none'
                ? 'bg-slate-900 text-white border-slate-600 shadow-lg shadow-slate-900/40'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 dark:bg-slate-700 dark:text-slate-300'
                }`}
              aria-pressed={theme === 'dark' && colorBlindMode === 'none'}
            >
              <Moon size={20} />
              <span className="text-xs font-semibold">Dark</span>
            </button>

            {/* Color blind menu toggle */}
            <button
              onClick={() => setShowColorBlindMenu(v => !v)}
              className={`flex-1 p-3 rounded-xl border flex flex-col items-center justify-center gap-2 transition-all ${colorBlindMode !== 'none'
                ? 'bg-emerald-600 text-white border-emerald-500 shadow-lg shadow-emerald-500/30'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 dark:bg-slate-700 dark:text-slate-300'
                }`}
              aria-expanded={showColorBlindMenu}
            >
              <Eye size={20} />
              <span className="text-xs font-semibold">Color Blind</span>
            </button>
          </div>

          {showColorBlindMenu && (
            <div className="mt-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm">
              <p className="text-sm font-semibold text-text-main dark:text-slate-100 mb-3">
                Color Blind-Friendly Themes:
              </p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'protanopia', label: 'Protanopia' },
                  { id: 'deuteranopia', label: 'Deuteranopia' },
                  { id: 'tritanopia', label: 'Tritanopia' },
                  { id: 'achromatopsia', label: 'Achromatopsia' }
                ].map(mode => (
                  <button
                    key={mode.id}
                    onClick={() => {
                      setColorBlindMode(mode.id);
                      if (theme !== 'dark') setTheme('dark');
                    }}
                    className={`px-3 py-2 rounded-xl border text-xs font-medium text-left transition-all ${colorBlindMode === mode.id
                      ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm shadow-emerald-500/40'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600'
                      }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setColorBlindMode('none')}
                className="mt-3 text-xs text-slate-500 dark:text-slate-400 underline hover:text-primary"
              >
                Reset color blind mode
              </button>
            </div>
          )}
        </div>
      </div>


      {/* CARD 4: Sign Out – only button, no header */}
      {/* SIGN OUT BUTTON — NO CONTAINER */}
      <button
        onClick={() => {
          localStorage.clear();
          window.location.reload();
        }}
        className="w-full flex items-center justify-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 
             text-red-600 dark:text-red-400 rounded-xl border border-red-200 dark:border-red-800 
             hover:bg-red-100 dark:hover:bg-red-900/40 transition-all text-sm font-medium"
      >
        Sign Out of VytalCare
      </button>

    </div>
  );
};

const InputField = ({ label, name, type = "text", placeholder, isEditing, profile, handleChange }) => (
  <div className="mb-3">
    <label className="block text-xs font-semibold text-text-muted dark:text-slate-400 mb-1 uppercase tracking-wider">{label}</label>
    {isEditing ? (
      <input
        type={type}
        name={name}
        value={profile[name]}
        onChange={handleChange}
        placeholder={placeholder}
        className="w-full p-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-slate-50 dark:bg-slate-900 dark:text-white"
      />
    ) : (
      <p className="text-sm font-medium text-text-main dark:text-white break-words">{profile[name] || <span className="text-slate-300 italic">Not set</span>}</p>
    )}
  </div>
);

/** ---------------------------------------
 * Auth Login Card (unchanged)
 * -------------------------------------- */
const LoginPage = ({ handleLogin, error }) => {
  const [showAbout, setShowAbout] = useState(false);

  return (
  <div className="min-h-screen bg-background dark:bg-slate-950">
    <div className="flex justify-center pt-20 pb-12 px-6">
    <div className="max-w-md w-full p-8 rounded-3xl shadow-xl bg-surface dark:bg-slate-900 text-center border border-slate-100 dark:border-slate-800 animate-fade-in">
      <div className="w-20 h-20 bg-white dark:bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-slate-200/50 dark:shadow-none border border-slate-100 dark:border-slate-700">
        <img
          src={appIcon}
          alt="VytalCare Logo"
          className="w-full h-full object-contain"
        />
      </div>
      <h1 className="text-4xl font-bold mb-3 text-text-main dark:text-white tracking-tight">VytalCare</h1>
      <p className="text-lg mb-8 text-text-muted dark:text-slate-400">
        Your personal AI health companion. Sign in to manage medications and track your vitals.
      </p>

      {error && !error.type && (
        <div className="p-4 rounded-xl mb-6 bg-red-50 text-red-600 border border-red-100 text-sm font-medium">
          {typeof error === 'string' ? error : JSON.stringify(error)}
        </div>
      )}

      <button
        onClick={handleLogin}
        className="w-full py-4 text-white text-lg font-bold rounded-xl transition-all duration-200 shadow-lg shadow-primary/20 hover:shadow-primary/40 hover:-translate-y-0.5 bg-primary flex items-center justify-center group"
      >
        <img
          src="https://www.gstatic.com/images/icons/material/system/2x/google_white_24dp.png"
          alt="Google icon"
          className="w-5 h-5 mr-3 group-hover:scale-110 transition-transform"
        />
        Sign In with Google
      </button>
      
         <div className="mt-6 flex flex-col items-center gap-4">
      </div>
        </div>

    <div className="flex justify-center py-10">
      <div className="w-24 h-1 rounded-full bg-primary/40"></div>
    </div>

    <div className="max-w-3xl mx-auto px-6 pb-20">

  <div className="bg-surface dark:bg-slate-900 rounded-3xl shadow-xl border border-slate-100 dark:border-slate-800 p-8">

    <h2 className="text-3xl font-bold text-center text-text-main dark:text-white mb-6">
      About VytalCare
    </h2>

    <p className="text-text-muted dark:text-slate-300 leading-8 text-justify">
  <strong>VytalCare</strong> is an AI-powered personal healthcare companion
  designed to help users manage their daily wellness through intelligent
  health monitoring, medication management, and personalized health insights.
  The application combines artificial intelligence with health data
  integration to provide a proactive, secure, and user-friendly healthcare
  experience.
</p>

<p className="mt-6 text-text-muted dark:text-slate-300 leading-8 text-justify">
  Users can securely sign in with their Google account to access features
  including medication reminders, prescription scanning, health metric
  tracking, emergency contact management, and an AI health assistant.
  VytalCare integrates with Google Fit to retrieve fitness and wellness
  information such as step count, sleep duration, heart rate, calories
  burned, and distance travelled, allowing users to view their health
  information in one unified dashboard.
</p>

<p className="mt-6 text-text-muted dark:text-slate-300 leading-8 text-justify">
  The application requests access only to the Google user data necessary for
  its core functionality. Google account information is used solely for secure
  authentication and user identification. Google Fit data is used to display
  health metrics, calculate wellness scores, generate personalized insights,
  and help users monitor their overall health. Google Calendar integration is
  used to automatically create and synchronize medication reminders, ensuring
  users receive timely notifications. VytalCare does not sell or share user
  data with third parties for advertising purposes and only uses the requested
  information to provide its healthcare services.
</p>

<p className="mt-6 text-text-muted dark:text-slate-300 leading-8 text-justify">
  Developed by <strong>Team Stranger Strings</strong>, VytalCare aims to make
  preventive healthcare more accessible by combining intelligent automation,
  AI-powered assistance, and secure cloud technologies into a single,
  user-centric platform.
</p>

<div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-10">

  <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
    <h4 className="text-lg font-semibold text-primary mb-2">
      💊 Smart Medication Management
    </h4>
    <p className="text-sm text-text-muted dark:text-slate-300 leading-7">
      Create medication reminders manually or automatically from prescription
      images. Sync reminders directly with Google Calendar so you never miss a dose.
    </p>
  </div>

  <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
    <h4 className="text-lg font-semibold text-primary mb-2">
      📊 Health Monitoring
    </h4>
    <p className="text-sm text-text-muted dark:text-slate-300 leading-7">
      Track steps, sleep, calories, heart rate, hydration, BMI, and distance
      using Google Fit integration and interactive visualizations.
    </p>
  </div>

  <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
    <h4 className="text-lg font-semibold text-primary mb-2">
      🤖 AI Health Assistant
    </h4>
    <p className="text-sm text-text-muted dark:text-slate-300 leading-7">
      Ask health-related questions through an AI assistant powered by trusted
      medical sources to receive reliable educational information.
    </p>
  </div>

  <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-5">
    <h4 className="text-lg font-semibold text-primary mb-2">
      🚑 Emergency Support
    </h4>
    <p className="text-sm text-text-muted dark:text-slate-300 leading-7">
      Store caregiver and emergency contact information for quick access during
      urgent situations.
    </p>
  </div>

</div>

    <div className="mt-8 text-center">

      <p className="mt-3 text-text-muted dark:text-slate-300 leading-8">
        From: <br />
        Swaraag Hebbar N<br />
        Shashank Ravindra br
        Ananya Raghuveer<br />
  
      </p>
    </div>
<div className="mt-12 pt-8 border-t border-slate-200 dark:border-slate-700">

  <div className="text-center text-sm text-text-muted dark:text-slate-400">
    © 2026 VytalCare • Built by <strong>Team Stranger Strings</strong>
  </div>

  <div className="flex justify-center items-center gap-6 mt-4 text-sm">

    <a
      href="/privacy.html"
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:underline"
    >
      Privacy Policy
    </a>

    <a
      href="/terms.html"
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:underline"
    >
      Terms of Service
    </a>

  </div>

</div>
    </div>

  </div>

</div>
    </div>
  );
};

/** ---------------------------------------
 * Networking helper (unchanged)
 * -------------------------------------- */
const exponentialBackoffFetch = async (url, options, maxRetries = 3, timeout = 15000) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);

      if (!response.ok) {
        if (response.status === 429 && i < maxRetries - 1) {
          const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response;
    } catch (error) {
      if (i === maxRetries - 1) throw error;
    }
  }
  throw new Error("Failed to fetch after multiple retries.");
};

/** ---------------------------------------
 * Main App
 * -------------------------------------- */
const INITIAL_CHAT_WELCOME = { role: 'assistant', text: 'Hi there ! I’m your VytalCare Chatbot. I use a RAG system powered by trusted MedlinePlus data to give you reliable, accurate, and up-to-date health information on conditions, medications, tests, and more. I can guide you with clarity—but always consult a healthcare professional for medical advice.', sources: [], createdAt: Date.now() };

const getTodayDateKey = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getWeekNumber = (d) => {
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return weekNo;
};

const METRIC_INFO = {
  steps: {
    title: "Daily Steps",
    desc: "Walking is a low-impact exercise that boosts cardiovascular health. The 10,000 steps goal is a common standard for maintaining an active lifestyle, helping to reduce the risk of chronic diseases."
  },
  sleep: {
    title: "Sleep Duration",
    desc: "Quality sleep is essential for physical recovery and mental clarity. Most adults need between 7 and 9 hours. Consistent sleep patterns help regulate mood, improve memory, and strengthen the immune system."
  },
  calories: {
    title: "Calories Burned",
    desc: "This metric estimates the total energy your body has used today, including your resting metabolism (BMR) and active movement. Monitoring this helps in managing weight and energy levels."
  },
  hydration: {
    title: "Hydration",
    desc: "Water is vital for every cell in your body. It regulates temperature, lubricates joints, and aids digestion. A general goal is about 2-3 liters per day, depending on your activity level and climate."
  },
  distance: {
    title: "Distance Covered",
    desc: "This tracks the total kilometers you have walked or run today. Tracking distance is a great way to measure endurance and progress towards fitness goals."
  },
  heartRate: {
    title: "Heart Rate",
    desc: "Measured in Beats Per Minute (BPM). A lower resting heart rate (typically 60-100 BPM) generally indicates better cardiovascular fitness and efficient heart function."
  },
about: {
  title: "About VytalCare",
  desc: (
    <>
      <p>
        VytalCare is your Agentic, AI-powered health companion designed to move
        beyond simple tracking. Functioning as an intelligent agent, it
        proactively manages your wellness by autonomously syncing smart
        medication reminders to your calendar, triggering automated health
        workflows, and converting prescription images into actionable schedules.
      </p>

      <br />

      <p>
        VytalCare was developed with passion and precision.
      </p>

      <br />

      <p style={{ textAlign: "center", fontWeight: "600" }}>
        From: 
        <br />
        Swaraag Hebbar N
        <br />
        Shashank Ravindra
        <br />
        Ananya Raghuveer
      </p>
    </>
  )
}
};

const parseAssistantResponse = (text = "") => {
  // Remove "SOURCES: ..." or "Sources:" and everything after it to prevent double rendering
  // The sources are already passed separately in msg.sources by the backend
  const cleanText = text.replace(/SOURCES?:[\s\S]*/gi, "").trim();
  
  const sections = {};
  const regex = /(ANSWER|WHAT YOU CAN DO|WHEN TO SEE A DOCTOR|DISCLAIMER):([\s\S]*?)(?=\n[A-Z ]+:\n|$)/g;
  let match;
  while ((match = regex.exec(cleanText)) !== null) {
    sections[match[1]] = match[2].trim();
  }
  return sections;
};

// ... const App = () => {

const App = () => {
  // Firebase & core state
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [medications, setMedications] = useState([]);
  const [newMedication, setNewMedication] = useState({ name: '', dose: '', times: ['08:00'], days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] });
  const [isAdding, setIsAdding] = useState(false);
  const [editingMedId, setEditingMedId] = useState(null);

  const [thinkingStage, setThinkingStage] = useState("analyzing");

  // Caregiver contact (used in Emergency tab)
  const [caregiverContact, setCaregiverContact] = useState({
    phone: '',
    name: ''
  });

  const handleCaregiverChange = useCallback((phone, name) => {
    setCaregiverContact({ phone, name });
  }, []);

  // Extra emergency contacts (user-added in Emergency tab)
  const [emergencyContacts, setEmergencyContacts] = useState([]);
  const [isEditingEmergency, setIsEditingEmergency] = useState(false);
  const [newEmergencyContact, setNewEmergencyContact] = useState({
    name: '',
    number: ''
  });

  // BMI state
  const [bmi, setBmi] = useState(null);

  // Prescription → auto-fill meds
  const [isPrescriptionScanning, setIsPrescriptionScanning] = useState(false);
  const [prescriptionImage, setPrescriptionImage] = useState(null);
  const prescriptionFileInputRef = useRef(null);
  // Small dropdown for "Upload / Take photo" in meds form
  const [showPrescriptionAttachMenu, setShowPrescriptionAttachMenu] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('reminders');
  //For Metric Description
  const [activeInfoMetric, setActiveInfoMetric] = useState(null);

  // >> NEW: State for "Taken" Tracking and Time <<
  const [takenMedications, setTakenMedications] = useState(new Set());
  const [now, setNow] = useState(new Date());

  // Timer to update 'now' every minute (and check date change)
  useEffect(() => {
    const timer = setInterval(() => {
      const d = new Date();
      setNow(d);
      // Ensure dateKey is current (using existing helper)
      const key = getTodayDateKey();
      setCurrentDateKey(prev => (prev !== key ? key : prev));
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  // Accessibility State
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) return saved;
    // Default to OS preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  });
  const [colorBlindMode, setColorBlindMode] = useState(() => localStorage.getItem('colorBlindMode') || 'none');

  // Apply Theme
  useEffect(() => {
    // Enable smooth transitions
    document.documentElement.classList.add('transitioning');

    // Set data-theme attribute
    document.documentElement.setAttribute('data-theme', theme);

    // Toggle dark class for Tailwind
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    // Save to localStorage
    localStorage.setItem('theme', theme);

    // Update theme-color meta tag for mobile
    const themeColor = theme === 'dark' ? '#071027' : '#f7fafc';
    let metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (!metaThemeColor) {
      metaThemeColor = document.createElement('meta');
      metaThemeColor.name = 'theme-color';
      document.head.appendChild(metaThemeColor);
    }
    metaThemeColor.setAttribute('content', themeColor);

    // Remove transitioning class after animation
    const timeout = setTimeout(() => {
      document.documentElement.classList.remove('transitioning');
    }, 300);

    return () => clearTimeout(timeout);
  }, [theme]);

  // Apply Color Blind Mode
  useEffect(() => {
    if (colorBlindMode && colorBlindMode !== 'none') {
      document.documentElement.style.filter = `url(#${colorBlindMode})`;
    } else {
      document.documentElement.style.filter = 'none';
    }
    localStorage.setItem('colorBlindMode', colorBlindMode);
  }, [colorBlindMode]);

  // Chatbot
  // >> INITIAL CHAT HISTORY IS NOW A WELCOME MESSAGE ONLY <<
  const [chatHistory, setChatHistory] = useState([INITIAL_CHAT_WELCOME]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [attachedImage, setAttachedImage] = useState(null); // NEW: image attached to next message
  const [streamingMessage, setStreamingMessage] = useState(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false); // NEW: show upload / camera choice

  // Google Fit auth token (unchanged)
  const [googleAccessToken, setGoogleAccessToken] = useState(null);

  // Health metrics (unchanged)
  const [stepCount, setStepCount] = useState(null);
  const [sleepHours, setSleepHours] = useState(null);
  const [calories, setCalories] = useState(null);
  const [distance, setDistance] = useState(null); // km
  const [heartRate, setHeartRate] = useState(null); // FIX 1 & 2: Complete heartRate state declaration
  const [heartRateTrend, setHeartRateTrend] = useState([]);
  const [stepsTrend, setStepsTrend] = useState([]);
  const [distanceTrend, setDistanceTrend] = useState([]);
  const [sleepTrend, setSleepTrend] = useState([]);

  // Hydration state
  const [currentDateKey, setCurrentDateKey] = useState(getTodayDateKey());
  const [hydration, setHydration] = useState(0);
  const [hydrationGoal, setHydrationGoal] = useState(2000); // Default goal 2000ml
  const [waterIconClicks, setWaterIconClicks] = useState(0);
  const [healthScore, setHealthScore] = useState(null);

  // Health score explanation + suggestions
  const [healthScoreExplanation, setHealthScoreExplanation] = useState([]);
  const [healthScoreSuggestions, setHealthScoreSuggestions] = useState([]);
  const [stepsIconClicks, setStepsIconClicks] = useState(0);
  // Graph updation 
  const [steps3hTrend, setSteps3hTrend] = useState([]);
  const [distance3hTrend, setDistance3hTrend] = useState([]);
  const [weeklyDistance, setWeeklyDistance] = useState([]);

  // Health Plan Tab State
  const [weeklyBP, setWeeklyBP] = useState({ systolic: '', diastolic: '' });
  const [weeklySugar, setWeeklySugar] = useState('');
  const [weeklySpo2, setWeeklySpo2] = useState('');
  const [isSavingHealthData, setIsSavingHealthData] = useState(false);

  // Calendar State
  // 💊 medication reminder days
  const [calendarMedDays, setCalendarMedDays] = useState(new Set());
  // other engagements (meetings, personal events, etc.)
  const [calendarEngagementDays, setCalendarEngagementDays] = useState(new Set());
  // doctor appointments booked via this app (Quarterly / Yearly)
  const [calendarAppointmentDays, setCalendarAppointmentDays] = useState(new Set());

  const [currentCalendarMonth, setCurrentCalendarMonth] = useState(new Date());
  const [selectedQuarterlyDate, setSelectedQuarterlyDate] = useState(null);
  const [selectedYearlyDate, setSelectedYearlyDate] = useState(null);

  // Auto-scroll & Glow refs
  const [highlightedGraph, setHighlightedGraph] = useState(null);
  const stepsRef = useRef(null);
  const sleepRef = useRef(null);
  const distanceRef = useRef(null);
  const heartRateRef = useRef(null);

  const scrollToGraph = (metric) => {
    let ref = null;
    if (metric === 'steps') ref = stepsRef;
    else if (metric === 'sleep') ref = sleepRef;
    else if (metric === 'distance') ref = distanceRef;
    else if (metric === 'heartRate') ref = heartRateRef;

    if (ref && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedGraph(metric);
      setTimeout(() => setHighlightedGraph(null), 1500);
    }
  };

  // Loading flags (unchanged)
  const [isStepsLoading, setIsStepsLoading] = useState(false);
  const [isSleepLoading, setIsSleepLoading] = useState(false);
  const [isCaloriesLoading, setIsCaloriesLoading] = useState(false);
  const [isDistanceLoading, setIsDistanceLoading] = useState(false);
  const [isHeartRateLoading, setIsHeartRateLoading] = useState(false);
  const [isSyncingAll, setIsSyncingAll] = useState(false);
  const [isAutoSyncActive, setIsAutoSyncActive] = useState(false);

  // Assessment (unchanged)
  const [assessmentResult, setAssessmentResult] = useState(null);
  const [isAssessmentLoading, setIsAssessmentLoading] = useState(false);

  /** ----------------------------
   * Firebase init & auth (unchanged)
   * --------------------------- */
  useEffect(() => {
    // ... (Firebase init logic) ...
    try {
      const isConfigMissing = !firebaseConfig.apiKey;
      if (isConfigMissing) {
        if (isLocalRun) {
          setError("DATABASE/AUTH ERROR: Please update FIREBASE_LOCAL_CONFIG in App.jsx for local persistence.");
        } else {
          setError("Failed to initialize the app due to missing config.");
        }
        setDb(null);
        setAuth(null);
        setUserId(crypto.randomUUID());
        setIsLoading(false);
        return;
      }

      const app = initializeApp(firebaseConfig);
      const firestore = getFirestore(app);
      const authentication = getAuth(app);

      setDb(firestore);
      setAuth(authentication);

      const unsubscribeAuth = onAuthStateChanged(authentication, async (user) => {
        if (user) {
          setUserId(user.uid);
          setIsLoading(false);
        } else {
          if (initialAuthToken) {
            await signInWithCustomToken(authentication, initialAuthToken);
          } else {
            const anonUser = await signInAnonymously(authentication);
            setUserId(anonUser.user.uid);
          }
          setIsLoading(false);
        }
      });

      return () => unsubscribeAuth();
    } catch (e) {
      console.error("Firebase Initialization Error:", e);
      setError("Failed to initialize the app. Check console for details.");
      setIsLoading(false);
    }
  }, [isLocalRun]);

  // Fetch weekly health data
  useEffect(() => {
    if (!db || !userId) return;
    const currentWeek = getWeekNumber(new Date());
    const weekDocRef = doc(db, `/artifacts/${appId}/users/${userId}/health_plan/week_${currentWeek}`);

    const unsubscribe = onSnapshot(weekDocRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        if (data.bp) setWeeklyBP(data.bp);
        if (data.sugar) setWeeklySugar(data.sugar);
      }
    });
    return () => unsubscribe();
  }, [db, userId]);

  /** ----------------------------
   * Firestore Listeners
   * --------------------------- */

  // 1. Medication Listener
  useEffect(() => {
    if (!db || !userId) return;
    const q = query(collection(db, `/artifacts/${appId}/users/${userId}/medications`));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const meds = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setMedications(meds);
    }, (error) => {
      console.error("Error fetching medications:", error);
      if (auth?.currentUser) { /* setError("Failed to fetch medications."); */ }
    });
    return () => unsubscribe();
  }, [db, userId, auth]);

  // 1a. Sync calendar deletions - check if calendar events were deleted and remove medications
  useEffect(() => {
    if (!db || !userId || !googleAccessToken) return;

    const syncCalendarDeletions = async () => {
      try {
        // Get all medications with calendar event IDs
        const medCollectionRef = collection(db, `/artifacts/${appId}/users/${userId}/medications`);
        const snapshot = await getDocs(medCollectionRef);
        const meds = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        for (const med of meds) {
          if (med.calendarEventIds && Array.isArray(med.calendarEventIds) && med.calendarEventIds.length > 0) {
            // Check if any of the calendar events still exist
            let allEventsDeleted = true;
            for (const eventId of med.calendarEventIds) {
              try {
                const eventResponse = await fetch(
                  `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
                  {
                    headers: {
                      'Authorization': `Bearer ${googleAccessToken}`
                    }
                  }
                );
                if (eventResponse.ok) {
                  allEventsDeleted = false;
                  break; // At least one event exists
                }
              } catch (e) {
                // Event might be deleted, continue checking
              }
            }

            // If all events are deleted, delete the medication from database
            if (allEventsDeleted) {
              const medDocRef = doc(db, `/artifacts/${appId}/users/${userId}/medications`, med.id);
              await deleteDoc(medDocRef);
              console.log(`Medication ${med.name} deleted from app because calendar events were deleted`);
            }
          }
        }
      } catch (error) {
        console.error('Error syncing calendar deletions:', error);
      }
    };

    // Run sync immediately and then every 5 minutes
    syncCalendarDeletions();
    const intervalId = setInterval(syncCalendarDeletions, 5 * 60 * 1000);

    return () => clearInterval(intervalId);
  }, [db, userId, googleAccessToken]);

  // 1b. Medication Logs Listener (Live Sync for "Taken" status)
  useEffect(() => {
    if (!db || !userId) return;
    const q = query(
      collection(db, `/artifacts/${appId}/users/${userId}/medication_logs`),
      where('dateKey', '==', currentDateKey)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const takenSet = new Set();
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        if (data.medicationId && data.scheduledTime && data.status === 'taken') {
          takenSet.add(`${data.medicationId}_${data.scheduledTime}`);
        }
      });
      setTakenMedications(takenSet);
    }, (e) => console.error("Error fetching logs:", e));
    return () => unsubscribe();
  }, [db, userId, currentDateKey]);

  // 2. Chat History Listener
  useEffect(() => {
    if (!db || !userId) return;

    const chatCollectionRef = collection(
      db,
      `/artifacts/${appId}/users/${userId}/chats`
    );

    const qChat = query(
      chatCollectionRef,
      orderBy('createdAt', 'asc'),
      limit(100)
    );

    const unsubscribe = onSnapshot(
      qChat,
      (snapshot) => {
        const chatMessages = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));

        if (chatMessages.length > 0) {
          setChatHistory(chatMessages);
        } else {
          setChatHistory([INITIAL_CHAT_WELCOME]);
        }
      },
      (error) => {
        console.error('Failed to fetch chat history:', error);
        if (auth?.currentUser) {
          // optional: setError("Failed to fetch chat history.");
        }
      }
    );

    return () => unsubscribe();
  }, [db, userId, auth]);

  // 3. Emergency Contacts Listener
  useEffect(() => {
    if (!db || !userId) return;

    const contactsRef = collection(
      db,
      `/artifacts/${appId}/users/${userId}/emergency_contacts`
    );

    const unsubscribe = onSnapshot(
      contactsRef,
      (snapshot) => {
        const loaded = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() || {};
          return {
            id: docSnap.id,
            name: data.name || '',
            number: data.number || '',
          };
        });
        setEmergencyContacts(loaded);
      },
      (error) => {
        console.error('Error fetching emergency contacts:', error);
      }
    );

    return () => unsubscribe();
  }, [db, userId]);


  // >> VOICE FEATURES <<
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechEnabled, setSpeechEnabled] = useState(false);
  const [isVoiceMode, setIsVoiceMode] = useState(false); // New: Continuous Voice Mode
  const [selectedLanguage, setSelectedLanguage] = useState('en-US');
  const recognitionRef = useRef(null);

  // Supported Languages (Updated with Indian Languages)
  const LANGUAGES = [
    { code: 'en-US', name: 'English (US)', voice: 'Google US English' },
    { code: 'en-IN', name: 'English (India)', voice: 'Google UK English Female' }, // Fallback to UK if IN not found
    { code: 'hi-IN', name: 'Hindi', voice: 'Google हिन्दी' },
    { code: 'ta-IN', name: 'Tamil', voice: 'Google தமிழ்' },
    { code: 'kn-IN', name: 'Kannada', voice: 'Google ಕನ್ನಡ' },
    { code: 'te-IN', name: 'Telugu', voice: 'Google తెలుగు' },
  ];

  // Ref to access latest callChatbotAPI inside useEffect without dependencies
  const callChatbotApiRef = useRef(null);


  // Initialize Speech Recognition
  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;

      recognitionRef.current.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setChatInput(transcript);
        setIsListening(false);

        // If in Voice Mode, automatically send the message
        if (isVoiceMode) {
          // Use ref to avoid stale closure
          if (callChatbotApiRef.current) {
            callChatbotApiRef.current(transcript);
          }
          setChatInput(''); // Clear input after sending
        }
      };

      recognitionRef.current.onerror = (event) => {
        console.error("Speech recognition error", event.error);
        setIsListening(false);
        // In voice mode, if error is 'no-speech', maybe restart? 
        // For now, let's stop to avoid infinite error loops.
        if (isVoiceMode && event.error === 'no-speech') {
          // Optional: restart listening?
          // setIsListening(true); recognitionRef.current.start();
        }
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  }, [isVoiceMode]); // Re-bind if voice mode changes (though refs usually stable)

  // Update language for recognition
  useEffect(() => {
    if (recognitionRef.current) {
      recognitionRef.current.lang = selectedLanguage;
    }
  }, [selectedLanguage]);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      setIsVoiceMode(false); // Stop voice mode if manually stopped
    } else {
      recognitionRef.current?.start();
      setIsListening(true);
    }
  };

  const startVoiceMode = () => {
    setIsVoiceMode(true);
    setSpeechEnabled(true); // Force enable TTS for voice mode
    recognitionRef.current?.start();
    setIsListening(true);
  };

  const stopVoiceMode = () => {
    setIsVoiceMode(false);
    recognitionRef.current?.stop();
    window.speechSynthesis.cancel();
    setIsListening(false);
    setIsSpeaking(false);
  };

  const resetVoiceMode = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setIsChatLoading(false);
    recognitionRef.current?.stop();
    setTimeout(() => {
      try {
        recognitionRef.current?.start();
        setIsListening(true);
      } catch (e) {
        console.error("Reset failed:", e);
      }
    }, 300);
  };

  const speakText = (text) => {
    if ((!speechEnabled && !isVoiceMode) || !text) {
      // If voice mode is on but speech is disabled/empty, we must still loop back to listening!
      if (isVoiceMode) {
        setTimeout(() => {
          recognitionRef.current?.start();
          setIsListening(true);
        }, 500);
      }
      return;
    }

    // Cancel current speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = selectedLanguage;

    // Try to find a matching voice - Prioritize "Natural" or "Google"
    const voices = window.speechSynthesis.getVoices();
    const langConfig = LANGUAGES.find(l => l.code === selectedLanguage);

    let voice = null;
    if (langConfig) {
      // 1. Try specific voice name from config
      voice = voices.find(v => v.name.includes(langConfig.voice));
      // 2. Try any voice for the language
      if (!voice) voice = voices.find(v => v.lang === selectedLanguage);
    }
    if (voice) utterance.voice = voice;

    // Safety timeout: If speech doesn't start in 3s, assume it failed and go back to listening
    const safetyTimeout = setTimeout(() => {
      if (!window.speechSynthesis.speaking) {
        console.warn("Speech synthesis timed out or failed to start.");
        setIsSpeaking(false);
        if (isVoiceMode) {
          recognitionRef.current?.start();
          setIsListening(true);
        }
      }
    }, 3000);

    utterance.onstart = () => {
      clearTimeout(safetyTimeout);
      setIsSpeaking(true);
    };

    utterance.onend = () => {
      clearTimeout(safetyTimeout);
      setIsSpeaking(false);
      // Continuous Loop: If in Voice Mode, start listening again after speaking
      if (isVoiceMode) {
        setTimeout(() => {
          try {
            recognitionRef.current?.start();
            setIsListening(true);
          } catch (e) {
            console.error("Failed to restart listening:", e);
            setIsVoiceMode(false); // Exit voice mode on critical error
          }
        }, 500); // Small delay for natural pause
      }
    };

    utterance.onerror = (event) => {
      clearTimeout(safetyTimeout);
      console.error("Speech synthesis error", event);
      setIsSpeaking(false);
      // Even on error, try to continue the loop if in voice mode
      if (isVoiceMode) {
        setTimeout(() => {
          try {
            recognitionRef.current?.start();
            setIsListening(true);
          } catch (e) {
            setIsVoiceMode(false);
          }
        }, 1000);
      }
    };

    window.speechSynthesis.speak(utterance);
  };

  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  };

  // Stop speaking on unmount
  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  // Watchdog: If in voice mode but stuck in "Processing" (neither listening nor speaking) for > 8s, force restart listening
  useEffect(() => {
    let watchdogTimer;
    if (isVoiceMode && !isListening && !isSpeaking) {
      console.log("Voice Mode Watchdog: Monitoring for stuck state...");
      watchdogTimer = setTimeout(() => {
        console.warn("Voice Mode Watchdog: Stuck in processing for 8s. Forcing restart.");
        // Force restart
        window.speechSynthesis.cancel();
        setIsSpeaking(false);
        try {
          recognitionRef.current?.start();
          setIsListening(true);
        } catch (e) {
          console.error("Watchdog restart failed:", e);
          setIsVoiceMode(false);
        }
      }, 8000); // 8 seconds timeout
    }
    return () => clearTimeout(watchdogTimer);
  }, [isVoiceMode, isListening, isSpeaking]);


  // 3. Hydration Listener
  useEffect(() => {
    if (!db || !userId) return;
    const docRef = doc(db, `/artifacts/${appId}/users/${userId}/hydration/${currentDateKey}`);

    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setHydration(data.amount || 0);
        if (data.goal) setHydrationGoal(data.goal);
      } else {
        setHydration(0);
      }
    }, (error) => {
      console.error("Error fetching hydration:", error);
    });
    return () => unsubscribe();
  }, [db, userId, currentDateKey]);

  // Hydration Midnight Reset
  useEffect(() => {
    const checkMidnightReset = () => {
      const newKey = getTodayDateKey();
      if (newKey !== currentDateKey) {
        setCurrentDateKey(newKey);
      }
    };

    // Check immediately
    checkMidnightReset();

    // Check every minute
    const interval = setInterval(checkMidnightReset, 60000);

    return () => clearInterval(interval);
  }, [currentDateKey]);

  const updateHydration = async (amountToAdd) => {
    if (!db || !userId) return;
    const docRef = doc(db, `/artifacts/${appId}/users/${userId}/hydration/${currentDateKey}`);

    const newAmount = Math.max(0, hydration + amountToAdd);
    setHydration(newAmount); // Optimistic update

    try {
      await setDoc(docRef, {
        amount: newAmount,
        goal: hydrationGoal,
        updatedAt: Date.now()
      }, { merge: true });
    } catch (e) {
      console.error("Error updating hydration:", e);
      // setError("Failed to update hydration.");
      setHydration(hydration); // Revert on error
    }
  };

  // Browser Notification Permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission();
    }
  }, []);

  const handleWaterIconClick = () => {
    setWaterIconClicks(prev => {
      const newCount = prev + 1;

      if (newCount === 3) {
        window.open("https://www.youtube.com/shorts/-enuIBVmKy4", "_blank");
        return 0; // reset so it can trigger again
      }

      return newCount;
    });
  };






  // Check for reminders every minute
  useEffect(() => {
    const checkReminders = () => {
      if (Notification.permission !== 'granted') return;

      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();

      medications.forEach(med => {
        if (med.times && Array.isArray(med.times)) {
          med.times.forEach(time => {
            const [h, m] = time.split(':').map(Number);
            if (h === currentHour && currentMinute === m) {
              new Notification(`Time to take ${med.name}`, {
                body: `It's ${time}. Dose: ${med.dose}`,
                icon: '/vite.svg'
              });
            }
          });
        }
      });
    };

    const now = new Date();
    const msUntilNextMinute = (60 - now.getSeconds()) * 1000;

    let interval;
    const timeout = setTimeout(() => {
      checkReminders();
      interval = setInterval(checkReminders, 60000);
    }, msUntilNextMinute);

    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, [medications]);

  /** ----------------------------
   * OAuth Login (unchanged)
   * --------------------------- */
  const handleLogin = () => {
    // ... (unchanged) ...
    const redirectUri = window.location.origin;
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${GOOGLE_CLIENT_ID}&` +
      `redirect_uri=${redirectUri}&` +
      `response_type=token&` +
      // NOTE: add heart_rate scope and calendar scope
      `scope=${encodeURIComponent([
        'https://www.googleapis.com/auth/fitness.activity.read',
        'https://www.googleapis.com/auth/fitness.sleep.read',
        'https://www.googleapis.com/auth/fitness.heart_rate.read',
        'https://www.googleapis.com/auth/fitness.location.read',
        'https://www.googleapis.com/auth/calendar.events'
      ].join(' '))}&` +
      `state=google-fit-connect`;
    window.location.href = authUrl;
  };

  // Parse access token from URL (unchanged)
  useEffect(() => {
    if (window.location.hash) {
      const hash = window.location.hash.substring(1);
      const params = hash.split('&').reduce((acc, part) => {
        const [key, value] = part.split('=');
        if (key && value) acc[decodeURIComponent(key)] = decodeURIComponent(value);
        return acc;
      }, {});
      const accessToken = params['access_token'];
      const state = params['state'];
      if (accessToken && state === 'google-fit-connect') {
        setGoogleAccessToken(accessToken);
        // setError({ type: 'success', message: 'Signed in with Google and connected to Fit successfully! Welcome.' });
        window.history.replaceState({}, document.title, window.location.pathname);
        setActiveTab('activity');
      }
    }
  }, []);

  /** ---------------------------------------
   * Helpers: consistent time window (unchanged)
   * -------------------------------------- */
  const getTodayWindow = () => {
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const tzOffset = new Date().getTimezoneOffset() * 60 * 1000; // ms
    const localMidnight = now - ((now - tzOffset) % oneDayMs); // local day start
    const LATENCY_BUFFER_MS = 2 * 60 * 1000;
    return {
      startTimeMillis: localMidnight,
      endTimeMillis: now - LATENCY_BUFFER_MS
    };
  };

  /** ---------------------------------------
   * Google Fit Fetchers (unchanged)
   * -------------------------------------- */
  // ... (fetchSteps, fetchSleep, fetchCalories, fetchDistance, fetchHeartRate, syncAll unchanged) ...

  const fetchSteps = useCallback(async () => {
    if (!googleAccessToken) { /* setError('Error: Google Fit Access Token is missing. Please sign in again.'); */ return 0; }
    setIsStepsLoading(true);
    const { startTimeMillis, endTimeMillis } = getTodayWindow();
    const body = {
      aggregateBy: [{
        dataTypeName: "com.google.step_count.delta",
        dataSourceId: "derived:com.google.step_count.delta:com.google.android.gms:estimated_steps"
      }],
      bucketByTime: { durationMillis: endTimeMillis - startTimeMillis },
      startTimeMillis, endTimeMillis
    };
    try {
      const res = await exponentialBackoffFetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${googleAccessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      const steps = data.bucket?.[0]?.dataset?.[0]?.point?.[0]?.value?.[0]?.intVal;
      if (typeof steps === 'number') {
        setStepCount(steps);
        setStepsTrend([{ name: 'Today', steps: steps, goal: DAILY_STEP_GOAL }]);
        return steps;
      } else {
        setStepCount(0);
        // setError('No step data found for today.');
        return 0;
      }
    } catch (e) {
      console.error(e);
      setStepCount(0);
      // setError('Failed to fetch steps.');
      return 0;
    } finally {
      setIsStepsLoading(false);
    }
  }, [googleAccessToken]);

  const fetchSteps3h = useCallback(async () => {
    if (!googleAccessToken) return;

    const now = Date.now();
    const start = new Date();
    start.setHours(0, 0, 0, 0); // today at midnight

    const body = {
      aggregateBy: [{
        dataTypeName: "com.google.step_count.delta",
        dataSourceId: "derived:com.google.step_count.delta:com.google.android.gms:estimated_steps"
      }],
      bucketByTime: { durationMillis: 0.75 * 60 * 60 * 1000 }, // 3 hours
      startTimeMillis: start.getTime(),
      endTimeMillis: now
    };

    try {
      const res = await fetch("https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${googleAccessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      const data = await res.json();

      let cumulative = 0;

      const trend = data.bucket.map(b => {
        const pts = b.dataset?.[0]?.point;
        const deltaSteps = pts?.[0]?.value?.[0]?.intVal ?? 0;

        cumulative += deltaSteps;

        return {
          time: new Date(parseInt(b.startTimeMillis)).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
          }),
          steps: cumulative,       // used by the line
          stepsArea: cumulative    // 👈 used by the gradient area
        };
      });


      setSteps3hTrend(trend);

    } catch (err) {
      console.error("3h Steps Error:", err);
    }
  }, [googleAccessToken]);

  const fetchDistance3h = useCallback(async () => {
    if (!googleAccessToken) return;

    const now = Date.now();
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const body = {
      aggregateBy: [{
        dataTypeName: "com.google.distance.delta",
        dataSourceId: "derived:com.google.distance.delta:com.google.android.gms:merge_distance_delta"
      }],
      bucketByTime: { durationMillis: 0.75 * 60 * 60 * 1000 },
      startTimeMillis: start.getTime(),
      endTimeMillis: now
    };

    try {
      const res = await fetch("https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${googleAccessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      const data = await res.json();

      const trend = data.bucket.map(b => {
        const pts = b.dataset?.[0]?.point;
        const meters = pts?.[0]?.value?.[0]?.fpVal ?? 0;

        return {
          time: new Date(parseInt(b.startTimeMillis)).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
          }),
          km: parseFloat((meters / 1000).toFixed(2))
        };
      });
      // Convert to cumulative distance
      let cumulative = 0;
      const cumulativeTrend = trend.map(entry => {
        cumulative += entry.km;
        return {
          time: entry.time,
          km: parseFloat(cumulative.toFixed(2))
        };
      });

      setDistance3hTrend(cumulativeTrend);
    } catch (err) {
      console.error("3h Distance Error:", err);
    }
  }, [googleAccessToken]);


  const fetchSleep = useCallback(async () => {
    if (!googleAccessToken) { /* setError('Error: Google Fit Access Token is missing. Please sign in again.'); */ return 0; }
    setIsSleepLoading(true);
    const now = Date.now();
    const startTimeIso = new Date(now - 36 * 60 * 60 * 1000).toISOString();
    const endTimeIso = new Date(now).toISOString();
    const sessionsUrl = `https://www.googleapis.com/fitness/v1/users/me/sessions?startTime=${startTimeIso}&endTime=${endTimeIso}&activityType=72`;
    try {
      const res = await exponentialBackoffFetch(sessionsUrl, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${googleAccessToken}`, 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      const sleepSessions = data.session || [];

      if (!sleepSessions.length) {
        setSleepHours(0);
        return 0;
      }

      // 🔥 NEW PART: pick the most recent sleep session, like Google Fit does
      const latestSession = sleepSessions.reduce((latest, s) => {
        if (!latest) return s;
        return Number(s.endTimeMillis) > Number(latest.endTimeMillis) ? s : latest;
      }, null);

      const start = Number(latestSession.startTimeMillis);
      const end = Number(latestSession.endTimeMillis);
      const hours = Math.round(((end - start) / (1000 * 60 * 60)) * 10) / 10;

      setSleepHours(hours);
      return hours;
    } catch (e) {
      console.error(e);
      setSleepHours(0);
      return 0;
    } finally {
      setIsSleepLoading(false);
    }
  }, [googleAccessToken]);

  const fetchWeeklySleep = useCallback(async () => {
    if (!googleAccessToken) return;

    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    const url =
      `https://www.googleapis.com/fitness/v1/users/me/sessions?` +
      `startTime=${new Date(sevenDaysAgo).toISOString()}` +
      `&endTime=${new Date(now).toISOString()}` +
      `&activityType=72`;

    try {
      const res = await exponentialBackoffFetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${googleAccessToken}`,
          "Content-Type": "application/json",
        },
      });

      const data = await res.json();
      const sessions = data.session || [];

      // Group by day
      const daily = {};

      sessions.forEach((s) => {
        const start = new Date(parseInt(s.startTimeMillis));
        const end = new Date(parseInt(s.endTimeMillis));
        const hours = (end - start) / (1000 * 60 * 60);

        const dayKey = start.toISOString().split("T")[0];

        if (!daily[dayKey]) daily[dayKey] = 0;
        daily[dayKey] += hours;
      });

      // Build final chart list (sorted)
      const result = Object.keys(daily)
        .sort()
        .map((d) => {
          const dateObj = new Date(d);
          const label =
            dateObj.toLocaleDateString("en-US", { weekday: "short" }) +
            " "; // Sat 23

          return {
            name: label,
            hours: Math.round(daily[d] * 10) / 10,
          };
        });

      setSleepTrend(result);
    } catch (err) {
      console.error("Weekly Sleep Error:", err);
      setSleepTrend([]);
    }
  }, [googleAccessToken]);


  // Calories (merged source) — matches Google Fit app totals
  const fetchCalories = useCallback(async () => {
    if (!googleAccessToken) { setError('Error: Google Fit Access Token is missing. Please sign in again.'); return 0; }
    setIsCaloriesLoading(true);
    const { startTimeMillis, endTimeMillis } = getTodayWindow();
    const body = {
      aggregateBy: [{
        dataTypeName: "com.google.calories.expended",
        dataSourceId: "derived:com.google.calories.expended:com.google.android.gms:merge_calories_expended"
      }],
      bucketByTime: { durationMillis: endTimeMillis - startTimeMillis },
      startTimeMillis, endTimeMillis
    };
    try {
      const res = await exponentialBackoffFetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${googleAccessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      const kcal = data.bucket?.[0]?.dataset?.[0]?.point?.[0]?.value?.[0]?.fpVal;
      if (typeof kcal === 'number') {
        setCalories(Math.round(kcal));
        return kcal;
      } else {
        setCalories(0);
        // setError('No calories data found for today.');
        return 0;
      }
    } catch (e) {
      console.error(e);
      setCalories(0);
      // setError('Failed to fetch calories.');
      return 0;
    } finally {
      setIsCaloriesLoading(false);
    }
  }, [googleAccessToken]);

  // Distance (merged source) — fixes “0 km” mismatch
  const fetchDistance = useCallback(async () => {
    if (!googleAccessToken) { /* setError('Error: Google Fit Access Token is missing. Please sign in again.'); */ return 0; }
    setIsDistanceLoading(true);
    const { startTimeMillis, endTimeMillis } = getTodayWindow();
    const body = {
      aggregateBy: [{
        dataTypeName: "com.google.distance.delta",
        dataSourceId: "derived:com.google.distance.delta:com.google.android.gms:merge_distance_delta"
      }],
      bucketByTime: { durationMillis: endTimeMillis - startTimeMillis },
      startTimeMillis, endTimeMillis
    };
    try {
      const res = await exponentialBackoffFetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${googleAccessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();

      // Robust parsing: Sum up all points in all buckets
      let totalMeters = 0;
      if (data.bucket && Array.isArray(data.bucket)) {
        data.bucket.forEach(bucket => {
          if (bucket.dataset && Array.isArray(bucket.dataset)) {
            bucket.dataset.forEach(ds => {
              if (ds.point && Array.isArray(ds.point)) {
                ds.point.forEach(p => {
                  if (p.value && Array.isArray(p.value)) {
                    const val = p.value[0]?.fpVal;
                    if (typeof val === 'number') {
                      totalMeters += val;
                    }
                  }
                });
              }
            });
          }
        });
      }

      if (totalMeters > 0) {
        const km = totalMeters / 1000;
        setDistance(km.toFixed(2));
        setDistanceTrend(prev => [...prev.slice(-11), { name: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), km: parseFloat((km).toFixed(2)) }]);
        return km;
      } else {
        setDistance(0);
        // Don't show error if just 0 distance, it might be valid
        return 0;
      }
    } catch (e) {
      console.error("Distance fetch error:", e);
      setDistance(0);
      if (e.message.includes('403')) {
        setError('Permission denied for distance. Please sign out and sign in again to grant location access.');
      } else {
        // setError('Failed to fetch distance.');
      }
      return 0;
    } finally {
      setIsDistanceLoading(false);
    }
  }, [googleAccessToken]);

  // Heart rate — return latest sample seen in last 24h or show “no data” message
  const fetchHeartRate = useCallback(async () => {
    if (!googleAccessToken) { /* setError('Error: Google Fit Access Token is missing. Please sign in again.'); */ return null; }
    setIsHeartRateLoading(true);
    const now = Date.now();
    const startTimeMillis = now - 24 * 60 * 60 * 1000;
    const endTimeMillis = now - 60 * 1000; // 1-minute buffer

    const body = {
      aggregateBy: [{
        dataTypeName: "com.google.heart_rate.bpm",
        dataSourceId: "derived:com.google.heart_rate.bpm:com.google.android.gms:merge_heart_rate_bpm"
      }],
      bucketByTime: { durationMillis: 60 * 60 * 1000 }, // hourly buckets
      startTimeMillis, endTimeMillis
    };

    try {
      const res = await exponentialBackoffFetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${googleAccessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();

      let latestBpm = null; // FIX 3: Declare latestBpm in the outer scope.

      // prepare trend data (hourly buckets)
      if (Array.isArray(data.bucket)) {
        const hrData = data.bucket.map(b => {
          const pts = b?.dataset?.[0]?.point;
          const bpmVal = (Array.isArray(pts) && pts.length) ? (pts[pts.length - 1]?.value?.[0]?.fpVal ?? null) : null;
          return {
            time: new Date(parseInt(b.startTimeMillis)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            bpm: typeof bpmVal === 'number' ? Math.round(bpmVal) : null
          };
        }).filter(d => d.bpm !== null);
        if (hrData.length) setHeartRateTrend(hrData);

        // find the most recent bucket that has at least one point
        for (let i = data.bucket.length - 1; i >= 0; i--) {
          const pts = data.bucket[i]?.dataset?.[0]?.point;
          if (Array.isArray(pts) && pts.length) {
            const lastPoint = pts[pts.length - 1];
            const v = lastPoint?.value?.[0]?.fpVal;
            if (typeof v === 'number') { latestBpm = Math.round(v); break; }
          }
        }
      }
      // FIX 4, 5, 6, 7: Removed unnecessary else block, duplicated loop, and hanging brace.

      if (latestBpm !== null) {
        setHeartRate(latestBpm);
        return latestBpm;
      } else {
        setHeartRate(null);
        // setError('No heart-rate data found in the last 24 hours (wearable not connected).');
        return null;
      }
    } catch (e) {
      console.error(e);
      setHeartRate(null);
      // setError('Failed to fetch heart-rate.');
      return null;
    } finally {
      setIsHeartRateLoading(false);
    }
  }, [googleAccessToken]);

  const fetchWeeklyDistance = useCallback(async () => {
    if (!googleAccessToken) return;

    const now = Date.now();
    const start = now - 7 * 24 * 60 * 60 * 1000; // last 7 days

    const body = {
      aggregateBy: [{
        dataTypeName: "com.google.distance.delta",
        dataSourceId: "derived:com.google.distance.delta:com.google.android.gms:merge_distance_delta"
      }],
      bucketByTime: { durationMillis: 24 * 60 * 60 * 1000 }, // 1 day per bucket
      startTimeMillis: start,
      endTimeMillis: now
    };

    try {
      const res = await fetch(
        "https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${googleAccessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        }
      );

      const data = await res.json();

      const week = (data.bucket || []).map(b => {
        const meters = b.dataset?.[0]?.point?.[0]?.value?.[0]?.fpVal || 0;
        return {
          day: new Date(parseInt(b.startTimeMillis)).toLocaleDateString([], {
            weekday: "short"
          }),
          km: +(meters / 1000).toFixed(2)
        };
      });

      setWeeklyDistance(week);
    } catch (err) {
      console.error("Weekly Distance Error:", err);
    }
  }, [googleAccessToken]);

  const calculateHealthScore = useCallback(() => {
    let score = 0;

    const reasons = [];
    const suggestions = [];

    // STEPS — 20 pts
    if (stepCount !== null) {
      const ratio = Math.min(stepCount / DAILY_STEP_GOAL, 1);
      const pts = ratio * 20;
      score += pts;

      if (ratio >= 1) reasons.push("You met your steps goal.");
      else if (ratio >= 0.5) reasons.push("You got a moderate amount of steps.");
      else reasons.push("Low step count today reduced your score.");

      if (ratio < 1) suggestions.push("Try walking 10–15 minutes more.");
    }

    // SLEEP — 20 pts
    if (sleepHours !== null) {
      const ratio = Math.min(sleepHours / RECOMMENDED_SLEEP_HOURS, 1);
      const pts = ratio * 20;
      score += pts;

      if (ratio >= 1) reasons.push("Your sleep duration was good.");
      else if (ratio >= 0.7) reasons.push("Your sleep was slightly below ideal.");
      else reasons.push("Low sleep affected recovery.");

      if (ratio < 1) suggestions.push("Aim for 30–45 extra minutes of sleep.");
    }

    // HYDRATION - 20 pts
    if (hydration !== null) {
      const ratio = Math.min(hydration / hydrationGoal, 1);
      const pts = ratio * 20;
      score += pts;

      if (ratio >= 1) reasons.push("You met your hydration goal.");
      else if (ratio >= 0.5) reasons.push("Good water intake so far.");
      else reasons.push("Low water intake.");

      if (ratio < 1) suggestions.push("Drink a glass of water now.");
    }

    // CALORIES — 10 pts
    if (calories !== null) {
      const ratio = Math.min(calories / 500, 1);
      const pts = ratio * 10;
      score += pts;

      if (ratio >= 1) reasons.push("Good calorie burn today.");
      else if (ratio >= 0.5) reasons.push("Moderate activity level.");
      else reasons.push("Calorie burn is low.");

      if (ratio < 1) suggestions.push("Do a 10–20 min walk to increase burn.");
    }

    // DISTANCE — 10 pts
    if (distance !== null) {
      const ratio = Math.min(parseFloat(distance) / 5, 1);
      const pts = ratio * 10;
      score += pts;

      if (ratio >= 1) reasons.push("You walked a great distance.");
      else if (ratio >= 0.5) reasons.push("Decent walking distance.");
      else reasons.push("Low distance walked.");

      if (ratio < 1) suggestions.push("Try to add small walking intervals.");
    }

    // HEART RATE — 20 pts
    if (heartRate !== null) {
      const deviation = Math.abs(heartRate - 75);
      const hrScore = Math.max(0, 1 - deviation / 40);
      const pts = hrScore * 20;
      score += pts;

      if (deviation <= 5) reasons.push("Your heart rate is in a healthy range.");
      else if (deviation <= 15) reasons.push("Heart rate is slightly elevated.");
      else reasons.push("Heart rate is high today.");

      if (deviation > 10)
        suggestions.push("Try deep breathing or relaxing for a bit.");
    }

    const finalScore = Math.round(score);

    setHealthScore(finalScore);
    setHealthScoreExplanation(reasons.slice(0, 3));
    setHealthScoreSuggestions(suggestions.slice(0, 3));
  }, [stepCount, sleepHours, calories, distance, heartRate, hydration, hydrationGoal]);



  // One-click sync (does all fetches, stores daily row, then computes health score)
  const syncAll = useCallback(async () => {
    setIsSyncingAll(true);
    setAssessmentResult(null);

    try {
      const results = await Promise.allSettled([
        fetchSteps(),         // 0
        fetchSleep(),         // 1
        fetchWeeklySleep(),   // 2 (not used in row)
        fetchCalories(),      // 3
        fetchDistance(),      // 4
        fetchWeeklyDistance(),// 5 (not used in row)
        fetchHeartRate(),     // 6
        fetchSteps3h(),       // 7 (graph only)
        fetchDistance3h()     // 8 (graph only)
      ]);

      // --- Extract numeric values from today's fetch results ---
      const safeNumber = (res, index) => {
        if (!res[index] || res[index].status !== "fulfilled") return null;
        const v = res[index].value;
        return typeof v === "number" ? v : null;
      };

      const stepsValue = safeNumber(results, 0);
      const sleepValue = safeNumber(results, 1);
      const caloriesValue = safeNumber(results, 3) !== null ? Math.round(safeNumber(results, 3)) : null;
      const distanceValue = safeNumber(results, 4);
      const heartRateValue = safeNumber(results, 6);

      // --- Health Plan vitals from weekly tab (empty -> null) ---
      const bpSystolic = weeklyBP?.systolic ? Number(weeklyBP.systolic) : null;
      const bpDiastolic = weeklyBP?.diastolic ? Number(weeklyBP.diastolic) : null;
      const sugarMgDl = weeklySugar ? Number(weeklySugar) : null;
      const spo2Percent = weeklySpo2 ? Number(weeklySpo2) : null;

      // --- Persist one row per day for ML: /daily_metrics/YYYY-MM-DD ---
      if (db && userId) {
        const todayKey = getTodayDateKey();
        const metricsRef = doc(
          db,
          `/artifacts/${appId}/users/${userId}/daily_metrics/${todayKey}`
        );

        await setDoc(
          metricsRef,
          {
            userId,
            date: todayKey,

            steps: stepsValue,
            sleepHours: sleepValue,
            calories: caloriesValue,
            distanceKm: distanceValue,
            heartRateBpm: heartRateValue,

            updatedAt: Date.now()
          },
          { merge: true }
        );
      }

      // --- Decide if we have "some data" to run health score on ---
      const someData =
        (stepsValue ?? 0) > 0 ||
        (sleepValue ?? 0) > 0 ||
        (caloriesValue ?? 0) > 0 ||
        (distanceValue ?? 0) > 0 ||
        heartRateValue !== null;

      if (someData) {
        // use state-backed trends etc.
        calculateHealthScore();
      } else {
        // Optional: show a banner if you want
        // setError('Synced, but no metrics were available for today. Open Google Fit and sync your device, then try again.');
      }

      return results;
    } finally {
      setIsSyncingAll(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    googleAccessToken,
    fetchSteps,
    fetchSleep,
    fetchWeeklySleep,
    fetchCalories,
    fetchDistance,
    fetchWeeklyDistance,
    fetchHeartRate,
    fetchSteps3h,
    fetchDistance3h,
    db,
    userId,
    weeklyBP,
    weeklySugar,
    weeklySpo2
  ]);


  // Auto-sync: call once on login, and enable repeating sync when user presses Sync button
  useEffect(() => {
    if (!googleAccessToken) return;
    // call once on login
    syncAll();
  }, [googleAccessToken, syncAll]); // FIX 8: Added syncAll to dependency array

  useEffect(() => {
    if (!googleAccessToken) return;
    let interval = null;
    if (isAutoSyncActive) {
      // start immediate and then every 20s
      syncAll();
      interval = setInterval(() => { syncAll(); }, 20000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [isAutoSyncActive, googleAccessToken, syncAll]); // FIX 9: Added syncAll to dependency array

  /** ---------------------------------------
 * Assessment (updated to include hydration and better formatting)
 * -------------------------------------- */
  const callAssessmentAPI = useCallback(async () => {
    const apiKey = isLocalRun ? GEMINI_API_KEY : "";
    if (!apiKey) {
      setError("GEMINI API ERROR: Missing API Key in local run.");
      return;
    }
    setIsAssessmentLoading(true);

    const prompt = `
Analyze these health metrics and provide a concise wellness assessment:

**Today's Metrics:**
- Steps: ${stepCount ?? "N/A"}
- Sleep: ${sleepHours ?? "N/A"} hours
- Calories: ${calories ?? "N/A"} kcal
- Distance: ${distance ?? "N/A"} km
- Heart Rate: ${heartRate ?? "N/A"} bpm
- Water Intake: ${hydration ?? "N/A"} ml (Goal: ${hydrationGoal} ml)

**Recent Trends:**
- Steps Trend: ${stepsTrend.length > 0 ? stepsTrend[stepsTrend.length - 1]?.steps : "N/A"}
- Sleep Trend: ${sleepTrend.length > 0 ? sleepTrend[sleepTrend.length - 1]?.hours : "N/A"} hours
- Heart Rate Trend: ${heartRateTrend.length > 0 ? heartRateTrend[heartRateTrend.length - 1]?.bpm : "N/A"} bpm

Provide a VERY CONCISE assessment (max 150 words) with:
1. Quick summary of current status
2. Key areas needing improvement
3. Brief comparison to recent days
4. Top 2 actionable recommendations

**TABLE FORMAT REQUIREMENTS - FOLLOW EXACTLY:**
Create tables using this exact format:
| Metric | Today | Goal | Status |
|--------|-------|------|--------|
| Steps | 602 | 10,000 | Very Low |
| Sleep | 0 hrs | 7-9 hrs | Critical |

Do NOT use --- as separator rows. Use proper table headers with | characters only.
FOCUS ON TABLE FORMATTING

USE BOLD TEXT FOR THE SUBHEADINGS ONLY
THE CALORIES INDICATES THE AMOUNT OF CALORIES BURNED, NOT CONSUMED.
IF SLEEP AND HEART RATE VALUES ARE 0, DO NOT TAKE THAT INTO CONSIDERATION FOR WELLNESS ANALYSIS. 
`;

    const systemPrompt = `You are a concise Wellness Analyst. Provide brief, actionable insights in maximum 150 words. 
CRITICAL: Create tables using proper markdown format with | characters only. 
DO NOT use --- separator lines in tables. 
Table structure must be: | Header1 | Header2 | Header3 | followed by | row1 | data | data |
Keep tables compact and aligned properly. Focus on key improvements and trends.`;
   const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ "google_search": {} }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
    };

    try {
      const res = await exponentialBackoffFetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await res.json();
      const candidate = result.candidates?.[0];
      let modelText = "Sorry, I couldn't generate a response. Please check the console for API errors.";
      let sources = [];

      if (candidate && candidate.content?.parts?.[0]?.text) {
        modelText = candidate.content.parts[0].text;
        const groundingMetadata = candidate.groundingMetadata;
        if (groundingMetadata?.groundingAttributions) {
          sources = groundingMetadata.groundingAttributions
            .map(a => ({ uri: a.web?.uri, title: a.web?.title }))
            .filter(s => s.uri && s.title);
        }
      } else if (result.error) {
        modelText = `API Error: ${result.error.message}.`;
      }
      setAssessmentResult({ text: modelText, sources });
    } catch (e) {
      console.error(e);
      setAssessmentResult({ text: `Error fetching assessment: ${e.message}`, sources: [] });
    } finally {
      setIsAssessmentLoading(false);
    }
  }, [isLocalRun, stepCount, sleepHours, calories, distance, heartRate, hydration, hydrationGoal, stepsTrend, sleepTrend, heartRateTrend]);
  /** ---------------------------------------
   * Chatbot API Call - MODIFIED TO SAVE TO FIREBASE
   * -------------------------------------- */
  /** ---------------------------------------
 * Chatbot API Call - MODIFIED TO SAVE TO FIREBASE + IMAGE SUPPORT
 * -------------------------------------- */
  const callChatbotAPI = useCallback(
    async (newMessage, imageInlineData = null) => {
      // ============================================================
      // 1. SETUP & LOADING STATE
      // ============================================================
      setIsChatLoading(true);

      setThinkingStage("analyzing");
      const stage1 = setTimeout(() => setThinkingStage("searching"), 1000);
      const stage2 = setTimeout(() => setThinkingStage("reasoning"), 2200);

      // Failsafe: Force stop loading after 20s
      setTimeout(() => setIsChatLoading(false), 20000);

      // ============================================================
      // 2. SAVE USER MESSAGE TO FIRESTORE
      // ============================================================
      const userMessage = {
        role: "user",
        text: newMessage,
        sources: [],
        createdAt: Date.now()
      };

      if (db && userId) {
        try {
          const chatCollectionRef = collection(
            db,
            `/artifacts/${appId}/users/${userId}/chats`
          );
          await addDoc(chatCollectionRef, userMessage);
        } catch (e) {
          console.error("Error saving user message:", e);
        }
      }

      try {
        let modelText = "";
        let modelSources = [];

 
        // FIND THE "BRANCH A" BLOCK AND REPLACE IT WITH THIS:

        // ============================================================
        // BRANCH A — IMAGE MESSAGE → GEMINI MULTIPART UPLOAD
        // ============================================================
        if (imageInlineData) {
          console.log("🖼️ Image detected → Direct Gemini Vision API (Multipart Upload)");

          // 1. Upload the file to Gemini File API
          const formData = new FormData();
          formData.append("file", imageInlineData.file); // Use the file we passed

          const uploadResponse = await fetch(
            `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GEMINI_API_KEY}`,
            {
              method: "POST",
              body: formData
            }
          );
          
          const uploadResult = await uploadResponse.json();
          if (!uploadResult.file || !uploadResult.file.uri) {
            throw new Error("Gemini file upload failed: " + (uploadResult.error?.message || "Unknown error"));
          }
          
          const fileUri = uploadResult.file.uri;
          console.log("File uploaded successfully:", fileUri);

          // 2. Generate Content using the File URI
          // We use v1beta and gemini-2.5-flash (your app's standard)
          const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

          const systemInstruction = {
            parts: [{
              text: `You are a helpful medical AI analyzing user-uploaded images.
RULES:
- Describe what you SEE, in simple language.
- Give 2–3 possible explanations.
- DO NOT DIAGNOSE.
- DO NOT prescribe medications.
- ALWAYS say: "This is AI-based visual analysis, not a diagnosis."`
            }]
          };

          const payload = {
            contents: [
              {
                role: "user",
                parts: [
                  { text: newMessage },
                  { file_data: { mime_type: imageInlineData.mimeType, file_uri: fileUri } }
                ]
              }
            ],
            systemInstruction
          };

          const res = await exponentialBackoffFetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });

          const result = await res.json();
          modelText =
            result?.candidates?.[0]?.content?.parts
              ?.map((p) => p.text || "")
              .join("\n\n") ||
            result?.error?.message ||
            "Sorry, I could not analyze this image.";
        }

        // ============================================================
        // BRANCH B — TEXT MESSAGE → RAG BACKEND
        // ============================================================
        else {
          console.log("💬 Text message → RAG Backend");

          const response = await fetch("/api/chat-rag", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: newMessage,
              history: chatHistory.slice(-10),
              image: null
            })
          });

          if (!response.ok) {
            throw new Error(`Backend RAG error: ${response.status}`);
          }

          const data = await response.json();
          modelText =
            data.reply ||
            data.answer ||
            data.text ||
            "I couldn’t generate a response.";

          modelSources = data.sources || [];
        }

        // ============================================================
        // 3. STREAMING & SAVING LOGIC
        // ============================================================

        // Stop the "Typing..." dots because we are about to show the stream
        setIsChatLoading(false);

        // --- ADD THESE THREE LINES HERE (Around Line 1280) ---
        clearTimeout(stage1);
        clearTimeout(stage2);
        setIsChatLoading(false); // This stops the ThinkingBubble

        // Helper function to save to DB after streaming is done
        const saveFinalModelMessage = async () => {
          const modelMessage = {
            role: "assistant",
            text: modelText,
            sources: modelSources,
            createdAt: Date.now()
          };

          if (db && userId) {
            try {
              const chatCollectionRef = collection(
                db,
                `/artifacts/${appId}/users/${userId}/chats`
              );
              await addDoc(chatCollectionRef, modelMessage);
            } catch (e) {
              console.error("Error saving model message:", e);
            }
          }

          // ============================================================
          // 4. OPTIONAL — TTS
          // ============================================================
          if (speechEnabled || isVoiceMode) {
            speakText(modelText);
          }
        };

        // --- START STREAMING EFFECT ---
        setStreamingMessage(""); // Initialize empty bubble

        const words = modelText.split(" ");
        let index = 0;

        // Typing speed (adjust 25ms for faster/slower)
        const interval = setInterval(() => {
          setStreamingMessage(prev => {
            const nextWord = words[index];
            // Handle undefined safety if index goes out of bounds
            return nextWord ? (prev ? prev + " " + nextWord : nextWord) : prev;
          });

          index++;

          if (index >= words.length) {
            clearInterval(interval);

            // Small delay before finalizing to let user read the last word
            setTimeout(() => {
              setStreamingMessage(null); // Remove streaming bubble
              saveFinalModelMessage();   // Add permanent bubble to history
            }, 100);
          }
        }, 30);

      } catch (e) {
        console.error("❌ Chatbot Error:", e);
        // ... error handling remains the same ...
        setIsChatLoading(false); // Ensure loading stops on error
      }
      // Remove the `finally` block or ensure it doesn't conflict with streaming
      // (Since we handle setIsChatLoading(false) manually above, you can remove the finally block
      // or wrap it in a check)
    },
    [
      // ... dependencies ...
      chatHistory,      // Needed for RAG history context
      db,               // Needed for Firestore saving
      userId,           // Needed for user path
      appId,            // Needed for app path
      speechEnabled,    // Needed to decide if we should speak
      isVoiceMode,      // Needed to decide if we should speak
      speakText         // The function used to speak
    ]
  );

  // Update ref when callChatbotAPI changes
  useEffect(() => {
    callChatbotApiRef.current = callChatbotAPI;
  }, [callChatbotAPI]);

  // Chat scroll + file input refs
  const chatContainerRef = useRef(null); // scrollable chat area
  const fileInputRef = useRef(null);     // hidden file input for image upload
  const cameraInputRef = useRef(null);   // hidden file input for taking a photo

  // === Camera modal state & refs ===
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const videoReff = useRef(null);   // <video> element inside the modal
  const canvasReff = useRef(null);  // hidden <canvas> used to grab a frame
  const [cameraStream, setCameraStream] = useState(null); // to stop camera later

  const [cameraMode, setCameraMode] = useState(null); // 'chat' or 'prescription'




  useEffect(() => {
    if (chatContainerRef.current) {
      const el = chatContainerRef.current;
      el.scrollTop = el.scrollHeight; // always jump to newest message
    }
  }, [chatHistory, isChatLoading]);


  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    // Allow only images
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file (jpg, png, etc.)');
      event.target.value = '';
      return;
    }
    setAttachedImage(file);
  };

  // ===== CAMERA HELPERS =====
  const startCamera = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Camera is not supported in this browser.");
        setIsCameraModalOpen(false);
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }, // back camera on phones, normal cam on laptop
        audio: false
      });

      if (videoReff.current) {
        videoReff.current.srcObject = stream;
      }
      setCameraStream(stream);
    } catch (err) {
      console.error("Error starting camera:", err);
      alert("Could not access the camera. Check permissions and try again.");
      setIsCameraModalOpen(false);
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
  };

  // When the modal opens/closes, start/stop the camera
  useEffect(() => {
    if (isCameraModalOpen) {
      startCamera();
    } else {
      stopCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCameraModalOpen]);

  const handleCaptureFromCamera = () => {
    const video = videoReff.current;
    const canvas = canvasReff.current;
    if (!video || !canvas) return;

    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, width, height);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], "camera-photo.jpg", { type: "image/jpeg" });

      if (cameraMode === 'prescription') {
        // Used from Upload prescription → Take a photo
        setPrescriptionImage(file);
        handleScanPrescriptionWithGemini(file);
      } else {
        // default: chat image attachment
        setAttachedImage(file);
      }

      setIsCameraModalOpen(false);
      setCameraMode(null);
    }, "image/jpeg", 0.9);
  };

  const handleClearChat = () => {
    if (!window.confirm("Are you sure you want to clear the chat history?")) return;

    const now = Date.now();

    // Store a "clear marker" only on the client
    if (userId) {
      try {
        localStorage.setItem(`chatClearedAt_${userId}`, String(now));
      } catch (e) {
        console.error("Failed to persist chat clear marker:", e);
      }
    }

    // Immediately clear the visible chat in this session
    setChatHistory([INITIAL_CHAT_WELCOME]);
    setAttachedImage(null); // also clear any attached image
  };


  /** ---------------------------------------
   * Meds CRUD (unchanged)
   * -------------------------------------- */
  const handleNewMedChange = (e) => {
    const { name, value } = e.target;
    setNewMedication(prev => ({ ...prev, [name]: value }));
  };

  // ---------------- Prescription → Gemini → pre-fill form ----------------
  const handlePrescriptionFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file (jpg, png, etc.)');
      event.target.value = '';
      return;
    }

    setPrescriptionImage(file);
    handleScanPrescriptionWithGemini(file);
  };

  // Convert a "1-0-1" style pattern into actual time slots
  // Format: morning - afternoon - night
  const computeTimesFromPattern = (pattern) => {
    if (!pattern) {
      // fallback: once a day morning
      return ["08:00"];
    }

    // Remove spaces, handle formats like "1 - 0 - 1" or "101"
    const cleaned = pattern.replace(/\s/g, '');
    const parts = cleaned.includes('-') ? cleaned.split('-') : cleaned.split('');

    const times = [];
    // index 0 → morning, 1 → afternoon, 2 → night
    if (parts[0] === '1') times.push("08:00"); // morning
    if (parts[1] === '1') times.push("14:00"); // afternoon
    if (parts[2] === '1') times.push("21:00"); // night

    // If we somehow got nothing, default to once in morning
    return times.length ? times : ["08:00"];
  };

  const handleScanPrescriptionWithGemini = async (file) => {
    const apiKey = isLocalRun ? GEMINI_API_KEY : "";
    if (!apiKey) {
      setError("GEMINI API ERROR: Missing API Key. Cannot scan prescription.");
      return;
    }

    setIsPrescriptionScanning(true);

    try {
      // 1. Read image as base64
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          if (!reader.result) return reject(new Error("Failed to read image"));
          const resultStr = reader.result.toString();
          const parts = resultStr.split(',');
          resolve(parts[1] || resultStr);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      // 2. Build Gemini request
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

      const prompt = `
You are reading a doctor's prescription image.

Your job is to extract ONLY the information needed to create medication reminders:
- medication name
- dosage
- morning/afternoon/night pattern written like "1 - 0 - 1".

Return ONLY a single JSON object in this exact structure:

{
  "medications": [
    {
      "medicationName": "string",
      "dose": "string",
      "doseIsInferred": true,
      "timingPattern": "1-0-1"
    }
  ]
}

Rules:

- medicationName:
  - Include the drug name and strength if visible.
  - Example: "Amoxicillin 500 mg", "Atorvastatin 10 mg".

- dose:
  - If dosage instructions are clearly written (e.g. "1-0-1", "1-1-1", "1 tab OD", "1 tab BD"):
    - Convert them into a short, clear instruction.
    - Examples: "1 tablet twice daily", "1 tablet once daily at night".
    - Set doseIsInferred to false.
  - If NO clear dosage is written for that medication:
    - Use your medical knowledge to infer a typical adult dose that is commonly prescribed.
    - Put that inferred dose text into dose.
    - Set doseIsInferred to true.

- timingPattern:
  - Look specifically for patterns like "1 - 0 - 1", "1-1-0", "0-1-1", etc.
  - First position = morning, second = afternoon, third = night.
  - You may normalise formats, e.g. "1 0 1" → "1-0-1".
  - If pattern is not explicitly written but text clearly implies, e.g. "morning and night", you may infer "1-0-1".
  - If you truly cannot deduce any pattern, use "1-0-0" (once in the morning) as a safe default.

- medications:
  - If you find multiple medications, return ALL of them inside the medications array.
  - If you find only one, still return it inside the array.

- Do not include any explanation or extra text outside of the JSON object.
`;

      const payload = {
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              {
                inlineData: {
                  data: base64,
                  mimeType: file.type || "image/jpeg"
                }
              }
            ]
          }
        ]
      };

      const res = await exponentialBackoffFetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await res.json();
      const candidate = result.candidates?.[0];

      if (!candidate || !candidate.content?.parts?.length) {
        throw new Error("No response from Gemini for prescription.");
      }

      // Gemini might wrap JSON in extra text → pull out JSON part
      const raw = candidate.content.parts.map(p => p.text || '').join('\n');
      const firstBrace = raw.indexOf('{');
      const lastBrace = raw.lastIndexOf('}');
      const jsonText =
        firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace
          ? raw.slice(firstBrace, lastBrace + 1)
          : raw;

      let parsed;
      try {
        parsed = JSON.parse(jsonText);
      } catch (e) {
        console.error("Failed to parse JSON from Gemini:", raw);
        throw new Error("Could not understand prescription. Please type details manually.");
      }

      // 3) Normalise to an array of meds
      let medsFromRx = [];
      if (Array.isArray(parsed.medications)) {
        medsFromRx = parsed.medications;
      } else if (parsed.medicationName || parsed.name) {
        // fallback if model still returns single object
        medsFromRx = [parsed];
      }

      if (!medsFromRx.length) {
        throw new Error("No medications found in prescription image.");
      }

      const nowBase = Date.now();

      // 4) Build reminders from each medication
      const builtMeds = medsFromRx.map((m, idx) => {
        const medName = m.medicationName || m.name || "";
        const dose = m.dose || "";
        const pattern =
          m.timingPattern ||
          m.pattern ||
          m.timing ||
          m.schedule ||
          ""; // catch any reasonable naming

        const times = computeTimesFromPattern(pattern);

        return {
          id: nowBase + idx,
          name: medName,
          dose,
          times,
          createdFromPrescription: true,
          doseIsInferred: m.doseIsInferred === true || (!m.dose && !!medName),
          timingPattern: pattern
        };
      });

      // 5) Persist all of them in Firestore so they stay across logins
      if (!db || !userId) {
        throw new Error("Database not ready while saving prescription medications.");
      }

      const medCollectionRef = collection(db, `/artifacts/${appId}/users/${userId}/medications`);

      // Save each medication as its own document
      await Promise.all(
        builtMeds.map(async (m) => {
          const medicationData = {
            name: m.name,
            dose: m.dose,
            times: m.times,
            createdAt: Date.now(),
            createdFromPrescription: true,
            timingPattern: m.timingPattern || "",
            doseIsInferred: !!m.doseIsInferred,
          };

          await addDoc(medCollectionRef, medicationData);
        })
      );

      // ✅ ADD PRESCRIPTION MEDS TO GOOGLE CALENDAR
      if (googleAccessToken) {
        try {
          const allDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const dayToRRule = { 'Sun': 'SU', 'Mon': 'MO', 'Tue': 'TU', 'Wed': 'WE', 'Thu': 'TH', 'Fri': 'FR', 'Sat': 'SA' };
          const rruleDays = allDays.map(d => dayToRRule[d]).join(',');

          // Calculate 30 days from today for UNTIL date
          const untilDate = new Date();
          untilDate.setDate(untilDate.getDate() + 30);
          const untilDateStr = untilDate.toISOString().split('T')[0].replace(/-/g, '');

          // Map to store calendar event IDs for each medication
          const medCalendarEventIds = {};

          for (const med of builtMeds) {
            const eventIds = [];
            for (const time of med.times) {
              const [hours, minutes] = time.split(':').map(Number);

              const startDate = new Date();
              startDate.setHours(hours, minutes, 0, 0);

              const endDate = new Date(startDate);
              endDate.setMinutes(endDate.getMinutes() + 15);

              const event = {
                summary: `💊 ${med.name}`,
                description: `Dose: ${med.dose}\n\nMedication reminder from Health Navigator (Prescription Scan)`,
                start: {
                  dateTime: startDate.toISOString(),
                  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
                },
                end: {
                  dateTime: endDate.toISOString(),
                  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
                },
                recurrence: [
                  `RRULE:FREQ=WEEKLY;BYDAY=${rruleDays};UNTIL=${untilDateStr}`
                ],
                reminders: {
                  useDefault: false,
                  overrides: [
                    { method: 'popup', minutes: 5 }
                  ]
                }
              };

              const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${googleAccessToken}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify(event)
              });

              if (response.ok) {
                const eventData = await response.json();
                eventIds.push(eventData.id);
              }
            }
            medCalendarEventIds[med.name] = eventIds;
          }

          // Update medication documents with calendar event IDs
          if (Object.keys(medCalendarEventIds).length > 0) {
            const medCollectionRef = collection(db, `/artifacts/${appId}/users/${userId}/medications`);
            const q = query(medCollectionRef, orderBy('createdAt', 'desc'), limit(builtMeds.length));
            const snapshot = await getDocs(q);
            const docs = snapshot.docs.slice(0, builtMeds.length);

            for (let i = 0; i < docs.length; i++) {
              const medDoc = docs[i];
              const medData = medDoc.data();
              if (medCalendarEventIds[medData.name]) {
                await updateDoc(doc(db, `/artifacts/${appId}/users/${userId}/medications`, medDoc.id), {
                  calendarEventIds: medCalendarEventIds[medData.name]
                });
              }
            }
          }
          console.log('Prescription medications added to Google Calendar');
        } catch (calendarError) {
          console.warn('Failed to add prescription meds to Google Calendar:', calendarError);
        }
      }

      // Firestore onSnapshot listener will update `medications` state with real IDs,
      // so we don't need to call setMedications manually here.

      // 6) Clear the form & close the Add Medication dialog
      setNewMedication({ name: '', dose: '', times: ['08:00'], days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] });
      setPrescriptionImage(null);
      setEditingMedId(null);
      setIsAdding(false);

      setError(null);

      const inferredCount = builtMeds.filter(m => m.doseIsInferred).length;
      const totalCount = builtMeds.length;

      let msg = `Prescription scanned. Created ${totalCount} medication reminder${totalCount > 1 ? "s" : ""} from the image.`;
      if (inferredCount > 0) {
        msg += ` For ${inferredCount} of them, the dosage was not written clearly, so a common adult dose was inferred.`;
      }
      msg += ` You can edit any reminder from the list if needed.`;

      alert(msg);
    } catch (e) {
      console.error("Prescription scan error:", e);
      setError(`Failed to scan prescription: ${e.message}`);
    } finally {
      setIsPrescriptionScanning(false);
    }
  };

  const handleTimeChange = (index, value) => {
    const cleanValue = value.replace(':', '').slice(0, 4);
    setNewMedication(prev => {
      const newTimes = [...prev.times];
      newTimes[index] = value;
      return { ...prev, times: newTimes };
    });
  };
  const handleAddTime = () => setNewMedication(prev => ({ ...prev, times: [...prev.times, '08:00'] }));
  const handleRemoveTime = (indexToRemove) => setNewMedication(prev => ({ ...prev, times: prev.times.filter((_, i) => i !== indexToRemove) }));

  const handleSaveMedication = async () => {
    const isConfigMissing = !firebaseConfig.apiKey;
    if (!db || !userId) {
      if (isLocalRun && isConfigMissing) {
        setError("Database Error: Provide Firebase config in FIREBASE_LOCAL_CONFIG to enable persistence.");
      } else {
        setError("Database not ready. Please wait for initialization or check Firebase setup.");
      }
      return;
    }

    if (
      !newMedication.name.trim() ||
      !newMedication.dose.trim() ||
      newMedication.times.every((t) => !t.trim())
    ) {
      setError("Please enter a name, dose, and at least one time.");
      return;
    }

    const validTimes = newMedication.times
      .map((t) => t.trim())
      .filter((t) => t.match(/^\d{2}:\d{2}$/))
      .sort();

    if (validTimes.length === 0) {
      setError("Use the time picker to select valid times.");
      return;
    }

    if (!newMedication.days || newMedication.days.length === 0) {
      setError("Please select at least one day of the week.");
      return;
    }


    const medicationData = {
      name: newMedication.name.trim(),
      dose: newMedication.dose.trim(),
      times: validTimes,
      days: newMedication.days,
      updatedAt: Date.now(),
    };


    try {
      const medCollectionRef = collection(
        db,
        `/artifacts/${appId}/users/${userId}/medications`
      );


      let newMedDocRef = null;
      if (editingMedId) {
        // ✅ EDIT EXISTING MEDICATION
        const medDocRef = doc(medCollectionRef, editingMedId);
        await updateDoc(medDocRef, medicationData);
        newMedDocRef = medDocRef;
        // your onSnapshot listener will refresh `medications`
      } else {
        // ✅ CREATE NEW MEDICATION
        newMedDocRef = await addDoc(medCollectionRef, {
          ...medicationData,
          createdAt: Date.now(),
        });

        // optional webhook only for new meds
        try {
          fetch(
            "https://AdityaPrakash781-vytalcare-n8n.hf.space/webhook/new-medication",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                userId,
                medName: newMedication.name,
                times: validTimes,
              }),
            }
          );
        } catch (webhookError) {
          console.warn("Failed to trigger n8n webhook", webhookError);
        }
      }

      // ✅ ADD TO GOOGLE CALENDAR
      if (googleAccessToken) {
        try {
          // Map days to Google Calendar recurrence day codes
          const dayToRRule = { 'Sun': 'SU', 'Mon': 'MO', 'Tue': 'TU', 'Wed': 'WE', 'Thu': 'TH', 'Fri': 'FR', 'Sat': 'SA' };
          const rruleDays = newMedication.days.map(d => dayToRRule[d]).join(',');

          let calendarSuccess = true;
          let calendarErrorMsg = '';
          const calendarEventIds = [];

          // Calculate 30 days from today for UNTIL date
          const untilDate = new Date();
          untilDate.setDate(untilDate.getDate() + 30);
          const untilDateStr = untilDate.toISOString().split('T')[0].replace(/-/g, '');

          // Create a calendar event for each time
          for (const time of validTimes) {
            const [hours, minutes] = time.split(':').map(Number);

            // Create start date (today at the specified time)
            const startDate = new Date();
            startDate.setHours(hours, minutes, 0, 0);

            // End date is 15 minutes after start
            const endDate = new Date(startDate);
            endDate.setMinutes(endDate.getMinutes() + 15);

            const event = {
              summary: `💊 ${medicationData.name}`,
              description: `Dose: ${medicationData.dose}\n\nMedication reminder from Health Navigator`,
              start: {
                dateTime: startDate.toISOString(),
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
              },
              end: {
                dateTime: endDate.toISOString(),
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
              },
              recurrence: [
                `RRULE:FREQ=WEEKLY;BYDAY=${rruleDays};UNTIL=${untilDateStr}`
              ],
              reminders: {
                useDefault: false,
                overrides: [
                  { method: 'popup', minutes: 5 }
                ]
              }
            };

            const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${googleAccessToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(event)
            });

            if (response.ok) {
              const eventData = await response.json();
              calendarEventIds.push(eventData.id);
            } else {
              const errorData = await response.json();
              calendarSuccess = false;
              calendarErrorMsg = errorData.error?.message || 'Unknown error';
              console.error('Calendar API error:', errorData);
            }
          }

          // Store calendar event IDs in the medication document
          if (calendarEventIds.length > 0 && newMedDocRef) {
            await updateDoc(newMedDocRef, { calendarEventIds });
          }

          if (calendarSuccess) {
            console.log('Medication added to Google Calendar');
            alert('✅ Medication saved and added to your Google Calendar!');
          } else {
            console.warn('Failed to add to Google Calendar:', calendarErrorMsg);
            alert(`⚠️ Medication saved, but Google Calendar sync failed: ${calendarErrorMsg}\n\nYou may need to sign out and sign back in to grant calendar permissions.`);
          }
        } catch (calendarError) {
          console.warn('Failed to add to Google Calendar:', calendarError);
          alert('⚠️ Medication saved, but Google Calendar sync failed. Please sign out and sign back in to enable calendar sync.');
        }
      } else {
        alert('✅ Medication saved! (Calendar sync requires re-login for permissions)');
      }

      // reset + close form for both add and edit
      setNewMedication({ name: "", dose: "", times: ["08:00"], days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] });
      setEditingMedId(null);
      setPrescriptionImage(null);
      setIsAdding(false);
      setError(null);
    } catch (e) {
      console.error("Error saving medication: ", e);
      setError(`Failed to save medication: ${e.message}.`);
    }
  };

  const handleDeleteMedication = async (id) => {
    if (!db) return;

    // Get the medication data first to know the name for calendar deletion
    const medToDelete = medications.find(m => m.id === id);

    const medDocRef = doc(db, `/artifacts/${appId}/users/${userId}/medications`, id);
    try {
      await deleteDoc(medDocRef);

      // Delete from Google Calendar if we have access
      if (googleAccessToken && medToDelete) {
        try {
          // Use stored calendar event IDs if available, otherwise search by name
          if (medToDelete.calendarEventIds && Array.isArray(medToDelete.calendarEventIds)) {
            // Delete using stored event IDs
            for (const eventId of medToDelete.calendarEventIds) {
              try {
                await fetch(
                  `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
                  {
                    method: 'DELETE',
                    headers: {
                      'Authorization': `Bearer ${googleAccessToken}`
                    }
                  }
                );
              } catch (e) {
                // Event might already be deleted, continue
                console.warn(`Event ${eventId} may already be deleted:`, e);
              }
            }
            console.log('Medication and calendar events deleted');
          } else {
            // Fallback: Search for calendar events with this medication name
            const searchQuery = encodeURIComponent(`💊 ${medToDelete.name}`);
            const searchResponse = await fetch(
              `https://www.googleapis.com/calendar/v3/calendars/primary/events?q=${searchQuery}`,
              {
                headers: {
                  'Authorization': `Bearer ${googleAccessToken}`
                }
              }
            );

            if (searchResponse.ok) {
              const searchData = await searchResponse.json();
              const events = searchData.items || [];

              // Delete each matching event
              for (const event of events) {
                if (event.summary === `💊 ${medToDelete.name}`) {
                  await fetch(
                    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${event.id}`,
                    {
                      method: 'DELETE',
                      headers: {
                        'Authorization': `Bearer ${googleAccessToken}`
                      }
                    }
                  );
                }
              }
              console.log('Medication and calendar events deleted');
            }
          }
        } catch (calendarError) {
          console.warn('Failed to delete from Google Calendar:', calendarError);
        }
      }
    }
    catch (e) { console.error("Error deleting document: ", e); setError("Failed to delete medication."); }
  };

  // --- NEW AUTOMATIC LOGGING FUNCTION ---
  const handleMarkAsTaken = async (medItem) => {
    if (!db || !userId) return;

    try {
      const now = new Date();
      // 1. Create the Log (This automatically creates the 'medication_logs' collection!)
      await addDoc(collection(db, `/artifacts/${appId}/users/${userId}/medication_logs`), {
        userId: userId,
        medicationId: medItem.medId || "unknown", // Fallback if ID is missing
        medicationName: medItem.medName,
        scheduledTime: medItem.time,
        takenAt: now.toISOString(),
        status: 'taken',
        dateKey: getTodayDateKey() // Uses your existing date helper
      });

      // 2. Browser Notification (Immediate Feedback)
      new Notification("Great job!", {
        body: `You took ${medItem.medName} on time.`,
        icon: '/vite.svg'
      });

      // 3. (Optional) Optimistic UI update could go here
      // For now, we rely on the button disabling itself in the UI below or just alert
      alert(`Successfully logged ${medItem.medName} as taken!`);

    } catch (e) {
      console.error("Error logging medication:", e);
      alert("Failed to save log. Check console.");
    }
  };


  // Get current day name for filtering
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const currentDayName = dayNames[now.getDay()];

  const todaySchedule = medications
    .filter(med => {
      // If medication has days array, check if today is included
      // If no days array (legacy data), show every day
      if (Array.isArray(med.days) && med.days.length > 0) {
        return med.days.includes(currentDayName);
      }
      return true; // Legacy medications without days show every day
    })
    .flatMap(med => med.times.map(time => ({
      time: time,
      medName: med.name,
      dose: med.dose,
      medId: med.id,
      key: med.id + time,
    })))
    .sort((a, b) => a.time.localeCompare(b.time));
  /** ---------------------------------------
   * Renderers (unchanged)
   * -------------------------------------- */
  const renderMedicationForm = () => (
    <div className="p-6 rounded-2xl space-y-5 bg-surface border border-slate-100 dark:border-slate-700 shadow-sm animate-fade-in">
      {/* Title changes depending on Add vs Edit */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-text-main dark:text-white">
          {editingMedId ? 'Edit Medication' : 'Add New Medication'}
        </h3>
        {editingMedId && (
          <span className="text-xs text-text-muted dark:text-slate-400">
            You're updating an existing reminder
          </span>
        )}
      </div>

      {/* 30-Day Google Calendar Sync Notice */}
      <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
        <p className="text-xs text-blue-700 dark:text-blue-300">
          <span className="font-semibold">📅 Note:</span> Medications added will be synced to your Google Calendar for 30 days. After 30 days, you'll need to add the medication again to continue receiving reminders.
        </p>
      </div>

      {/* Name + Dose */}

      <div className="space-y-3">
        <input
          type="text"
          name="name"
          value={newMedication.name}
          onChange={handleNewMedChange}
          placeholder="Medication Name (e.g. Vitamin D)"
          className="w-full p-3 border border-slate-200 dark:border-slate-600 rounded-xl placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-slate-50 dark:bg-slate-800 dark:text-white focus:bg-white dark:focus:bg-slate-700 text-text-main"
        />
        <input
          type="text"
          name="dose"
          value={newMedication.dose}
          onChange={handleNewMedChange}
          placeholder="Dose (e.g. 1000 IU or 1 tab)"
          className="w-full p-3 border border-slate-200 dark:border-slate-600 rounded-xl placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-slate-50 dark:bg-slate-800 dark:text-white focus:bg-white dark:focus:bg-slate-700 text-text-main"
        />
      </div>

      {/* Upload prescription (for new OR edit if you want to re-scan) */}
      <div className="relative flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {/* Hidden input for prescription image */}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            ref={prescriptionFileInputRef}
            className="hidden"
            onChange={handlePrescriptionFileChange}
          />

          <button
            type="button"
            onClick={() => setShowPrescriptionAttachMenu(prev => !prev)}
            disabled={isPrescriptionScanning}
            className="px-3 py-2 text-xs rounded-lg border border-primary/40 text-primary hover:bg-primary/5 disabled:opacity-60 flex items-center gap-1.5"
          >
            {isPrescriptionScanning ? (
              <span>Scanning…</span>
            ) : (
              <>
                <Paperclip size={14} />
                <span>Upload prescription</span>
              </>
            )}
          </button>
        </div>

        {showPrescriptionAttachMenu && (
          <div className="absolute left-0 top-full mt-1 w-44 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 z-40 text-xs">
            <button
              type="button"
              onClick={() => {
                setShowPrescriptionAttachMenu(false);
                if (prescriptionFileInputRef.current) {
                  prescriptionFileInputRef.current.click(); // open file browser
                }
              }}
              className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-t-xl"
            >
              Upload photo
            </button>
            <button
              type="button"
              onClick={() => {
                setShowPrescriptionAttachMenu(false);
                setCameraMode('prescription'); // 👈 tell the modal we’re scanning Rx
                setIsCameraModalOpen(true);    // 👈 open the same webcam modal
              }}
              className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-b-xl border-t border-slate-100 dark:border-slate-700"
            >
              Take a photo
            </button>
          </div>
        )}
      </div>

      {prescriptionImage && (
        <div className="flex items-center gap-3 mt-2 px-1">
          {/* Tiny image preview */}
          <div className="relative w-14 h-14 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
            <img
              src={URL.createObjectURL(prescriptionImage)}
              alt="Prescription preview"
              className="w-full h-full object-cover"
            />
          </div>

          {/* Info text (like chat preview) */}
          <div className="flex-1 text-[11px] text-text-muted dark:text-slate-400">
            <div className="font-semibold text-text-main dark:text-slate-100 mb-0.5 truncate">
              {prescriptionImage.name || 'camera-photo.jpg'}
            </div>
            <div>
              Using this image to read your prescription and create reminders.
              Please double-check the name, dose and timings below.
            </div>
          </div>

          {/* Optional: clear button */}
          <button
            type="button"
            onClick={() => setPrescriptionImage(null)}
            className="text-[10px] px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            Remove
          </button>
        </div>
      )}

      {/* Time slots editor */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-text-muted dark:text-slate-400">
          When should you take it?
        </p>

        <div className="space-y-2">
          {newMedication.times.map((time, index) => {
            const { time24, time12 } = formatTimeWithBoth(time);
            return (
              <div key={index} className="flex items-start gap-2">
                <div className="flex flex-col items-center">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={time}
                    onChange={(e) => {
                      let val = e.target.value.replace(/[^0-9:]/g, '');
                      // Auto-insert colon after 2 digits if not present
                      if (val.length === 2 && !val.includes(':')) {
                        val = val + ':';
                      }
                      // Limit to 5 characters (HH:mm)
                      if (val.length <= 5) {
                        handleTimeChange(index, val);
                      }
                    }}
                    placeholder="HH:mm"
                    maxLength={5}
                    className="p-2 border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary font-mono text-lg w-24 text-center"
                  />
                  {time12 && (
                    <span className="text-xs text-text-muted dark:text-slate-400 mt-1">({time12})</span>
                  )}
                </div>
                {newMedication.times.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveTime(index)}
                    className="px-2 py-1 text-xs rounded-lg border border-red-200 text-red-500 hover:bg-red-50 mt-2"
                  >
                    Remove
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={handleAddTime}
          className="mt-2 text-xs font-medium text-primary hover:underline"
        >
          + Add another time
        </button>
      </div>

      {/* Days of week selection */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-text-muted dark:text-slate-400">
          Which days should you take it?
        </p>
        <div className="flex flex-wrap gap-2">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => {
            const isSelected = newMedication.days.includes(day);
            return (
              <button
                key={day}
                type="button"
                onClick={() => {
                  setNewMedication(prev => ({
                    ...prev,
                    days: isSelected
                      ? prev.days.filter(d => d !== day)
                      : [...prev.days, day]
                  }));
                }}
                className={`px-3 py-2 text-xs font-medium rounded-lg border transition-all ${isSelected
                  ? 'bg-primary text-white border-primary shadow-sm'
                  : 'bg-slate-50 text-text-muted border-slate-200 hover:border-primary/50 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300'
                  }`}
              >
                {day}
              </button>
            );
          })}
        </div>
        {newMedication.days.length === 0 && (
          <p className="text-xs text-red-500">Please select at least one day</p>
        )}
      </div>


      {/* Save / Update button */}
      <div className="pt-2 flex justify-end">
        <button
          onClick={handleSaveMedication}
          className="flex items-center px-6 py-3 bg-primary text-white font-semibold rounded-xl shadow-md shadow-primary/20 hover:bg-primary-dark hover:-translate-y-0.5 transition-all duration-200"
        >
          <Bell size={18} className="mr-2" />
          {editingMedId ? 'Update Medication' : 'Save Medication'}
        </button>
      </div>
    </div>
  );

  const handleEditMedication = (medOrId) => {
    // Accept either a med object or an id
    const med =
      typeof medOrId === 'string'
        ? medications.find((m) => m.id === medOrId)
        : medOrId;

    if (!med) return;

    // Open the add/edit form
    setIsAdding(true);

    // Remember which medication we're editing
    setEditingMedId(med.id);

    // Pre-fill the form fields
    setNewMedication({
      name: med.name || '',
      dose: med.dose || '',
      times:
        Array.isArray(med.times) && med.times.length
          ? med.times
          : ['08:00'],
      days:
        Array.isArray(med.days) && med.days.length
          ? med.days
          : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    });

    // We're editing, not scanning a new prescription
    setPrescriptionImage(null);
  };

  const renderRemindersTab = () => {
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // Enrich schedule with status
    const scheduleWithStatus = todaySchedule.map(item => {
      let h, m;
      // Robust time parsing (HH:MM or HHMM legacy)
      if (item.time && item.time.includes(':')) {
        [h, m] = item.time.split(':').map(Number);
      } else if (item.time && item.time.length === 4) {
        h = parseInt(item.time.substring(0, 2), 10);
        m = parseInt(item.time.substring(2, 4), 10);
      } else {
        h = 0; m = 0;
      }
      if (isNaN(h)) h = 0;
      if (isNaN(m)) m = 0;

      const itemMinutes = h * 60 + m;
      const uniqueKey = `${item.medId}_${item.time}`;
      const isTaken = takenMedications.has(uniqueKey);

      // "Missed" logic: Not taken AND > 15 mins passed
      // diffMinutes < -15 means scheduled time was more than 15 mins ago
      const diffMinutes = itemMinutes - currentMinutes;
      const isMissed = !isTaken && diffMinutes < -15;
      const isPast = itemMinutes < currentMinutes;

      return { ...item, itemMinutes, diffMinutes, isTaken, isMissed, isPast, uniqueKey };
    }).sort((a, b) => a.itemMinutes - b.itemMinutes);

    // Up Next: First item that is NOT taken AND NOT missed
    // (If it's missed, it stays in timeline with red dot. Up Next moves to future.)
    const nextDose = scheduleWithStatus.find(item => !item.isTaken && !item.isMissed);

    return (
      <div className="space-y-8 p-6 animate-fade-in">
        <div className="flex justify-between items-center pb-4 border-b border-slate-100 dark:border-slate-700">
          <h2 className="text-2xl font-bold text-text-main dark:text-white flex items-center">
            <Bell size={28} className="mr-3 text-primary" />
            Medication Reminders
          </h2>
          <button
            onClick={() => {
              if (isAdding) {
                // closing
                setIsAdding(false);
                setEditingMedId(null);
                setNewMedication({ name: '', dose: '', times: ['08:00'], days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] });
                setPrescriptionImage(null);
              } else {
                // opening fresh add form
                setIsAdding(true);
                setEditingMedId(null);
                setNewMedication({ name: '', dose: '', times: ['08:00'], days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] });
                setPrescriptionImage(null);
              }
            }}
            className={`flex items-center px-4 py-2 rounded-xl font-medium transition-all duration-200 ${isAdding ? 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/50' : 'bg-primary text-white shadow-md shadow-primary/20 hover:bg-primary-dark'}`}
          >
            {isAdding ? <X size={18} className="mr-2" /> : <Plus size={18} className="mr-2" />}
            {isAdding ? 'Close Form' : 'Add Medication'}
          </button>
        </div>

        {isAdding && renderMedicationForm()}

        {/* Next Dose Card */}
        {nextDose && (
          <div className="relative overflow-hidden rounded-3xl
                bg-gradient-to-r from-primary to-teal-600
                p-6 text-white
                border border-white/15
                shadow-[0_20px_50px_rgba(0,0,0,0.7)]
                backdrop-blur-2xl
                animate-slide-up">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-primary-100 font-medium mb-1">Up Next</p>
                <h3 className="text-3xl font-bold">{nextDose.medName}</h3>
                <p className="text-white/80 mt-1 flex items-center">
                  <span className="bg-white/20 px-2 py-0.5 rounded-lg text-sm mr-2">{nextDose.dose}</span>
                  at {formatTimeWithBoth(nextDose.time).time24}
                </p>
              </div>
              <div className="bg-white/20 p-3 rounded-2xl backdrop-blur-sm">
                <Clock size={32} className="text-white" />
              </div>
            </div>
            <div className="mt-6 pt-4 border-t border-white/10 flex justify-between items-center">
              <p className="text-sm font-medium">
                {nextDose.diffMinutes < 0
                  ? `Due now (${Math.abs(nextDose.diffMinutes)}m ago)`
                  : `Due in ${Math.floor(nextDose.diffMinutes / 60)}h ${nextDose.diffMinutes % 60}m`
                }
              </p>
              <button
                onClick={() => handleMarkAsTaken(nextDose)}
                className="px-4 py-2 bg-white text-primary font-bold rounded-xl text-sm hover:bg-slate-50 transition-colors shadow-sm"
              >
                Mark as Taken
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Timeline Column */}
          <div className="lg:col-span-2 space-y-6">
            <div>
              <h3 className="text-lg font-bold flex items-center text-text-main dark:text-white">
                <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center mr-3 text-primary">
                  <Calendar size={18} />
                </div>
                Today's Timeline
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-2 ml-11">(Synced to Google Calendar for 30 days)</p>
            </div>



            {isLoading ? (
              <LoadingSpinner />
            ) : scheduleWithStatus.length === 0 ? (
              <div className="text-center py-12 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                <Bell size={48} className="mx-auto mb-3 text-slate-300" />
                <p className="text-text-muted italic">No medications scheduled for today.</p>
              </div>
            ) : (
              <div className="relative pl-8 space-y-8 before:content-[''] before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[2px] before:bg-slate-200 dark:before:bg-slate-700">
                {scheduleWithStatus.map((item) => {
                  // Visual Logic
                  // Taken: Green dot, opacity normal
                  // Missed: Red dot, opacity normal
                  // Pending: Primary/Gray dot
                  let dotColor = 'bg-primary';
                  if (item.isTaken) dotColor = 'bg-green-500 border-green-500';
                  else if (item.isMissed) dotColor = 'bg-red-500 border-red-500';
                  else if (item.isPast) dotColor = 'bg-slate-300 border-slate-300'; // Past but not missed (e.g. < 15m or handled by logic) - actually logic says >15m is missed. 0-15m is overdue (Primary).

                  return (
                    <div key={item.uniqueKey} className="relative group">
                      {/* Timeline Dot */}
                      <div className={`absolute -left-[39px] top-1/2 -translate-y-1/2 w-6 h-6 rounded-full border-4 border-white dark:border-slate-900 shadow-sm z-10 ${dotColor}`} />

                      <div className={`flex items-center justify-between p-5 rounded-2xl border transition-all duration-200 
                        ${item.isTaken
                          ? 'bg-green-50 dark:bg-green-900/10 border-green-100 dark:border-green-900/30'
                          : item.isMissed
                            ? 'bg-red-50 dark:bg-red-900/10 border-red-100 dark:border-red-900/30'
                            : item.isPast
                              ? 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700'
                              : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 shadow-sm hover:shadow-md hover:border-primary/30'
                        }`}>
                        <div className="flex items-center gap-5">
                          <div className={`text-xl font-mono font-bold ${item.isTaken ? 'text-green-600' : item.isMissed ? 'text-red-500' : item.isPast ? 'text-slate-400' : 'text-primary'}`}>
                            {formatTimeWithBoth(item.time).time24}
                            <div className="text-xs font-normal text-text-muted dark:text-slate-400">({formatTimeWithBoth(item.time).time12})</div>
                          </div>
                          <div>
                            <p className={`text-lg font-bold ${item.isTaken ? 'text-green-700 dark:text-green-400' : item.isMissed ? 'text-red-700 dark:text-red-400' : 'text-text-main dark:text-white'}`}>
                              {item.medName}
                              {item.isTaken && <span className="ml-2 text-xs bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-100 px-2 py-0.5 rounded-full">Taken</span>}
                            </p>
                            <p className="text-sm text-text-muted dark:text-slate-400 flex items-center">
                              <span className={`w-1.5 h-1.5 rounded-full mr-2 ${item.isTaken ? 'bg-green-400' : 'bg-secondary'}`}></span>
                              {item.dose}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {!item.isTaken && item.isMissed && (
                            <button
                              onClick={() => handleMarkAsTaken(item)}
                              className="px-3 py-1.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs font-bold rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                            >
                              Mark as Taken
                            </button>
                          )}

                          <button
                            onClick={() => handleDeleteMedication(item.medId)}
                            className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                            aria-label="Delete medication"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* All Medications Sidebar */}
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-bold text-text-main dark:text-white">All Prescriptions</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">(30-day Google Calendar sync)</p>
            </div>
            {medications.length === 0 ? (
              <p className="text-text-muted italic text-sm">You have no saved medications.</p>
            ) : (
              <div className="space-y-3">
                {medications.map(med => (
                  <div key={med.id} className="p-4 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 hover:border-primary/30 transition-colors group">
                    <div className="flex justify-between items-start mb-2">
                      <p className="font-bold text-text-main dark:text-white">{med.name}</p>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleEditMedication(med)}
                          className="text-slate-300 hover:text-primary transition-colors"
                          aria-label="Edit medication"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteMedication(med.id)}
                          className="text-slate-300 hover:text-red-500 transition-colors"
                          aria-label="Delete medication"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-text-muted dark:text-slate-400 mb-2">{med.dose}</p>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {med.times.map(t => (
                        <span key={t} className="text-[10px] bg-slate-50 dark:bg-slate-700 text-text-muted dark:text-slate-300 px-1.5 py-0.5 rounded border border-slate-100 dark:border-slate-600 font-mono flex flex-col items-center">
                          <span>{formatTimeWithBoth(t).time24}</span>
                          <span className="text-[8px] opacity-70">({formatTimeWithBoth(t).time12})</span>
                        </span>
                      ))}
                    </div>
                    {/* Days display */}
                    <div className="flex flex-wrap gap-1">
                      {(Array.isArray(med.days) && med.days.length > 0 ? med.days : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']).map(day => (
                        <span key={day} className="text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">
                          {day}
                        </span>
                      ))}
                    </div>
                  </div>

                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderActivityTab = () => (
    <div className="p-6 space-y-8 animate-fade-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-100 dark:border-slate-700 pb-4">
        <h2 className="text-2xl font-bold text-text-main dark:text-white flex items-center">
          <Activity
            size={28}
            className="mr-3 text-primary cursor-pointer hover:opacity-80"
            onClick={() =>
              window.open("https://www.youtube.com/shorts/IQcq9lFWO6s", "_blank")
            }
          />
          Activity Dashboard
        </h2>
        <div className="mt-4 md:mt-0 flex space-x-3">
          <button
            onClick={!isSyncingAll ? (() => { setIsAutoSyncActive(true); syncAll(); }) : undefined}
            className={`px-5 py-2.5 bg-primary text-white font-semibold rounded-xl shadow-md shadow-primary/20 transition-all duration-200 flex items-center ${isSyncingAll ? "opacity-70 cursor-wait" : "hover:bg-primary-dark hover:-translate-y-0.5"}`}
          >
            <Activity size={18} className={`mr-2 ${isSyncingAll ? 'animate-spin' : ''}`} />
            {isSyncingAll ? "Syncing..." : "Sync Data"}
          </button>
          <button
            onClick={!isAssessmentLoading ? callAssessmentAPI : undefined}
            className={`px-5 py-2.5 bg-secondary text-white font-semibold rounded-xl shadow-md shadow-secondary/20 transition-all duration-200 flex items-center ${isAssessmentLoading ? "opacity-70 cursor-wait" : "hover:bg-secondary-dark hover:-translate-y-0.5"}`}
            disabled={
              isAssessmentLoading ||
              (stepCount ?? null) === null &&
              (sleepHours ?? null) === null &&
              (calories ?? null) === null &&
              (distance ?? null) === null &&
              (heartRate ?? null) === null
            }
          >
            <MessageSquare size={18} className="mr-2" />
            {isAssessmentLoading ? 'Analyzing...' : 'AI Insight'}
          </button>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Steps Card */}
        <div
          onClick={() => scrollToGraph('steps')}
          className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 hover:shadow-md transition-shadow flex flex-col items-center justify-center relative overflow-hidden group cursor-pointer"
        >
          <div className="absolute top-0 right-0 w-24 h-24 bg-[#0F766E]/5 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110" />
          <button
            onClick={(e) => { e.stopPropagation(); setActiveInfoMetric('steps'); }}
            className="absolute top-4 right-4 z-20 p-2 bg-white/50 dark:bg-black/20 hover:bg-white dark:hover:bg-slate-700 rounded-full backdrop-blur-sm transition-all text-primary/70 hover:text-primary"
          >
            <Info size={18} />
          </button>
          {stepCount !== null ? (
            <>
              <StepCompletionRing steps={stepCount} goal={DAILY_STEP_GOAL} size={160} />
              <div className="mt-2 text-center z-10">
                <p className="text-3xl font-bold text-text-main dark:text-white">{stepCount.toLocaleString()}</p>
                <p className="text-sm text-text-muted dark:text-slate-400 font-medium">Steps Today</p>
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-text-muted">
              <Activity size={48} className="mx-auto mb-3 text-slate-300" />
              <p>No step data</p>
            </div>
          )}
        </div>

        {/* Sleep Card */}
        <div
          onClick={() => scrollToGraph('sleep')}
          className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 hover:shadow-md transition-shadow flex flex-col items-center justify-center relative overflow-hidden group cursor-pointer"
        >
          <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-50 dark:bg-indigo-900/30 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110" />
          <button
            onClick={(e) => { e.stopPropagation(); setActiveInfoMetric('sleep'); }}
            className="absolute top-4 right-4 z-20 p-2 bg-white/50 dark:bg-black/20 hover:bg-white dark:hover:bg-slate-700 rounded-full backdrop-blur-sm transition-all text-indigo-500/70 hover:text-indigo-500"
          >
            <Info size={18} />
          </button>
          {sleepHours !== null ? (
            <>
              <div className={`w-32 h-32 rounded-full flex items-center justify-center border-4 mb-4 ${sleepHours < RECOMMENDED_SLEEP_HOURS ? 'border-secondary/30 bg-secondary/5 dark:bg-secondary/10' : 'border-green-100 dark:border-green-900/50 bg-green-50 dark:bg-green-900/20'}`}>
                <Moon size={32} className={sleepHours < RECOMMENDED_SLEEP_HOURS ? 'text-secondary' : 'text-green-600'} />
              </div>
              <div className="text-center z-10">
                <p className="text-4xl font-bold text-text-main dark:text-white">{sleepHours}<span className="text-xl text-text-muted dark:text-slate-400 ml-1">h</span></p>
                <p className="text-sm text-text-muted dark:text-slate-400 font-medium">Sleep Duration</p>
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-text-muted">
              <Moon size={48} className="mx-auto mb-3 text-slate-300" />
              <p>No sleep data</p>
            </div>
          )}
        </div>

        {/* Calories Card */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 hover:shadow-md transition-shadow flex flex-col items-center justify-center relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-orange-50 dark:bg-orange-900/30 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110" />
          <button
            onClick={(e) => { e.stopPropagation(); setActiveInfoMetric('calories'); }}
            className="absolute top-4 right-4 z-20 p-2 bg-white/50 dark:bg-black/20 hover:bg-white dark:hover:bg-slate-700 rounded-full backdrop-blur-sm transition-all text-orange-500/70 hover:text-orange-500"
          >
            <Info size={18} />
          </button>
          {calories !== null ? (
            <>
              <div className="w-16 h-16 bg-orange-100 dark:bg-orange-900/40 rounded-2xl flex items-center justify-center mb-4 text-orange-600 dark:text-orange-400">
                <Activity size={32} />
              </div>
              <div className="text-center z-10">
                <p className="text-4xl font-bold text-text-main dark:text-white">{calories}</p>
                <p className="text-sm text-text-muted dark:text-slate-400 font-medium">Calories Burned</p>
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-text-muted">
              <p>No calorie data</p>
            </div>
          )}
        </div>


        {/* Hydration Card */}
        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 hover:shadow-md transition-shadow flex flex-col items-center justify-center relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-50 dark:bg-cyan-900/30 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110" />
          <button
            onClick={(e) => { e.stopPropagation(); setActiveInfoMetric('hydration'); }}
            className="absolute top-4 right-4 z-20 p-2 bg-white/50 dark:bg-black/20 hover:bg-white dark:hover:bg-slate-700 rounded-full backdrop-blur-sm transition-all text-cyan-500/70 hover:text-cyan-500"
          >
            <Info size={18} />
          </button>

          <div className="w-16 h-16 bg-cyan-100 dark:bg-cyan-900/40 rounded-2xl flex items-center justify-center mb-4 text-cyan-600 dark:text-cyan-400">
            <Droplet size={32} fill="currentColor" onClick={handleWaterIconClick} />
          </div>

          <div className="text-center z-10 w-full">
            <p className="text-4xl font-bold text-text-main dark:text-white">{hydration}<span className="text-xl text-text-muted dark:text-slate-400 ml-1">ml</span></p>
            <p className="text-sm text-text-muted dark:text-slate-400 font-medium mb-4">Water Intake</p>

            {/* Progress Bar */}
            <div className="w-full bg-slate-100 rounded-full h-2.5 mb-4 overflow-hidden">
              <div
                className="bg-cyan-500 h-2.5 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, (hydration / hydrationGoal) * 100)}%` }}
              ></div>
            </div>

            <div className="flex items-center justify-center gap-3">
              <button
                onClick={(e) => { e.stopPropagation(); updateHydration(-250); }}
                className="p-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                disabled={hydration <= 0}
              >
                <Minus size={18} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); updateHydration(250); }}
                className="flex items-center px-4 py-2 bg-cyan-500 dark:bg-cyan-700/80 text-white rounded-xl font-semibold shadow-md shadow-cyan-200 dark:shadow-cyan-900/20 hover:bg-cyan-600 dark:hover:bg-cyan-600/80 transition-colors"
              >
                <Plus size={16} className="mr-1" /> 250ml
              </button>
            </div>
          </div>
        </div>

        {/* Distance Card */}
        <div
          onClick={() => scrollToGraph('distance')}
          className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 hover:shadow-md transition-shadow flex flex-col items-center justify-center relative overflow-hidden group cursor-pointer"
        >
          <div className="absolute top-0 right-0 w-24 h-24 bg-blue-50 dark:bg-blue-900/30 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110" />

          <button
            onClick={(e) => { e.stopPropagation(); setActiveInfoMetric('distance'); }}
            className="absolute top-4 right-4 z-20 p-2 bg-white/50 dark:bg-black/20 hover:bg-white dark:hover:bg-slate-700 rounded-full backdrop-blur-sm transition-all text-blue-500/70 hover:text-blue-500"
          >
            <Info size={18} />
          </button>

          {distance !== null ? (
            <>
              <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/40 rounded-2xl flex items-center justify-center mb-4 text-blue-600 dark:text-blue-400">
                <Activity size={32} />
              </div>
              <div className="text-center z-10">
                <p className="text-4xl font-bold text-text-main dark:text-white">{distance}<span className="text-xl text-text-muted dark:text-slate-400 ml-1">km</span></p>
                <p className="text-sm text-text-muted dark:text-slate-400 font-medium">Distance</p>
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-text-muted">
              <p>No distance data</p>
            </div>
          )}
        </div>

        {/* Heart Rate Card */}
        <div
          onClick={() => scrollToGraph('heartRate')}
          className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 hover:shadow-md transition-shadow flex flex-col items-center justify-center relative overflow-hidden group cursor-pointer"
        >
          <div className="absolute top-0 right-0 w-24 h-24 bg-red-50 dark:bg-red-900/30 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110" />

          <button
            onClick={(e) => { e.stopPropagation(); setActiveInfoMetric('heartRate'); }}
            className="absolute top-4 right-4 z-20 p-2 bg-white/50 dark:bg-black/20 hover:bg-white dark:hover:bg-slate-700 rounded-full backdrop-blur-sm transition-all text-red-500/70 hover:text-red-500"
          >
            <Info size={18} />
          </button>

          {heartRate !== null ? (
            <>
              <div className="w-16 h-16 bg-red-100 dark:bg-red-900/40 rounded-2xl flex items-center justify-center mb-4 text-red-600 dark:text-red-400 animate-pulse">
                <Heart size={32} fill="currentColor" />
              </div>
              <div className="text-center z-10">
                <p className="text-4xl font-bold text-text-main dark:text-white">{heartRate}<span className="text-xl text-text-muted dark:text-slate-400 ml-1">bpm</span></p>
                <p className="text-sm text-text-muted dark:text-slate-400 font-medium">Heart Rate</p>
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-text-muted">
              <Heart size={48} className="mx-auto mb-3 text-slate-300" />
              <p>No heart rate data</p>
            </div>
          )}
        </div>
      </div>
      {/* Health Score + BMI Row */}
      <div className="grid grid-cols-1 xl:grid-cols-[2fr,1.2fr] gap-6 items-stretch">
        {/* Health Score Card (left) */}
        <div className="bg-white dark:bg-slate-800 p-10 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 hover:shadow-md transition-shadow w-full flex justify-center">
          {/* CENTERED ROW WRAPPER */}
          <div className="flex flex-row items-center justify-center gap-16 max-w-3xl w-full">
            {/* LEFT — RING */}
            <div className="flex-shrink-0">
              <HealthScoreRing score={healthScore ?? 0} />
            </div>

            {/* RIGHT — TEXT */}
            <div className="flex flex-col space-y-6 text-left">
              {/* WHY THIS SCORE */}
              {healthScoreExplanation.length > 0 && (
                <div>
                  <p className="font-semibold text-text-main dark:text-white text-lg mb-2">Why this score:</p>
                  <ul className="space-y-1 text-text-muted dark:text-slate-400 text-sm">
                    {healthScoreExplanation.map((line, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-lg">•</span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* HOW TO IMPROVE */}
              {healthScoreSuggestions.length > 0 && (
                <div>
                  <p className="font-semibold text-text-main dark:text-white text-lg mb-2">How to improve:</p>
                  <ul className="space-y-1 text-text-muted dark:text-slate-400 text-sm">
                    {healthScoreSuggestions.map((line, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-lg">•</span>
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* BMI Card (right) */}
        <div className="bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col items-center justify-center px-6 py-8">
          <h3 className="text-lg font-semibold text-text-main dark:text-slate-100 mb-4 self-start">
            BMI Overview
          </h3>

          {bmi ? (
            <>
              <BMIGauge bmi={bmi} theme={theme} colorBlindMode={colorBlindMode} />
              <p className="mt-1 text-[11px] text-slate-400 text-center">
                BMI is estimated from the height and weight in your profile.
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-300 text-center">
              Add your height and weight in the Profile section to see your BMI gauge here.
            </p>
          )}
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-8">
        <div ref={heartRateRef} className={`bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 ${highlightedGraph === 'heartRate' ? 'glow-red' : ''}`}>
          <h3 className="text-lg font-bold text-text-main dark:text-white mb-6 flex items-center">
            <Heart size={25} className="mr-2 text-secondary" /> Heart Rate Trend
          </h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={heartRateTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="time" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#fff',
                  borderRadius: '12px',
                  border: 'none',
                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                }}
                labelStyle={{ color: 'black' }}       // <-- TOP TEXT (time)
                itemStyle={{ color: '#0F766E' }}      // <-- bpm:72 stays green
              />
              <Line type="monotone" dataKey="bpm" stroke="#FB7185" strokeWidth={3} dot={{ r: 4, fill: '#FB7185', strokeWidth: 0 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div ref={stepsRef} className={`bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 ${highlightedGraph === 'steps' ? 'glow-teal' : ''}`}>
          <h3 className="text-lg font-bold text-text-main dark:text-white mb-6 flex items-center">
            <Footprints
              size={25}
              color="#0F766E"
              className="mr-2 text-secondary cursor-pointer hover:opacity-80"
              onClick={() => {
                setStepsIconClicks(prev => {
                  const next = prev + 1;

                  if (next === 7) {
                    window.open("https://www.youtube.com/shorts/W6oQUDFV2C0", "_blank");
                    return 0; // reset after trigger
                  }

                  return next;
                });
              }}
            />
            Steps Trend
          </h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={steps3hTrend}>

              <defs>
                <linearGradient id="stepsGradientFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0F766E" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#0F766E" stopOpacity={0} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" stroke="#a1a3a4ff" />

              <XAxis dataKey="time" stroke="#94a3b8" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis stroke="#94a3b8" tickLine={false} axisLine={false} fontSize={12} />

              <Tooltip
                formatter={(value, name) => {
                  if (name === "steps") return [`${value} steps`, "Steps"];
                  return null;
                }}
                contentStyle={{
                  backgroundColor: "#fff",
                  borderRadius: "12px",
                  border: "1px solid #e5e7eb",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.06)"
                }}
                labelStyle={{
                  color: "black",        // <-- top text (time)
                  fontWeight: 600
                }}
                itemStyle={{
                  color: "#0F766E"       // <-- lower text (Steps: ####)
                }}
              />

              {/* MAIN LINE */}
              <Line
                type="monotone"
                dataKey="steps"
                stroke="#0F766E"
                strokeWidth={4}
                dot={false}
              />

              {/* GRADIENT FILL UNDER LINE */}
              <Area
                type="monotone"
                dataKey="stepsArea"
                stroke="none"
                fill="url(#stepsGradientFill)"
                fillOpacity={1}
              />

            </LineChart>
          </ResponsiveContainer>

        </div>
        <div ref={distanceRef} className={`relative bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 
                hover:shadow-md transition-shadow overflow-hidden ${highlightedGraph === 'distance' ? 'glow-blue' : ''}`}>

          <h3 className="text-lg font-bold text-text-main dark:text-white mb-6 flex items-center">
            <Ruler size={25} color='#14b8a6' className="mr-2 text-secondary" />Distance Trend
          </h3>

          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={weeklyDistance}
              barSize={36}
              margin={{ top: 20, right: 10, left: -10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />

              <XAxis
                dataKey="day"
                tick={{ fill: "#64748b", fontSize: 12, fontWeight: 500 }}
                axisLine={false}
                tickLine={false}
              />

              <YAxis
                tick={{ fill: "#94a3b8", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                unit=" km"
              />

              <Tooltip
                cursor={{ fill: "rgba(20,184,166,0.08)" }}
                contentStyle={{
                  backgroundColor: "#ffffff",
                  borderRadius: "12px",
                  border: "1px solid #e5e7eb",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.06)"
                }}
                labelStyle={{ fontWeight: 600, color: "#000000" }}
                formatter={(value) => [`${value} km`, "Distance"]}
              />

              <Bar
                dataKey="km"
                radius={[10, 10, 0, 0]}
                fill="#14b8a6"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div ref={sleepRef} className={`bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 ${highlightedGraph === 'sleep' ? 'glow-indigo' : ''}`}>
          <h3 className="text-lg font-bold text-text-main dark:text-white mb-6 flex items-center">
            <Moon size={25} color="#6366F1" className="mr-2 text-secondary" />Sleep Trend</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={sleepTrend}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fill: "#64748b", fontSize: 12, fontWeight: 500 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[0, 12]}
                ticks={[0, 3, 6, 9, 12]}
                tick={{ fill: "#94a3b8", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                unit=" hrs"
                stroke="#E2E8F0" />
              <Tooltip
                cursor={{ fill: "rgba(20,184,166,0.08)" }}
                contentStyle={{
                  backgroundColor: "#ffffff",
                  borderRadius: "12px",
                  border: "1px solid #e5e7eb",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.06)"
                }}
                labelStyle={{ fontWeight: 600, color: "#000000" }}
                formatter={(value) => [`${value} hrs`, "Sleep"]}
              />
              <Bar
                dataKey="hours"
                radius={[10, 10, 0, 0]}
                fill="#6366F1"
                barSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* AI Assessment Report */}
      {
        (isAssessmentLoading || assessmentResult) && (
          <div className="mt-8 bg-white dark:bg-slate-800 p-8 rounded-3xl shadow-lg border border-slate-100 dark:border-slate-700 animate-slide-up">
            <h3 className="text-2xl font-bold flex items-center mb-6 text-text-main">
              <div className="w-10 h-10 bg-secondary/10 rounded-xl flex items-center justify-center mr-3">
                <MessageSquare size={20} className="text-secondary" />
              </div>
              Wellness Analysis
            </h3>

            {isAssessmentLoading && (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="w-12 h-12 border-4 border-slate-200 border-t-secondary rounded-full animate-spin mb-4" />
                <p className="text-text-muted animate-pulse">Generating insights...</p>
              </div>
            )}

            {assessmentResult && !isAssessmentLoading && (
              <div className="space-y-6">
                <div className="prose prose-slate max-w-none"
                  dangerouslySetInnerHTML={{
                    __html: assessmentResult.text
                      .replace(/^### (.*$)/gim, '<h3 class="text-xl font-bold text-primary mt-6 mb-3">$1</h3>')
                      .replace(/^## (.*$)/gim, '<h2 class="text-2xl font-bold text-text-main mt-8 mb-4">$1</h2>')
                      .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-text-main">$1</strong>')
                      .replace(/^\s*[-•]\s+(.*)$/gim, '<li class="ml-4 mb-2 text-text-muted list-disc">$1</li>')
                      .replace(/\n/g, '<br/>')
                  }}
                />

                {assessmentResult.sources && assessmentResult.sources.length > 0 && (
                  <div className="mt-6 pt-6 border-t border-slate-100">
                    <p className="font-semibold text-sm text-text-muted mb-3 uppercase tracking-wider">Sources</p>
                    <div className="flex flex-wrap gap-2">
                      {assessmentResult.sources.map((source, idx) => (
                        <a key={idx} href={source.uri} target="_blank" rel="noopener noreferrer"
                          className="flex items-center px-3 py-1.5 bg-slate-50 rounded-lg text-xs text-primary hover:bg-primary/5 hover:underline transition-colors border border-slate-100">
                          <Link size={12} className="mr-1.5" />
                          <span className="max-w-[200px] truncate">{source.title}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      }
    </div >
  );


  const renderChatbotTab = () => {
    // Read the last clear timestamp from localStorage
    const clearedAtKey = userId ? `chatClearedAt_${userId}` : null;
    const clearedAt = clearedAtKey ? Number(localStorage.getItem(clearedAtKey) || 0) : 0;

    const rawMessages = Array.isArray(chatHistory) ? chatHistory : [];

    // Only show messages created AFTER the last clear time
    let visibleMessages = rawMessages.filter(msg => {
      // If createdAt is missing (e.g., INITIAL_CHAT_WELCOME), always show it
      if (!msg.createdAt) return true;
      return msg.createdAt > clearedAt;
    });

    // If nothing is visible, fall back to the welcome message
    if (visibleMessages.length === 0) {
      visibleMessages = [INITIAL_CHAT_WELCOME];
    }

    return (
      <div className="flex flex-col h-full p-6 animate-fade-in relative overflow-hidden">
        {/* Voice Mode Overlay */}
        {isVoiceMode && (
          <div className="absolute inset-0 z-50 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md flex flex-col items-center justify-center p-8 rounded-3xl animate-fade-in">
            <div className="relative mb-8">
              <div className={`w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500 ${isSpeaking ? 'bg-primary/20 scale-110' : isListening ? 'bg-red-500/10 scale-100' : 'bg-slate-100 dark:bg-slate-800'}`}>
                <div className={`w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 ${isSpeaking ? 'bg-primary text-white shadow-lg shadow-primary/30' : isListening ? 'bg-red-500 text-white shadow-lg shadow-red-500/30 animate-pulse' : 'bg-slate-200 dark:bg-slate-700 text-slate-400'}`}>
                  {isSpeaking ? <Volume2 size={48} /> : isListening ? <Mic size={48} /> : <MicOff size={48} />}
                </div>
              </div>
              {/* Ripple effects */}
              {isListening && (
                <>
                  <div className="absolute inset-0 rounded-full border-4 border-red-500/30 animate-ping" style={{ animationDuration: '2s' }} />
                  <div className="absolute inset-0 rounded-full border-4 border-red-500/20 animate-ping" style={{ animationDuration: '2s', animationDelay: '0.5s' }} />
                </>
              )}
            </div>

            <h3 className="text-2xl font-bold text-text-main dark:text-white mb-2">
              {isSpeaking ? "Speaking..." : isListening ? "Listening..." : "Processing..."}
            </h3>
            <p className="text-text-muted dark:text-slate-400 text-center max-w-md mb-8">
              {isSpeaking ? "The AI is responding to you." : isListening ? "Go ahead, I'm listening." : "Please wait a moment."}
            </p>

            <div className="flex gap-3">
              <button
                onClick={resetVoiceMode}
                className="px-6 py-3 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-text-main dark:text-white rounded-xl font-semibold transition-colors flex items-center gap-2 border border-slate-200 dark:border-slate-600 shadow-sm"
              >
                <RefreshCw size={20} /> Reset
              </button>
              <button
                onClick={stopVoiceMode}
                className="px-8 py-3 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-text-main dark:text-white rounded-xl font-semibold transition-colors flex items-center gap-2"
              >
                <X size={20} /> Exit Voice Mode
              </button>
            </div>
          </div>
        )}

        <div className="flex justify-between items-center pb-4 border-b border-slate-100 dark:border-slate-700 mb-4">
          {/* Left: Title + Voice/Language controls */}
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-text-main dark:text-white flex items-center">
              <MessageSquare size={28} className="mr-3 text-primary" />
              Health Chatbot
            </h2>

            {/* Voice Controls */}
            <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
              {/* Voice Mode Toggle */}
              <button
                onClick={isVoiceMode ? stopVoiceMode : startVoiceMode}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-all text-xs font-semibold ${isVoiceMode
                  ? 'bg-red-500 text-white shadow-sm animate-pulse'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700'
                  }`}
                title={isVoiceMode ? "Exit Voice Mode" : "Start Voice Conversation"}
              >
                {isVoiceMode ? <MicOff size={14} /> : <Mic size={14} />}
                {isVoiceMode ? "Exit Voice" : "Voice Mode"}
              </button>

              <div className="h-4 w-[1px] bg-slate-300 dark:bg-slate-600 mx-1"></div>

              {/* Mute / TTS toggle */}
              <button
                onClick={() => {
                  setSpeechEnabled(!speechEnabled);
                  if (speechEnabled) stopSpeaking();
                }}
                className={`p-1.5 rounded-md transition-all ${speechEnabled
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                  }`}
                title={speechEnabled ? "Disable Text-to-Speech" : "Enable Text-to-Speech"}
              >
                {speechEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
              </button>

              <div className="h-4 w-[1px] bg-slate-300 dark:bg-slate-600 mx-1"></div>

              {/* Language selector */}
              <div className="relative group">
                <button className="flex items-center gap-1 p-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 rounded-md transition-colors">
                  <Globe size={14} />
                  {LANGUAGES.find(l => l.code === selectedLanguage)?.code
                    .split('-')[0]
                    .toUpperCase()}
                </button>

                {/* Language Dropdown */}
                <div className="absolute top-full right-0 mt-1 w-40 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-100 dark:border-slate-700 overflow-hidden z-50 hidden group-hover:block">
                  {LANGUAGES.map(lang => (
                    <button
                      key={lang.code}
                      onClick={() => setSelectedLanguage(lang.code)}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors ${selectedLanguage === lang.code
                        ? 'text-primary font-bold bg-primary/5'
                        : 'text-slate-600 dark:text-slate-300'
                        }`}
                    >
                      {lang.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Right: Clear button */}
          <button
            onClick={handleClearChat}
            className="ml-auto text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors flex items-center border border-red-100"
            title="Clear Chat History"
          >
            <Trash2 size={14} className="mr-1" /> Clear
          </button>
        </div>

        <div
          ref={chatContainerRef}
          className="flex-grow overflow-y-auto space-y-6 pr-2 mb-4 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent min-h-0 animate-fade-in"
        >
          {/* Messages */}
         {visibleMessages.map((msg, index) => {
  const prevMsg = visibleMessages[index - 1];
  
  // Logic for Time Separator (> 5 mins gap)
  const showTimeSeparator = !prevMsg || 
    (msg.createdAt && prevMsg.createdAt && msg.createdAt - prevMsg.createdAt > 5 * 60 * 1000);

  // Logic for Grouping (Same sender as previous)
  const isConsecutive = prevMsg && prevMsg.role === msg.role && !showTimeSeparator;

  return (
    <React.Fragment key={index}>
      {/* TIME SEPARATOR */}
      {showTimeSeparator && (
        <div className="my-6 flex justify-center animate-fade-in">
          <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800/60 px-3 py-1 rounded-full border border-slate-200 dark:border-slate-700">
             {formatTimeSeparator(msg.createdAt)}
          </span>
        </div>
      )}

      <div
        className={`flex animate-slide-up ${msg.role === "user" ? "justify-end" : "justify-start"} ${isConsecutive ? 'mt-1' : 'mt-4'}`}
      >
        <div
          className={`flex max-w-[85%] ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
        >
          {/* Avatar: Hidden if consecutive */}
          <div
            className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-1 shadow-theme ${msg.role === "user"
              ? "bg-primary text-white ml-3"
              : "bg-secondary/10 text-secondary mr-3"
              } ${isConsecutive ? 'opacity-0' : 'opacity-100'}`}
          >
            {!isConsecutive && (msg.role === "user" ? (
              <Activity size={16} />
            ) : (
              <MessageSquare size={16} />
            ))}
          </div>

          {/* Bubble */}
          <div
            className={`p-4 rounded-2xl shadow-theme-lg text-[15px] leading-relaxed ${msg.role === "user"
              ? `bg-primary text-white ${isConsecutive ? 'rounded-tr-2xl' : 'rounded-tr-none'}`
              : `bg-surface dark:bg-slate-800 text-text-main dark:text-slate-100 border border-border ${isConsecutive ? 'rounded-tl-2xl' : 'rounded-tl-none'}`
              }`}
          >
            {/* ... Keep the existing inner logic for parseAssistantResponse and standard rendering exactly as it was ... */}
            {(() => {
              const sections = msg.role !== 'user' ? parseAssistantResponse(msg.text) : {};
              const hasStructuredData = sections.ANSWER || sections["WHAT YOU CAN DO"] || sections["WHEN TO SEE A DOCTOR"];

              if (msg.role !== 'user' && hasStructuredData) {
                return (
                  <div className="space-y-4 w-full">
                    {sections.ANSWER && (
                      <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-xl border-l-4 border-primary">
                        <p className="font-bold text-primary mb-2 flex items-center gap-2">
                          <Info size={16} /> What this means
                        </p>
                        <div className="text-text-main dark:text-slate-200">{sections.ANSWER}</div>
                      </div>
                    )}
                    {sections["WHAT YOU CAN DO"] && (
                      <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-100 dark:border-emerald-900/30">
                        <p className="font-bold text-emerald-700 dark:text-emerald-400 mb-2 flex items-center gap-2">
                          <CheckCircle size={16} /> What you can do
                        </p>
                        <ul className="list-disc pl-5 space-y-1 text-text-main dark:text-slate-200">
                          {sections["WHAT YOU CAN DO"].split("\n").map((line, i) => {
                            const cleanLine = line.replace(/^[-•*]\s*/, "").trim();
                            return cleanLine ? <li key={i}>{cleanLine}</li> : null;
                          })}
                        </ul>
                      </div>
                    )}
                    {sections["WHEN TO SEE A DOCTOR"] && (
                      <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-100 dark:border-red-900/30">
                        <p className="font-bold text-red-700 dark:text-red-400 mb-2 flex items-center gap-2">
                          <AlertCircle size={16} /> When to see a doctor
                        </p>
                        <ul className="list-disc pl-5 space-y-1 text-text-main dark:text-slate-200">
                          {sections["WHEN TO SEE A DOCTOR"].split("\n").map((line, i) => {
                            const cleanLine = line.replace(/^[-•*]\s*/, "").trim();
                            return cleanLine ? <li key={i}>{cleanLine}</li> : null;
                          })}
                        </ul>
                      </div>
                    )}
                    {sections.DISCLAIMER && (
                       <p className="text-xs text-text-muted italic mt-2 border-t pt-2 border-slate-100 dark:border-slate-700">
                         {sections.DISCLAIMER}
                       </p>
                    )}
                    {Array.isArray(msg.sources) && msg.sources.length > 0 && (
                      <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700/40">
                        <p className="text-xs font-semibold text-text-muted dark:text-slate-400 mb-2 flex items-center gap-2">
                          <Link size={14} />
                          Sources
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {msg.sources.map((src, i) => (
                            <a
                              key={i}
                              href={src}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-600 text-xs text-primary transition shadow-sm"
                            >
                              Source {i + 1}
                              <ExternalLink size={12} />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              } else {
                return (
                  <div
                    className="whitespace-pre-wrap prose prose-sm dark:prose-invert max-w-none"
                    dangerouslySetInnerHTML={{
                      __html: (() => {
                        let html = msg.text || "";
                        html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
                        html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
                        let listCounter = 0;
                        html = html.replace(/^[\s]*[-•*]\s+(.*)$/gm, (match, content) => {
                          listCounter++;
                          return `<span class="font-semibold text-primary">${listCounter}.</span> ${content}`;
                        });
                        return html;
                      })(),
                    }}
                  />
                );
              }
            })()}
          </div>
        </div>
      </div>
    </React.Fragment>
  );
})}


          {isChatLoading && <ThinkingBubble stage={thinkingStage} />}
        </div>


        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = chatInput.trim();

            // Don't send empty message with no image
            if (!trimmed && !attachedImage) return;

            // Capture current values before clearing state
            const messageToSend = trimmed || (attachedImage ? "Please help me understand this photo." : "");
            const imageFile = attachedImage || null;

            // Clear UI fields
            setChatInput('');
            setAttachedImage(null);

            if (imageFile) {
              const reader = new FileReader();
              reader.onloadend = () => {
                const base64 = reader.result.split(',')[1];
                const imageInlineData = {
                  data: base64,
                  mimeType: imageFile.type || "image/jpeg",
                  file: imageFile // 👈 We attach the raw file object here
                };
                callChatbotAPI(messageToSend, imageInlineData);
              };
              reader.readAsDataURL(imageFile);
            } else {
              callChatbotAPI(messageToSend, null);
            }
          }}
          className="relative mt-2"
        >
          {/* Attached image preview */}
          {attachedImage && (
            <div className="flex items-center gap-3 mb-2 px-2">
              <div className="relative w-16 h-16 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
                <img
                  src={URL.createObjectURL(attachedImage)}
                  alt="Attached preview"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex-1 text-xs text-text-muted dark:text-slate-400">
                <div className="font-semibold text-text-main dark:text-slate-100 mb-0.5">
                  {attachedImage.name}
                </div>
                <div>
                  Image attached. You can also type extra details before sending.
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAttachedImage(null);
                  if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                  }
                }}
                className="text-xs px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                Remove
              </button>
            </div>
          )}

          <div className="relative w-full">
            {/* Mic Button - Left */}
            <button
              type="button"
              onClick={toggleListening}
              className={`absolute left-2 top-2 bottom-2 w-10 flex items-center justify-center rounded-xl transition-all duration-200 ${isListening
                ? 'bg-red-500 text-white animate-pulse shadow-md'
                : 'text-slate-400 hover:text-primary hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              title={isListening ? "Stop Listening" : "Start Voice Input"}
            >
              {isListening ? <MicOff size={20} /> : <Mic size={20} />}
            </button>

            {/* Hidden file input */}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              ref={fileInputRef}
              className="hidden"
              onChange={handleFileChange}
            />

            {/* Hidden file input for camera */}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              ref={cameraInputRef}
              className="hidden"
              onChange={handleFileChange}
            />

            {/* Text input */}
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={
                isListening
                  ? "Listening..."
                  : "Ask a health question or upload a photo"
              }
              className={`w-full p-4 pl-14 pr-32 border rounded-2xl placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-sm ${isListening
                ? 'border-red-300 bg-red-50/50 dark:bg-red-900/20'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
                }`}
            />

            {/* Right-side buttons (attach + send) */}
            <div className="absolute right-2 top-2 bottom-2 flex items-center gap-2">
              {/* Attach image button */}
              <button
                type="button"
                onClick={() => setShowAttachMenu(prev => !prev)} // NEW: toggle menu
                className="w-10 h-10 flex items-center justify-center rounded-xl text-slate-400 hover:text-primary hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                title="Upload/Take photo"
              >
                <Paperclip size={18} />
              </button>

              {showAttachMenu && (
                <div className="absolute right-12 top-0 mt-1 w-44 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 z-50 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAttachMenu(false);
                      if (fileInputRef.current) fileInputRef.current.click(); // open file browser
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-t-xl"
                  >
                    Upload from computer
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAttachMenu(false);
                      setIsCameraModalOpen(true);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-b-xl border-t border-slate-100 dark:border-slate-700"
                  >
                    Take a photo
                  </button>
                </div>
              )}


              {/* Send button */}
              <button
                type="submit"
                disabled={(!chatInput.trim() && !attachedImage) || isChatLoading}
                className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-200 ${(!chatInput.trim() && !attachedImage) || isChatLoading
                  ? 'bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed'
                  : 'bg-primary text-white shadow-md hover:shadow-lg hover:-translate-y-0.5'
                  }`}
              >
                {isChatLoading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Send size={18} />
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    );
  };

  // ===================== HEALTH PLAN TAB ================================

  // --- CALENDAR API & WIDGET ---
  const fetchCalendarEvents = async (year, month) => {
    if (!googleAccessToken) return;

    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59);

    const timeMin = startOfMonth.toISOString();
    const timeMax = endOfMonth.toISOString();

    try {
      const response = await exponentialBackoffFetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true`,
        {
          headers: {
            Authorization: `Bearer ${googleAccessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.ok) {
        const data = await response.json();

        const medSet = new Set();          // 💊
        const engagementSet = new Set();   // generic events
        const appointmentSet = new Set();  // doctor visits / full body checkups

        if (Array.isArray(data.items)) {
          data.items.forEach((event) => {
            const start = event.start?.dateTime || event.start?.date;
            if (!start) return;

            const dateStr = start.substring(0, 10); // YYYY-MM-DD
            const summary = (event.summary || '').trim();

            const isMedicationEvent = summary.startsWith('💊 ');
            const isQuarterlyAppt = summary.includes('Doctor Visit');
            const isYearlyAppt = summary.includes('Full Body Checkup');

            if (isMedicationEvent) {
              medSet.add(dateStr);
            } else if (isQuarterlyAppt || isYearlyAppt) {
              appointmentSet.add(dateStr);
            } else {
              engagementSet.add(dateStr);
            }
          });
        }

        setCalendarMedDays(medSet);
        setCalendarEngagementDays(engagementSet);
        setCalendarAppointmentDays(appointmentSet);
      }
    } catch (e) {
      console.error('Error fetching calendar events:', e);
    }
  };

  // Fetch events when month changes or tab opens
  useEffect(() => {
    if (activeTab === 'health_plan' && googleAccessToken) {
      fetchCalendarEvents(currentCalendarMonth.getFullYear(), currentCalendarMonth.getMonth());
    }
  }, [activeTab, googleAccessToken, currentCalendarMonth]);

  const SimpleCalendar = ({ selectedDate, onSelect }) => {
    const year = currentCalendarMonth.getFullYear();
    const month = currentCalendarMonth.getMonth();

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0 = Sunday

    const days = [];
    for (let i = 0; i < firstDayOfMonth; i++) {
      days.push(<div key={`empty-${i}`} className="h-8 w-8" />);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

      const hasMed = calendarMedDays.has(dateStr);             // red dot
      const hasEngagement = calendarEngagementDays.has(dateStr); // yellow dot
      const hasAppointment = calendarAppointmentDays.has(dateStr); // circle day
      const isSelected = selectedDate === dateStr;
      const isToday = dateStr === getTodayDateKey();

      const isAppointmentDay = hasAppointment;

      days.push(
        <button
          key={d}
          onClick={() => onSelect(dateStr)}
          className={`h-8 w-8 rounded-full flex items-center justify-center text-xs relative transition-all
            ${isAppointmentDay
              // Doctor's appointment → encircled
              ? 'border-2 border-purple-500 text-purple-600 font-bold bg-white dark:bg-slate-900 shadow-md'
              : isSelected
                // Plain selection highlight (when choosing before booking)
                ? 'bg-primary text-white font-bold shadow-md'
                : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-text-main dark:text-slate-200'
            }
            ${isToday && !isAppointmentDay && !isSelected ? 'border border-primary text-primary font-bold' : ''}
          `}
        >
          {d}

          {/* Dots: red for meds; yellow for other engagements.
              DO NOT show yellow on appointment days (you only see the circle there). */}
          {(hasMed || (hasEngagement && !hasAppointment)) && (
            <div className="absolute bottom-1 inset-x-0 flex items-center justify-center gap-0.5">
              {hasMed && <span className="w-1.5 h-1.5 rounded-full bg-red-500" />}
              {hasEngagement && !hasAppointment && (
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
              )}
            </div>
          )}
        </button>
      );
    }

    const prevMonth = () => setCurrentCalendarMonth(new Date(year, month - 1, 1));
    const nextMonth = () => setCurrentCalendarMonth(new Date(year, month + 1, 1));

    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 w-full max-w-xs mx-auto">
        <div className="flex justify-between items-center mb-4">
          <button onClick={prevMonth} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full"><ChevronRight className="rotate-180" size={16} /></button>
          <span className="font-bold text-sm text-text-main dark:text-white">
            {currentCalendarMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
          </span>
          <button onClick={nextMonth} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full"><ChevronRight size={16} /></button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center mb-2">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => <span key={d} className="text-[10px] font-bold text-text-muted">{d}</span>)}
        </div>
        <div className="grid grid-cols-7 gap-1 place-items-center">
          {days}
        </div>
      </div>
    );
  };

  const handleSaveHealthData = async () => {
    if (!db || !userId) return;
    setIsSavingHealthData(true);
    try {
      const currentWeek = getWeekNumber(new Date());
      const weekDocRef = doc(db, `/artifacts/${appId}/users/${userId}/health_plan/week_${currentWeek}`);
      await setDoc(weekDocRef, {
        bp: weeklyBP,
        sugar: weeklySugar,
        spo2: weeklySpo2, // Added SpO2
        updatedAt: Date.now()
      }, { merge: true });

      // Clear fields on save
      setWeeklyBP({ systolic: '', diastolic: '' });
      setWeeklySugar('');
      setWeeklySpo2('');

      alert("Health data saved successfully!");
    } catch (e) {
      console.error("Error saving health data:", e);
      alert("Failed to save data.");
    } finally {
      setIsSavingHealthData(false);
    }
  };

  const renderHealthPlanTab = () => {
    const daysRemainingInWeek = 7 - new Date().getDay();

    // Daily Progress Calculation
    const stepsLeft = Math.max(0, DAILY_STEP_GOAL - (stepCount || 0));
    const waterLeft = Math.max(0, hydrationGoal - hydration);

    return (
      <div className="p-6 space-y-8 animate-fade-in h-full overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-text-main dark:text-white flex items-center">
              <Calendar size={28} className="mr-3 text-primary" />
              My Health Plan
            </h2>
            <p className="text-text-muted dark:text-slate-400">
              Stay on top of your health with structured reminders.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-20">
          {/* 1. DAILY SECTION */}
          <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm relative overflow-hidden group hover:shadow-md transition-all">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <Activity size={80} className="text-blue-500" />
            </div>
            <h3 className="text-lg font-bold text-blue-600 dark:text-blue-400 mb-4 flex items-center uppercase tracking-wider">
              <Clock size={20} className="mr-2" /> Daily
            </h3>
            <div className="space-y-4">
              {/* Walk Card */}
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-100 dark:border-blue-800/50">
                <div className="flex items-center mb-2">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-800 rounded-full flex items-center justify-center mr-3 text-blue-600 dark:text-blue-300">
                    <Footprints size={20} />
                  </div>
                  <div>
                    <p className="font-bold text-text-main dark:text-white">Walk 10,000 Steps</p>
                    <p className="text-xs text-text-muted dark:text-slate-400">Reminder every 1.5 hours</p>
                  </div>
                </div>
                <div className="mt-2">
                  <p className="text-sm font-semibold text-blue-600 dark:text-blue-400 mb-1">
                    {stepsLeft > 0 ? `${stepsLeft.toLocaleString()} steps left!` : "Goal Reached! 🎉"}
                  </p>
                  <div className="w-full bg-blue-200 dark:bg-blue-900 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-blue-500 h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, ((stepCount || 0) / DAILY_STEP_GOAL) * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1 italic">
                    {stepsLeft > 5000 ? "Keep moving, you got this!" : stepsLeft > 0 ? "Almost there, keep walking!" : "Great job today!"}
                  </p>
                </div>
              </div>

              {/* Water Card */}
              <div className="p-4 bg-cyan-50 dark:bg-cyan-900/20 rounded-2xl border border-cyan-100 dark:border-cyan-800/50">
                <div className="flex items-center mb-2">
                  <div className="w-10 h-10 bg-cyan-100 dark:bg-cyan-800 rounded-full flex items-center justify-center mr-3 text-cyan-600 dark:text-cyan-300">
                    <Droplet size={20} />
                  </div>
                  <div>
                    <p className="font-bold text-text-main dark:text-white">Drink 3L Water</p>
                    <p className="text-xs text-text-muted dark:text-slate-400">Reminder every 1.5 hours</p>
                  </div>
                </div>
                <div className="mt-2">
                  <p className="text-sm font-semibold text-cyan-600 dark:text-cyan-400 mb-1">
                    {waterLeft > 0 ? `${waterLeft}ml left to drink` : "Hydration Goal Met! 💧"}
                  </p>
                  <div className="w-full bg-cyan-200 dark:bg-cyan-900 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-cyan-500 h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, (hydration / hydrationGoal) * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1 italic">
                    {waterLeft > 1000 ? "Stay hydrated for energy!" : waterLeft > 0 ? "Just a few more glasses!" : "Well done!"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 2. WEEKLY SECTION */}
          <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm relative overflow-hidden group hover:shadow-md transition-all">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <Calendar size={80} className="text-purple-500" />
            </div>
            <div className="flex items-center gap-3 mb-4">
              <h3 className="text-lg font-bold text-purple-600 dark:text-purple-400 flex items-center uppercase tracking-wider">
                <Calendar size={20} className="mr-2" /> Weekly
              </h3>

              <span className="px-3 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 text-xs font-bold rounded-full">
                {daysRemainingInWeek} Days Left
              </span>
            </div>
            <div className="space-y-4">
              <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-2xl border border-purple-100 dark:border-purple-800/50">
                <div className="flex items-center mb-3">
                  <Heart size={20} className="text-purple-500 mr-2" />
                  <span className="font-semibold text-text-main dark:text-white">Blood Pressure</span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder="Sys"
                    value={weeklyBP.systolic}
                    onChange={(e) => setWeeklyBP({ ...weeklyBP, systolic: e.target.value })}
                    className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"
                  />
                  <span className="self-center text-slate-400">/</span>
                  <input
                    type="number"
                    placeholder="Dia"
                    value={weeklyBP.diastolic}
                    onChange={(e) => setWeeklyBP({ ...weeklyBP, diastolic: e.target.value })}
                    className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
              </div>

              <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-2xl border border-purple-100 dark:border-purple-800/50">
                <div className="flex items-center mb-3">
                  <Activity size={20} className="text-purple-500 mr-2" />
                  <span className="font-semibold text-text-main dark:text-white">Blood Sugar</span>
                </div>
                <input
                  type="number"
                  placeholder="mg/dL"
                  value={weeklySugar}
                  onChange={(e) => setWeeklySugar(e.target.value)}
                  className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"
                />
              </div>

              {/* SpO2 Field */}
              <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-2xl border border-purple-100 dark:border-purple-800/50">
                <div className="flex items-center mb-3">
                  <Activity size={20} className="text-purple-500 mr-2" />
                  <span className="font-semibold text-text-main dark:text-white">SpO2</span>
                </div>
                <input
                  type="number"
                  placeholder="%"
                  value={weeklySpo2}
                  onChange={(e) => setWeeklySpo2(e.target.value)}
                  className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"
                />
              </div>

              <button
                onClick={handleSaveHealthData}
                disabled={isSavingHealthData}
                className="w-full py-3 bg-purple-600 text-white rounded-xl font-bold shadow-lg shadow-purple-200 dark:shadow-purple-900/20 hover:bg-purple-700 transition-all flex items-center justify-center"
              >
                {isSavingHealthData ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" /> : <Save size={18} className="mr-2" />}
                Save Weekly Data
              </button>
            </div>
          </div>

          {/* 3. QUARTERLY SECTION */}
          <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm relative overflow-hidden group hover:shadow-md transition-all">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <User size={80} className="text-orange-500" />
            </div>
            <h3 className="text-lg font-bold text-orange-600 dark:text-orange-400 mb-4 flex items-center uppercase tracking-wider">
              <Clock size={20} className="mr-2" /> Quarterly
            </h3>
            <div className="flex flex-col items-center">
              <p className="text-sm text-text-muted dark:text-slate-400 mb-4 text-center">
                Select a date for your doctor's visit. Dots indicate busy days.
              </p>
              <SimpleCalendar selectedDate={selectedQuarterlyDate} onSelect={setSelectedQuarterlyDate} />

              <a
                href={`https://calendar.google.com/calendar/r/eventedit?text=Doctor+Visit&dates=${selectedQuarterlyDate ? selectedQuarterlyDate.replace(/-/g, '') : ''}/${selectedQuarterlyDate ? selectedQuarterlyDate.replace(/-/g, '') : ''}&details=Quarterly+Checkup`}
                target="_blank"
                rel="noopener noreferrer"
                className={`mt-4 w-full py-3 rounded-xl font-bold shadow-lg transition-all flex items-center justify-center gap-2
                  ${selectedQuarterlyDate
                    ? 'bg-orange-500 text-white  hover:bg-orange-600'
                    : 'bg-slate-100 text-slate-400 cursor-not-allowed'}
                `}
                onClick={(e) => !selectedQuarterlyDate && e.preventDefault()}
              >
                <Calendar size={18} />
                Book on Google Calendar
              </a>

              {/* Calendar Legend */}
              <div className="mt-4 w-full bg-orange-50 dark:bg-orange-900/20 p-4 rounded-2xl border border-orange-100 dark:border-orange-800/50">
                <h4 className="font-bold text-orange-700 dark:text-orange-300 mb-2 text-sm">Calendar Legend:</h4>
                <ul className="text-xs text-text-muted dark:text-slate-400 space-y-2">
                  <li className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-red-500"></span> Medicine Reminders</li>
                  <li className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-yellow-400"></span> Other Engagements</li>
                  <li className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full border-2 border-purple-500"></span> Doctor's Appointment</li>
                </ul>
              </div>
            </div>
          </div>

          {/* 4. YEARLY SECTION */}
          <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm relative overflow-hidden group hover:shadow-md transition-all">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <Activity size={80} className="text-green-500" />
            </div>
            <h3 className="text-lg font-bold text-green-600 dark:text-green-400 mb-4 flex items-center uppercase tracking-wider">
              <Calendar size={20} className="mr-2" /> Yearly
            </h3>

            <div className="flex flex-col items-center">
              <p className="text-sm text-text-muted dark:text-slate-400 mb-4 text-center">
                Schedule your full body checkup.
              </p>
              <SimpleCalendar selectedDate={selectedYearlyDate} onSelect={setSelectedYearlyDate} />

              <a
                href={`https://calendar.google.com/calendar/r/eventedit?text=Full+Body+Checkup&dates=${selectedYearlyDate ? selectedYearlyDate.replace(/-/g, '') : ''}/${selectedYearlyDate ? selectedYearlyDate.replace(/-/g, '') : ''}&details=Recommended+Tests:+CBC,+Lipid+Profile,+Thyroid,+Liver+Function,+Kidney+Function,+Vitamin+D/B12`}
                target="_blank"
                rel="noopener noreferrer"
                className={`mt-4 w-full py-3 rounded-xl font-bold shadow-lg transition-all flex items-center justify-center gap-2
                  ${selectedYearlyDate
                    ? 'bg-green-500 text-white  hover:bg-green-600'
                    : 'bg-slate-100 text-slate-400 cursor-not-allowed'}
                `}
                onClick={(e) => !selectedYearlyDate && e.preventDefault()}
              >
                <Calendar size={18} />
                Book on Google Calendar
              </a>

              <div className="mt-6 w-full bg-green-50 dark:bg-green-900/20 p-4 rounded-2xl border border-green-100 dark:border-green-800/50">
                <h4 className="font-bold text-green-700 dark:text-green-300 mb-2 text-sm">Recommended Tests:</h4>
                <ul className="text-xs text-text-muted dark:text-slate-400 grid grid-cols-2 gap-1 list-disc pl-4">
                  <li>CBC (Blood Count)</li>
                  <li>Lipid Profile</li>
                  <li>Thyroid Profile</li>
                  <li>Liver Function</li>
                  <li>Kidney Function</li>
                  <li>Vitamin D & B12</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  /** ---------------------------------------
   * Error banner (unchanged)
   * -------------------------------------- */

  const renderEmergencyTab = () => {
    // Fixed contacts (caregiver + defaults)
    const baseContacts = [
      caregiverContact.phone && {
        label: caregiverContact.name
          ? `Caregiver - ${caregiverContact.name}`
          : 'Caregiver',
        number: caregiverContact.phone,
      },
      { label: 'Personal Emergency', number: '+919353305251' },
      { label: 'Ambulance Service', number: '108' },
    ].filter(Boolean);

    // User-added contacts (including Firestore id)
    const userContacts = emergencyContacts.map((c) => ({
      label: c.name,
      number: c.number,
      id: c.id,        // <-- keep the Firestore document id
    }));

    const contacts = [...baseContacts, ...userContacts];

    const handleAddEmergencyContact = async () => {
      if (!newEmergencyContact.name.trim() || !newEmergencyContact.number.trim()) {
        alert('Please enter both name and phone number.');
        return;
      }

      if (!db || !userId) {
        alert('Database not ready. Please try again in a moment.');
        return;
      }

      try {
        const contactsRef = collection(
          db,
          `/artifacts/${appId}/users/${userId}/emergency_contacts`
        );

        await addDoc(contactsRef, {
          name: newEmergencyContact.name.trim(),
          number: newEmergencyContact.number.trim(),
          createdAt: Date.now(),
        });

        // Listener will update emergencyContacts, just clear the form here
        setNewEmergencyContact({ name: '', number: '' });
      } catch (e) {
        console.error('Error saving emergency contact:', e);
        alert('Failed to save emergency contact.');
      }
    };

    const handleDeleteEmergencyContact = async (contactId) => {
      if (!contactId) return;

      // Optimistic UI update (optional)
      setEmergencyContacts((prev) => prev.filter((c) => c.id !== contactId));

      if (!db || !userId) {
        console.warn('DB not ready, deleted only from UI state.');
        return;
      }

      try {
        const contactDocRef = doc(
          db,
          `/artifacts/${appId}/users/${userId}/emergency_contacts`,
          contactId
        );
        await deleteDoc(contactDocRef);
      } catch (e) {
        console.error('Error deleting emergency contact:', e);
        alert('Failed to delete emergency contact.');
      }
    };

    return (
      <div className="p-6 animate-fade-in">
        {/* Header + Edit button */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-2xl flex items-center justify-center mr-4">
              <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-text-main dark:text-white">
                Emergency Contacts
              </h2>
              <p className="text-text-muted dark:text-slate-400">
                Quick access to emergency services
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsEditingEmergency((prev) => !prev)}
            className={`flex items-center px-3 py-2 rounded-xl text-sm font-semibold border transition-all ${isEditingEmergency
              ? 'bg-green-500 text-white border-green-500 hover:bg-green-600'
              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-200 border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
          >
            {isEditingEmergency ? (
              <>
                <Save size={16} className="mr-1.5" />
                Done
              </>
            ) : (
              <>
                <Edit2 size={16} className="mr-1.5" />
                Edit
              </>
            )}
          </button>
        </div>

        {/* Small inline form when Edit is ON */}
        {isEditingEmergency && (
          <div className="mb-6 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={newEmergencyContact.name}
              onChange={(e) =>
                setNewEmergencyContact((prev) => ({ ...prev, name: e.target.value }))
              }

              placeholder="Name (e.g., Dad)"
              className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-text-main dark:text-slate-100 outline-none focus:ring-2 focus:ring-primary/60"
            />
            <input
              type="tel"
              value={newEmergencyContact.number}
              onChange={(e) =>
                setNewEmergencyContact((prev) => ({ ...prev, number: e.target.value }))
              }

              placeholder="Phone number"
              className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-text-main dark:text-slate-100 outline-none focus:ring-2 focus:ring-primary/60"
            />
            <button
              type="button"
              onClick={handleAddEmergencyContact}
              className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold shadow-md shadow-primary/20 hover:bg-primary-dark transition-all"
            >
              Add
            </button>
          </div>
        )}

        {/* Contacts list */}
        <div className="grid gap-4">
          {contacts.map((contact, idx) => (
            <div
              key={idx}
              className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div>
                <p className="text-sm font-medium text-text-muted dark:text-slate-400 mb-1">
                  {contact.label}
                </p>
                <p className="text-xl font-bold text-text-main dark:text-white tracking-wide">
                  {contact.number}
                </p>
              </div>
              <div className="flex gap-3 items-center">
                <a
                  href={`tel:${contact.number}`}
                  className="flex-1 sm:flex-none px-6 py-3 bg-green-500 dark:bg-green-700/80 hover:bg-green-600 dark:hover:bg-green-600/80 text-white rounded-xl font-semibold transition-colors flex items-center justify-center gap-2 shadow-lg shadow-green-200 dark:shadow-green-900/20"
                >
                  <Phone size={18} />
                  Call
                </a>

                <button
                  onClick={() => {
                    navigator.clipboard.writeText(contact.number);
                    alert(`Copied ${contact.number} to clipboard`);
                  }}
                  className="flex-1 sm:flex-none px-6 py-3 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  <Copy size={18} />
                  Copy
                </button>

                {/* Small delete icon - only for user-added contacts (those with an id) and when Edit mode is ON */}
                {isEditingEmergency && contact.id && (
                  <button
                    type="button"
                    onClick={() => handleDeleteEmergencyContact(contact.id)}
                    className="px-2 py-2 rounded-full bg-red-50 dark:bg-red-900/40 hover:bg-red-100 dark:hover:bg-red-800 text-red-600 dark:text-red-200 flex items-center justify-center transition-colors"
                    title="Delete contact"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderError = () => {
    if (!error) return null;
    const isSuccess = typeof error === 'object' && error.type === 'success';
    const messageText = isSuccess ? error.message : (typeof error === 'string' ? error : JSON.stringify(error));

    return (
      <div className={`p-4 rounded-xl mb-6 flex items-center justify-between border ${isSuccess ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
        <span className="font-medium">{isSuccess ? 'Success: ' : 'Error: '}{messageText}</span>
        <button onClick={() => setError(null)} className="hover:opacity-70 transition-opacity"><X size={20} /></button>
      </div>
    );
  };



  // =====================RENDER INFO================================
  const renderInfoModal = () => {
    if (!activeInfoMetric) return null;
    const info = METRIC_INFO[activeInfoMetric];

    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={() => setActiveInfoMetric(null)}>
        <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-2xl max-w-sm w-full border border-slate-100 dark:border-slate-700 transform transition-all scale-100 relative" onClick={e => e.stopPropagation()}>
          <button onClick={() => setActiveInfoMetric(null)} className="absolute top-4 right-4 p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors text-text-muted">
            <X size={20} />
          </button>
          <div className="flex items-center mb-4">
            <div className="p-3 bg-primary/10 rounded-xl mr-3">
              <Info className="text-primary" size={24} />
            </div>
            <h3 className="text-xl font-bold text-text-main dark:text-white">{info.title}</h3>
          </div>
        <div className="text-text-muted dark:text-slate-300 leading-relaxed text-sm">
  {info.desc}
</div>
          <button
            onClick={() => setActiveInfoMetric(null)}
            className="mt-6 w-full py-3 bg-primary text-white rounded-xl font-semibold shadow-lg shadow-primary/20 hover:bg-primary-dark transition-all"
          >
            Got it
          </button>
        </div>
      </div>
    );
  };


  // =========================================================

  /** ---------------------------------------
   * Render (unchanged)
   * -------------------------------------- */
  if (!googleAccessToken) return <LoginPage
    handleLogin={handleLogin}
    error={error}
    setActiveInfoMetric={setActiveInfoMetric}
/>;

  return (
    <div className="min-h-screen p-4 sm:p-8 bg-background dark:bg-slate-950 text-text-main dark:text-slate-100 font-sans">
      <ColorBlindFilters />
      <div className="max-w-7xl mx-auto">
        {/* Header */}

        {/* ✨ BEAUTIFUL GRADIENT HEADER START */}

        <div className="sticky top-0 z-50 mb-0 -mx-4 sm:-mx-8 px-4 sm:px-8 py-4 bg-white/80 dark:bg-slate-950/80 backdrop-blur-xl border-b border-slate-200/50 dark:border-slate-800/50 flex flex-col md:flex-row justify-between items-center transition-all duration-300 shadow-sm">

          {/* Left: Logo & Gradient Title */}
          <div className="flex items-center mb-4 md:mb-0 group cursor-default">
            {/* FIXED LOGO CONTAINER - Increased to w-14 h-14 for a bigger "border" look */}
            <div className="relative w-14 h-14 mr-4 flex-shrink-0">
              {/* Glow Effect */}
              <div className="absolute inset-0 bg-gradient-to-tr from-primary to-secondary rounded-2xl opacity-20 group-hover:opacity-40 transition-opacity duration-500 blur-md" />

              {/* Logo Box - Added p-2 padding so the logo doesn't touch the edges */}
              <div className="relative w-full h-full bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm flex items-center justify-center overflow-hidden p-1">
                <img
                  src={appIcon}
                  alt="VytalCare Logo"
                  // scale-125 zooms in slightly to trim transparent edges, but padding keeps it contained
                  className="w-full h-full object-contain scale-125"
                />
              </div>
            </div>

            <div className="flex flex-col justify-center h-14">
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-primary via-teal-500 to-secondary tracking-tight leading-none pb-1">
                VytalCare
              </h1>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveInfoMetric('about');
              }}
              className="w-5 h-5 flex items-center justify-center rounded-full border border-slate-300 dark:border-slate-600 text-slate-400 hover:text-primary hover:border-primary hover:bg-primary/5 transition-all mt-0.5"
              title="About VytalCare"
              >
           <Info size={12} strokeWidth={2.5} />
         </button>
      </div>

              <span className="text-[10px] font-bold tracking-widest text-text-muted uppercase opacity-70 ml-0.5 leading-none">
                AI Health Companion
              </span>
            </div>
          </div>

          {/* Center: Glassy Tabs */}
          <div className="flex bg-slate-100/80 dark:bg-slate-800/50 p-1.5 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 backdrop-blur-md shadow-inner mb-4 md:mb-0">
            {[
              { id: 'reminders', icon: Bell, label: 'Reminders' },
              { id: 'health_plan', icon: Calendar, label: 'Plan' },
              { id: 'activity', icon: Activity, label: 'Activity' },
              { id: 'chatbot', icon: MessageSquare, label: 'Chat' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center px-4 py-2 rounded-xl text-sm font-bold transition-all duration-300 ${activeTab === tab.id
                  ? 'bg-white dark:bg-slate-700 text-primary shadow-md scale-100'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-white/50 dark:hover:bg-slate-700/50'
                  }`}
              >
                <tab.icon size={16} className={`mr-2 ${activeTab === tab.id ? 'fill-current' : ''}`} />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Right: Emergency Button with Pulse */}
          <button
            className="px-5 py-2.5 bg-gradient-to-r from-red-500 to-red-600 text-white font-bold rounded-xl shadow-lg shadow-red-500/30 
    hover:shadow-red-500/50 hover:scale-105 active:scale-95 transition-all duration-200 flex items-center gap-2 group"
            onClick={() => setActiveTab('emergency')}
          >
            <div className="w-2 h-2 bg-white rounded-full animate-ping mr-1" />
            EMERGENCY
          </button>
        </div>
        {/* ✨ BEAUTIFUL GRADIENT HEADER END */}

        {/* ✅ FIXED PULSE LINE (more visible) */}
        <div className="w-full h-[3px] bg-slate-300 dark:bg-slate-600 header-line-pulse mb-6 relative z-40" />

        {renderError()}

        <div className={`flex flex-col lg:flex-row gap-6 ${activeTab === 'chatbot' ? 'items-stretch' : 'items-start'}`}>
          {/* Left Sidebar - Profile */}
          <div className="w-full lg:w-80 flex-shrink-0 h-auto">
            <ProfileSection
              db={db}
              userId={userId}
              appId={appId}
              theme={theme}
              setTheme={setTheme}
              colorBlindMode={colorBlindMode}
              setColorBlindMode={setColorBlindMode}
              onCaregiverChange={handleCaregiverChange}
              onBmiChange={setBmi}
            />
          </div>

          {/* Main Content */}
          <div className={`flex-grow bg-surface dark:bg-slate-900 rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-none border border-slate-100 dark:border-slate-800 overflow-hidden h-[100vh]${activeTab !== 'chatbot' ? 'min-h-[80vh] h' : ''}`}>
            {activeTab === 'reminders' && renderRemindersTab()}
            {activeTab === 'health_plan' && renderHealthPlanTab()}
            {activeTab === 'activity' && renderActivityTab()}
            {activeTab === 'chatbot' && renderChatbotTab()}
            {activeTab === 'emergency' && renderEmergencyTab()}
          </div>
        </div>

        {isCameraModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center">
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 w-full max-w-md shadow-2xl flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-text-main dark:text-slate-100 mb-1">
                Take a photo
              </h3>

              {/* Live video preview */}
              <div className="relative w-full rounded-xl overflow-hidden bg-black aspect-video">
                <video
                  ref={videoReff}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Hidden canvas just for capturing the frame */}
              <canvas ref={canvasReff} className="hidden" />

              <div className="flex justify-end gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => {
                    stopCamera();
                    setIsCameraModalOpen(false);
                  }}
                  className="px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCaptureFromCamera}
                  className="px-3 py-2 text-xs rounded-xl bg-primary text-white font-semibold shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all"
                >
                  Capture
                </button>
              </div>
            </div>
          </div>
        )}
        {renderInfoModal()}
      </div>
    </div>
  );
};

export default App;