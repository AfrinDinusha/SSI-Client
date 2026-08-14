import { Link } from 'react-router-dom';
import './App.css'; // For sidebar styling (Home page look)
import './Dashboard.css'; // For main content styling (original Dashboard look)
import Button from './Button';
import HeaderBranding from './HeaderBranding';
import { getSidebarModulesForUser, resolveSidebarUserEmail } from './modulesConfig';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Users, Calendar, FileText, AlertTriangle, FolderOpen, ClipboardList, Building, Handshake, Landmark, Clock, Map, BarChart3, User, TrendingUp, TrendingDown, Activity, Plus, CheckCircle, Bell, Settings, LayoutDashboard, Home as HomeIcon, Award, Target, Zap, Star, Trophy, Shield, Flame, Heart, Gift, Sparkles, Crown, Medal, Rocket, CloudLightning as Lightning, Filter, ChevronDown, AlertOctagon, CreditCard, FileSignature, Search, Clock3, CalendarDays, Database } from 'lucide-react';
import Chart from 'chart.js/auto';

// Expose Chart.js on window for existing canvas chart code
if (typeof window !== 'undefined') window.Chart = Chart;

// Attendance data for pie chart - will be populated from API

// Attendance trend data for last 7 days - will be populated from API

const shiftData = [
  { shift: 'Morning', contractors: 85, color: '#FFD93D' },
  { shift: 'Evening', contractors: 65, color: '#6BCF7F' },
  { shift: 'Night', contractors: 45, color: '#4D96FF' },
  { shift: 'Rotating', contractors: 25, color: '#9B59B6' },
];



const clTrendData = {
  addition: [
    { month: 'Jan', value: 12, target: 15 },
    { month: 'Feb', value: 18, target: 15 },
    { month: 'Mar', value: 8, target: 15 },
    { month: 'Apr', value: 22, target: 15 },
    { month: 'May', value: 16, target: 15 },
    { month: 'Jun', value: 25, target: 15 },
  ],
  attrition: [
    { month: 'Jan', value: 5, benchmark: 8 },
    { month: 'Feb', value: 3, benchmark: 8 },
    { month: 'Mar', value: 12, benchmark: 8 },
    { month: 'Apr', value: 7, benchmark: 8 },
    { month: 'May', value: 4, benchmark: 8 },
    { month: 'Jun', value: 6, benchmark: 8 },
  ]
};

// Contractor scoring matrix based on user requirements
const contractorScoringMatrix = {
  cir: {
    0: { score: 100, remark: 'Zero tolerance maintained' },
    1: { score: 80, remark: 'Minor lapses, immediate corrective action' },
    2: { score: 80, remark: 'Minor lapses, immediate corrective action' },
    3: { score: 60, remark: 'Needs improvement, recurring issues' },
    4: { score: 60, remark: 'Needs improvement, recurring issues' },
    5: { score: 40, remark: 'Serious concern, high risk' },
    6: { score: 40, remark: 'Serious concern, high risk' }
  },
  ehs: {
    0: { score: 100, remark: 'Fully compliant' },
    1: { score: 100, remark: 'Fully compliant' },
    2: { score: 80, remark: 'Minor lapses, manageable' },
    3: { score: 80, remark: 'Minor lapses, manageable' },
    4: { score: 60, remark: 'Compliance gaps visible' },
    5: { score: 60, remark: 'Compliance gaps visible' },
    6: { score: 40, remark: 'Significant non-compliance' },
    7: { score: 40, remark: 'Significant non-compliance' }
  }
};

// Helper function to get score and remark for CIR count
const getCIRScore = (cirCount) => {
  if (cirCount >= 7) {
    return { score: 20, remark: 'Unacceptable, severe risk' };
  }
  return contractorScoringMatrix.cir[cirCount] || { score: 20, remark: 'Unacceptable, severe risk' };
};

// Helper function to get score and remark for EHS violations
const getEHSScore = (ehsCount) => {
  if (ehsCount >= 8) {
    return { score: 20, remark: 'High safety/environment risk' };
  }
  return contractorScoringMatrix.ehs[ehsCount] || { score: 20, remark: 'High safety/environment risk' };
};

function Dashboard({ userRole, userEmail }) {
  const [expandedMenus, setExpandedMenus] = useState({});
  const [showSidebarMenu, setShowSidebarMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showContractorDropdown, setShowContractorDropdown] = useState(false);
  const [contractors, setContractors] = useState(['All']);
  const [searchTerm, setSearchTerm] = useState('');
  /*const [gamificationScore, setGamificationScore] = useState(1250);
  const [achievements, setAchievements] = useState([
    { id: 1, name: 'Safety Champion', icon: '🛡️', unlocked: true },
    { id: 2, name: 'Efficiency Master', icon: '⚡', unlocked: true },
    { id: 3, name: 'Team Builder', icon: '🤝', unlocked: false },
  ]);*/
  const [animatedStats, setAnimatedStats] = useState({
    total: 0,
    present: 0,
    absent: 0,
  });


 
  // Employee count state
  const [totalEmployees, setTotalEmployees] = useState(0);
 
  // Attendance data state
  const [todayAttendance, setTodayAttendance] = useState({
    present: 0,
    absent: 0,
    total: 0
  });
 
  // Previous day Miss Punch (updates daily; shows yesterday's count when you open today)
  const [prevDayMissPunchData, setPrevDayMissPunchData] = useState([]);
  const [showMissPunchTooltip, setShowMissPunchTooltip] = useState(false);
  const [missPunchTooltipPosition, setMissPunchTooltipPosition] = useState({ x: 0, y: 0 });
 
  // Today's Late In (data for tooltip; count = data.length)
  const [todayLateInData, setTodayLateInData] = useState([]);
  const [showTodayLateInTooltip, setShowTodayLateInTooltip] = useState(false);
  const [todayLateInTooltipPosition, setTodayLateInTooltipPosition] = useState({ x: 0, y: 0 });
 
  // Shift distribution state
  const [shiftDistribution, setShiftDistribution] = useState({});
  const [dashboardShiftOrder, setDashboardShiftOrder] = useState([]); // shift names from Shift_function for Live Shift Distribution display order
  const [dailyShiftData, setDailyShiftData] = useState([]);
  const [isShiftDataLoading, setIsShiftDataLoading] = useState(false);
  const [shiftDataRefreshKey, setShiftDataRefreshKey] = useState(0);
 
  // Attendance pie chart state
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7)); // Current month YYYY-MM
  const [attendancePieData, setAttendancePieData] = useState([]); // Start with empty array
  const [isAttendanceLoading, setIsAttendanceLoading] = useState(false);
 
  // Contractor filter state
  const [selectedContractor, setSelectedContractor] = useState('all'); // 'all' means show all contractors
  const [selectedContractorTrend, setSelectedContractorTrend] = useState('all'); // Separate state for trend chart
  const [selectedContractorShift, setSelectedContractorShift] = useState('all'); // Separate state for General Shift chart
  const [selectedShift, setSelectedShift] = useState('all'); // For shift chart shift filter
  const [contractorList, setContractorList] = useState([]);
  const [shiftList, setShiftList] = useState([]);
  const [isTrendLoading, setIsTrendLoading] = useState(false);
  const [attendanceTrendData, setAttendanceTrendData] = useState([]);
  const [trendRefreshKey, setTrendRefreshKey] = useState(0);
 
  // Late In Report - Week Wise (replaces CL Addition Trend in this card)
  const [lateInTrendData, setLateInTrendData] = useState([]);
  const [isLateInTrendLoading, setIsLateInTrendLoading] = useState(false);
  // CL Addition legacy state (kept for PDF/other refs if any)
  const [clAdditionTrendData, setClAdditionTrendData] = useState([]);
  const [isClAdditionLoading, setIsClAdditionLoading] = useState(false);
  const [selectedContractorForCLAddition, setSelectedContractorForCLAddition] = useState('all');
  const [contractorBreakdownData, setContractorBreakdownData] = useState({});
 
  // Interactive chart state
  const [selectedChartMonth, setSelectedChartMonth] = useState(null);
  const [monthEmployeeDetails, setMonthEmployeeDetails] = useState([]);
  const [showMonthDetails, setShowMonthDetails] = useState(false);
  const [isLoadingMonthDetails, setIsLoadingMonthDetails] = useState(false);
 
  // Payroll Earned Gross & Total Salary month-wise (replaces CL Attrition in this card)
  const [payrollGrossTrendData, setPayrollGrossTrendData] = useState([]);
  const [isPayrollTrendLoading, setIsPayrollTrendLoading] = useState(false);
  // LOH and OT Hours Month Report (comparison chart)
  const [lohOtTrendData, setLohOtTrendData] = useState([]);
  const [isLohOtLoading, setIsLohOtLoading] = useState(false);
  // CL Attrition legacy state (kept for PDF/refs if any)
  const [clAttritionTrendData, setClAttritionTrendData] = useState([]);
  const [isClAttritionLoading, setIsClAttritionLoading] = useState(false);
  const [selectedContractorForCLAttrition, setSelectedContractorForCLAttrition] = useState('all');
 
 
  // Contractor Heatmap state - renamed to scoring table state
  const [contractorScoringData, setContractorScoringData] = useState([]);
  const [isScoringLoading, setIsScoringLoading] = useState(false);
 
  // Loading state
  const [isLoading, setIsLoading] = useState(true);
 
  // Tooltip state for contractor information
  const [showContractorTooltip, setShowContractorTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const [contractorEmployeeData, setContractorEmployeeData] = useState([]);
  const [selectedContractorForDetails, setSelectedContractorForDetails] = useState(null);
  const [contractorViewMode, setContractorViewMode] = useState('overview'); // 'overview' or 'employees'
  const [showAllEmployees, setShowAllEmployees] = useState(false);
 
  // Tooltip state for present employees
  const [showPresentTooltip, setShowPresentTooltip] = useState(false);
  const [presentTooltipPosition, setPresentTooltipPosition] = useState({ x: 0, y: 0 });
  const [presentEmployeesData, setPresentEmployeesData] = useState([]);
 
  // New state for contractor-wise view
  const [presentViewMode, setPresentViewMode] = useState('contractors'); // 'contractors' or 'employees'
  const [selectedPresentContractor, setSelectedPresentContractor] = useState(null);
  const [contractorEmployeeCounts, setContractorEmployeeCounts] = useState([]);

  // Tooltip state for absent employees
  const [showAbsentTooltip, setShowAbsentTooltip] = useState(false);
  const [absentTooltipPosition, setAbsentTooltipPosition] = useState({ x: 0, y: 0 });
  const [absentEmployeesData, setAbsentEmployeesData] = useState([]);
  const [absentContractorEmployeeCounts, setAbsentContractorEmployeeCounts] = useState([]);
 
  // New state for absent contractor-wise view
  const [absentViewMode, setAbsentViewMode] = useState('contractors'); // 'contractors' or 'employees'
  const [selectedAbsentContractor, setSelectedAbsentContractor] = useState(null);

  // Chart refs
  const diversityChartRef = useRef(null);
  const attendanceChartRef = useRef(null);
  const shiftChartRef = useRef(null);

  const clAdditionChartRef = useRef(null);
  const clAttritionChartRef = useRef(null);
  const lohOtChartRef = useRef(null);

  // Same sidebar order on all pages (from modulesConfig)
  const modulesToShow = useMemo(
    () => getSidebarModulesForUser(resolveSidebarUserEmail(userEmail), userRole),
    [userEmail, userRole]
  );

  const toggleMenu = (index) => {
    setExpandedMenus(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  const normalizeEmployeeId = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    if (/^\d+$/.test(raw)) return String(Number(raw));
    return raw.toLowerCase();
  };

  const getEmployeeIdVariants = (employee) => {
    const values = [
      employee?.employeeCode,
      employee?.EmployeeCode,
      employee?.id,
    ];
    return Array.from(new Set(values.map(normalizeEmployeeId).filter(Boolean)));
  };

  const countMatchedPresentEmployees = (employees, employeesWithFirstIN, { requireKnownContractor = false } = {}) => {
    if (!Array.isArray(employees) || !employeesWithFirstIN) return 0;
    const normalizedPresentIds = new Set(
      Array.from(employeesWithFirstIN).map(normalizeEmployeeId).filter(Boolean)
    );
    return employees.reduce((count, employee) => {
      const hasMatch = getEmployeeIdVariants(employee).some((id) => normalizedPresentIds.has(id));
      if (!hasMatch) return count;
      if (requireKnownContractor) {
        const contractorName = String(employee?.contractor || employee?.contractorName || '').trim().toLowerCase();
        if (!contractorName || contractorName === 'unknown' || contractorName === 'unknown contractor') {
          return count;
        }
      }
      return count + 1;
    }, 0);
  };

  const getAttendanceRecords = (payload) => {
    if (Array.isArray(payload?.data?.attendanceRecords)) return payload.data.attendanceRecords;
    if (Array.isArray(payload?.attendanceRecords)) return payload.attendanceRecords;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
  };

  const getAttendanceRecordEmployeeId = (record) =>
    record?.employeeId || record?.EmployeeID || record?.EmployeeId || record?.employeeCode || record?.EmployeeCode || '';

  const getAttendanceRecordFirstIn = (record) =>
    record?.firstIn || record?.FirstIN || record?.FirstIn || '';

  // Animated counter effect
  useEffect(() => {
    const animateValue = (start, end, duration, callback) => {
      const startTime = performance.now();
      const animate = (currentTime) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const value = Math.floor(start + (end - start) * progress);
        callback(value);
        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      };
      requestAnimationFrame(animate);
    };

    animateValue(0, totalEmployees, 2000, (value) => setAnimatedStats(prev => ({ ...prev, total: value })));
    animateValue(0, todayAttendance.present, 2000, (value) => setAnimatedStats(prev => ({ ...prev, present: value })));
    animateValue(0, todayAttendance.absent, 2000, (value) => setAnimatedStats(prev => ({ ...prev, absent: value })));
  }, [totalEmployees, todayAttendance]);

  useEffect(() => {
    if (totalEmployees <= 0) return;

    const hasPresentList = presentEmployeesData.length > 0;
    const hasAbsentList = absentEmployeesData.length > 0;
    if (!hasPresentList && !hasAbsentList) return;

    const nextPresent = hasPresentList
      ? presentEmployeesData.length
      : Math.max(0, totalEmployees - absentEmployeesData.length);
    const nextAbsent = hasAbsentList
      ? absentEmployeesData.length
      : Math.max(0, totalEmployees - presentEmployeesData.length);

    setTodayAttendance((prev) => {
      if (
        prev.present === nextPresent &&
        prev.absent === nextAbsent &&
        prev.total === totalEmployees
      ) {
        return prev;
      }
      return {
        present: nextPresent,
        absent: nextAbsent,
        total: totalEmployees
      };
    });
  }, [presentEmployeesData, absentEmployeesData, totalEmployees]);

  // Enhanced chart creation with animations
  useEffect(() => {
    // Add a small delay to ensure data is properly set
    const timeoutId = setTimeout(() => {
    try {
      // Check if Chart.js is available
      if (!window.Chart) {
        console.warn('Chart.js not available yet. Will retry...');
        return;
      }
     
      // Check if shift chart ref is available (may not be mounted on first run)
      if (!shiftChartRef.current) {
        setTimeout(() => {
          try {
            if (window.Chart && shiftChartRef.current) {
              window.dispatchEvent(new Event('resize'));
            }
          } catch (e) {}
        }, 500);
        return;
      }

        console.log('Chart useEffect triggered with attendancePieData:', attendancePieData);

      // Destroy existing chart if it exists
      if (diversityChartRef.current && diversityChartRef.current.chart) {
        console.log('Destroying existing chart from ref');
        diversityChartRef.current.chart.destroy();
        diversityChartRef.current.chart = null;
      }

      // Attendance Pie Chart with animations
      if (diversityChartRef.current && attendancePieData) {
        // Ensure we have valid data structure
        const chartData = attendancePieData.length > 0 ? attendancePieData : [
          { name: 'Present', value: 0, color: '#4ECDC4' },
          { name: 'Absent', value: 0, color: '#FF6B6B' }
        ];
       
        // Check if we have any non-zero values
        const hasData = chartData.some(d => d.value > 0);
        console.log('Chart data check:', { hasData, data: chartData });
       
        // For zero data, we need to show a minimal donut structure
        let displayData = chartData;
        if (!hasData) {
          console.log('No data found, creating chart with minimal values to show structure');
          // Set minimal values to ensure the donut segments are visible
          displayData = [
            { name: 'Present', value: 0.1, color: '#4ECDC4' },
            { name: 'Absent', value: 0.1, color: '#FF6B6B' }
          ];
        }
       
        console.log('Creating chart with data:', displayData);
        console.log('Chart canvas element:', diversityChartRef.current);
        console.log('Chart canvas dimensions:', {
          width: diversityChartRef.current.width,
          height: diversityChartRef.current.height,
          clientWidth: diversityChartRef.current.clientWidth,
          clientHeight: diversityChartRef.current.clientHeight
        });
       
        // Clear any existing chart on the canvas
        const existingChart = window.Chart.getChart(diversityChartRef.current);
        if (existingChart) {
          console.log('Destroying existing chart');
          existingChart.destroy();
        }
       
      const chart = new window.Chart(diversityChartRef.current, {
        type: 'doughnut',
        data: {
          labels: displayData.map(d => d.name),
          datasets: [{
            data: displayData.map(d => d.value),
            backgroundColor: displayData.map(d => d.color),
            borderWidth: 3,
            borderColor: '#fff',
            hoverBorderWidth: 5,
            hoverOffset: 10,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: {
            animateRotate: true,
            animateScale: true,
            duration: hasData ? 2000 : 0, // No animation for zero data
          },
          cutout: '60%', // Make it a donut chart
          radius: hasData ? '70%' : '50%', // Smaller radius for zero data
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                usePointStyle: true,
                padding: 20,
                font: { size: 12, weight: 'bold' },
                generateLabels: function(chart) {
                  const data = chart.data;
                  if (data.labels.length && data.datasets.length) {
                    const dataset = data.datasets[0];
                    // Use original chartData for accurate legend display
                    const total = chartData?.reduce((a, b) => a + b.value, 0) || 0;
                   
                    return data.labels.map((label, i) => {
                      const originalValue = chartData[i]?.value || 0;
                      const percentage = total > 0 ? ((originalValue / total) * 100).toFixed(1) : '0';
                      return {
                        text: `${label}: ${originalValue} (${percentage}%)`,
                        fillStyle: dataset.backgroundColor[i],
                        strokeStyle: dataset.borderColor,
                        lineWidth: dataset.borderWidth,
                        pointStyle: 'circle',
                        hidden: false,
                        index: i
                      };
                    });
                  }
                  return [];
                }
              }
            },
            title: {
              display: true,
              text: 'Monthly Attendance Distribution (Muster Reports)',
              font: { size: 16, weight: 'bold' },
              color: '#2c3e50'
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  // Use original chartData for accurate tooltip display
                  const total = chartData?.reduce((a, b) => a + b.value, 0) || 0;
                  const originalValue = chartData[context.dataIndex]?.value || 0;
                  const percentage = total > 0 ? ((originalValue / total) * 100).toFixed(1) : '0';
                  return `${context.label}: ${originalValue} (${percentage}%)`;
                }
              }
            }
          }
        },
        plugins: [{
          id: 'percentageDisplay',
          afterDatasetsDraw: function(chart) {
            const ctx = chart.ctx;
            const data = chart.data;
            const dataset = data.datasets[0];
            // Use original chartData for accurate percentage calculation
            const total = chartData?.reduce((a, b) => a + b.value, 0) || 0;
           
            if (total > 0) {
              chart.data.datasets.forEach((dataset, datasetIndex) => {
                const meta = chart.getDatasetMeta(datasetIndex);
                meta.data.forEach((element, index) => {
                  const originalValue = chartData[index]?.value || 0;
                  const percentage = ((originalValue / total) * 100).toFixed(1);
                 
                  // Position the percentage text in the center of each segment
                  const position = element.tooltipPosition();
                  const x = position.x;
                  const y = position.y;
                 
                  ctx.save();
                  ctx.fillStyle = '#fff';
                  ctx.font = 'bold 14px Arial';
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  ctx.fillText(percentage + '%', x, y);
                  ctx.restore();
                });
              });
            } else {
              // Show "0%" in the center when all values are zero
              const centerX = chart.width / 2;
              const centerY = chart.height / 2;
             
              ctx.save();
              ctx.fillStyle = '#64748b';
              ctx.font = 'bold 16px Arial';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText('0%', centerX, centerY);
              ctx.restore();
            }
          }
        }]
      });
     
      // Store chart reference for cleanup
      diversityChartRef.current.chart = chart;
      console.log('Chart created successfully:', chart);
      console.log('Chart data:', chart.data);
      console.log('Chart datasets:', chart.data.datasets);
    } else {
      console.log('Chart creation skipped - conditions not met:', {
        hasRef: !!diversityChartRef.current,
        hasData: !!attendancePieData,
        dataLength: attendancePieData?.length || 0
      });
    }

    // Attendance Trend Line Chart
    if (window.Chart && attendanceChartRef.current) {
      // Create test data if no real data
      const trendLabels = attendanceTrendData.length > 0 ? attendanceTrendData.map(d => d.day) : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const trendValues = attendanceTrendData.length > 0 ? attendanceTrendData.map(d => d.present) : [45, 52, 38, 61, 48, 42, 35];
     
      console.log('Creating attendance trend chart with:', { trendLabels, trendValues });
     
      const chart = new window.Chart(attendanceChartRef.current, {
        type: 'line',
        data: {
          labels: trendLabels,
          datasets: [{
            label: 'Attendance % (Present)',
            data: trendValues,
            borderColor: '#FF8C42',
            backgroundColor: 'rgba(255, 140, 66, 0.1)',
            tension: 0.4,
            fill: true,
            pointRadius: 6,
            pointHoverRadius: 8,
            pointBackgroundColor: '#FF8C42',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: {
            duration: 2000,
            easing: 'easeInOutQuart'
          },
          plugins: {
            legend: {
              display: true,
              position: 'top',
              labels: {
                usePointStyle: true,
                padding: 15
              }
            },
            title: {
              display: true,
              text: 'Last 7 Days Attendance Percentage',
              font: { size: 16, weight: 'bold' },
              color: '#2c3e50'
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  return `${context.dataset.label}: ${context.parsed.y.toFixed(1)}%`;
                }
              }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              max: 100,
              grid: { color: 'rgba(0,0,0,0.1)' },
              title: {
                display: true,
                text: 'Attendance Percentage (%)'
              },
              ticks: {
                callback: function(value) {
                  return value + '%';
                }
              }
            },
            x: {
              grid: { display: false },
              title: {
                display: true,
                text: 'Days'
              }
            }
          }
        }
      });
     
      // Store chart reference for cleanup
      attendanceChartRef.current.chart = chart;
    }

    // Daily Shift Column Bar Chart
    if (window.Chart && shiftChartRef.current) {
      console.log('Creating shift chart with data:', { dailyShiftData, shiftDistribution });
      console.log('Shift chart ref element:', shiftChartRef.current);
      console.log('Chart.js available:', !!window.Chart);
      console.log('Daily shift data length:', dailyShiftData ? dailyShiftData.length : 0);
     
      // Destroy existing chart if it exists
      if (shiftChartRef.current.chart) {
        console.log('Destroying existing shift chart');
        shiftChartRef.current.chart.destroy();
        shiftChartRef.current.chart = null;
      }
     
      // Ensure dailyShiftData is an array
      const safeDailyShiftData = Array.isArray(dailyShiftData) ? dailyShiftData : [];
     
      // Define colors first
      const colors = [
        '#FFD93D', // Yellow
        '#6BCF7F', // Green
        '#4D96FF', // Blue
        '#9B59B6', // Purple
        '#FF6B6B', // Red
        '#4ECDC4', // Teal
        '#45B7D1', // Light Blue
        '#96CEB4'  // Light Green
      ];

      // Create chart data for General shift showing last 7 days
      // Generate labels for last 7 days
      const today = new Date();
      const chartLabels = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dayName = i === 0 ? 'Today' : date.toLocaleDateString('en-US', { weekday: 'short' });
        chartLabels.push(dayName);
      }
      let chartDatasets = [];

      console.log('Creating General shift chart for last 7 days');
      console.log('Daily shift data:', dailyShiftData);
      console.log('Shift distribution data:', shiftDistribution);

      // Check if any employees are assigned to shifts
      const totalAssignedEmployees = Object.values(shiftDistribution).reduce((sum, shift) => sum + (shift.assigned || 0), 0);
      const hasAssignedEmployees = totalAssignedEmployees > 0;
     
      console.log('Total assigned employees:', totalAssignedEmployees);
      console.log('Has assigned employees:', hasAssignedEmployees);
     
      // Get employee count for each day using real-time data only
      const generalShiftData = chartLabels.map((day, index) => {
        // Find the day data in dailyShiftData (match by day name, case-insensitive, or by index)
        const dayData = safeDailyShiftData.find(d => {
          if (!d || !d.date) return false;
          const dayDate = String(d.date).toLowerCase().trim();
          const targetDay = String(day).toLowerCase().trim();
          return dayDate === targetDay;
        }) || (index < safeDailyShiftData.length && safeDailyShiftData[index] ? safeDailyShiftData[index] : null);
       
        console.log(`Looking for data for ${day} (index ${index}):`, dayData);
       
        if (dayData && dayData.shifts) {
          // Look for General shift or any shift that might represent general employees
          // Handle both cases: when shifts object exists (even if empty) and when it has data
          const generalCount = dayData.shifts['General'] !== undefined ? dayData.shifts['General'] :
                              dayData.shifts['General Shift'] !== undefined ? dayData.shifts['General Shift'] :
                              dayData.shifts['general'] !== undefined ? dayData.shifts['general'] :
                              (typeof dayData.shifts === 'object' && Object.keys(dayData.shifts).length > 0)
                                ? Object.values(dayData.shifts).reduce((sum, count) => sum + (Number(count) || 0), 0)
                                : 0;
          console.log(`📊 Real-time employee count for ${day}:`, generalCount);
          return Number(generalCount) || 0;
        }
       
        // No real data available for this day - show 0
        console.log(`⚠️ No real-time data available for ${day}, showing 0`);
        return 0;
      });

      console.log('📊 Real-time General shift data for chart:', generalShiftData);
      console.log('📊 Daily shift data array:', safeDailyShiftData);
      console.log('📊 Chart labels:', chartLabels);

      // Ensure generalShiftData has exactly 7 values (one for each day)
      while (generalShiftData.length < chartLabels.length) {
        generalShiftData.push(0);
      }
      generalShiftData.splice(chartLabels.length); // Trim if too many

      // Ensure we always have valid data for the chart (should always have data from generalShiftData)
      if (generalShiftData.length !== chartLabels.length) {
        console.warn('⚠️ Data length mismatch, padding with zeros');
        while (generalShiftData.length < chartLabels.length) {
          generalShiftData.push(0);
        }
        generalShiftData.splice(chartLabels.length); // Trim if too many
      }

      // Always create/update dataset with the correct data
      chartDatasets = [{
        label: 'General',
        data: generalShiftData.length > 0 ? generalShiftData : Array(chartLabels.length).fill(0),
        backgroundColor: '#4ECDC4', // Teal color for General shift
        borderColor: '#4ECDC4',
        borderWidth: 2,
        borderRadius: 6,
        borderSkipped: false,
        barThickness: 40,
        maxBarThickness: 50,
      }];

      console.log('Final chart data:', { chartLabels, chartDatasets });
      console.log('Chart will render with labels:', chartLabels, 'and data:', generalShiftData);
      console.log('Chart dataset data length:', chartDatasets[0]?.data?.length, 'Labels length:', chartLabels.length);

      try {
        const chart = new window.Chart(shiftChartRef.current, {
        type: 'bar',
        data: {
          labels: chartLabels,
          datasets: chartDatasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: {
            duration: 2000,
            delay: (context) => context.dataIndex * 100,
            easing: 'easeInOutQuart'
          },
          barPercentage: 0.8,
          categoryPercentage: 0.9,
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                usePointStyle: true,
                padding: 15,
                font: {
                  size: 12
                }
              }
            },
            title: {
              display: true,
              text: 'General Shift - Daily Employee Count',
              font: { size: 16, weight: 'bold' },
              color: '#2c3e50'
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  return `${context.dataset.label}: ${context.parsed.y} employees`;
                },
                afterLabel: function(context) {
                  try {
                    const dayLabel = context.label; // 'Today'
                    const dayData = safeDailyShiftData.find(d => d.date === dayLabel);
                    const names = (dayData && dayData.presentEmployees && (dayData.presentEmployees['General'] || dayData.presentEmployees['General Shift'])) || [];
                    if (!names || names.length === 0) {
                      return 'No present employees';
                    }
                    const list = names.slice(0, 10).join(', ');
                    return names.length > 10 ? `${list}, …` : list;
                  } catch (e) {
                    return '';
                  }
                }
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              title: {
                display: true,
                text: 'Days',
                font: { size: 12, weight: 'bold' }
              },
              ticks: {
                font: { size: 11 }
              }
            },
            y: {
              beginAtZero: true,
              min: 0,
              title: {
                display: true,
                text: 'Number of Employees',
                font: { size: 12, weight: 'bold' }
              },
              ticks: {
                stepSize: 1,
                font: { size: 11 },
                precision: 0,
                callback: function(value) {
                  return Number.isInteger(value) ? value : '';
                }
              },
              grid: {
                color: 'rgba(0,0,0,0.1)',
                drawBorder: false
              }
            }
          }
        }
        });
       
        // Store chart reference for cleanup
        shiftChartRef.current.chart = chart;
        // Ensure proper sizing on first render
        try { chart.resize(); } catch (e) {
          console.warn('Chart resize error:', e);
        }
        console.log('✅ Shift chart created successfully');
      } catch (error) {
        console.error('❌ Error creating shift chart:', error);
        console.error('Chart data:', { chartLabels, chartDatasets, generalShiftData });
      }
    } else {
      console.warn('⚠️ Cannot create shift chart: Chart.js or ref not available', {
        hasChart: !!window.Chart,
        hasRef: !!shiftChartRef.current
      });
    }

    // CL charts are now created separately via createCLCharts function
    } catch (error) {
      console.error('Error creating charts:', error);
    }
    }, 200); // 200ms delay to ensure DOM is ready

    // Cleanup timeout on unmount
    return () => clearTimeout(timeoutId);
  }, [attendancePieData, attendanceTrendData, dailyShiftData, shiftDistribution, selectedShift, selectedContractor, clAdditionTrendData, payrollGrossTrendData]);

  // Debug effect to monitor attendancePieData changes
  useEffect(() => {
    console.log('attendancePieData changed:', attendancePieData);
  }, [attendancePieData]);

  // Debug effect to monitor shift data changes and trigger chart update
  useEffect(() => {
    console.log('shiftDistribution changed:', shiftDistribution);
    console.log('dailyShiftData changed:', dailyShiftData);
   
    // Force chart re-render when data changes by triggering a resize event
    if (shiftChartRef.current && shiftChartRef.current.chart) {
      try {
        setTimeout(() => {
          if (shiftChartRef.current && shiftChartRef.current.chart) {
            shiftChartRef.current.chart.update();
            console.log('Chart updated after data change');
          }
        }, 100);
      } catch (e) {
        console.warn('Error updating chart:', e);
      }
    }
  }, [shiftDistribution, dailyShiftData]);

  // Fetch contractor list for attendance filter and CL Addition Trend
  useEffect(() => {
    const fetchContractors = async () => {
      try {
        console.log('Fetching contractor list for filters...');
       
        // First try to get contractors from the contractors API
        const response = await fetch('/server/Contracters_function/contractors');
        const data = await response.json();
       
        console.log('Contractors API response:', data);
       
        let contractorNames = [];
       
        if (data.status === 'success' && data.data && data.data.contractors) {
          console.log('Contractor list fetched from API:', data.data.contractors);
          console.log('Sample contractor data:', data.data.contractors.slice(0, 3));
         
          // Extract contractor names from the contractor objects
          contractorNames = data.data.contractors.map(contractor =>
            contractor.ContractorName || contractor.OrganizationName || contractor.NameoftheSiteManager || contractor.NameofSiteIncharge || 'Unknown Contractor'
          ).filter(name => name && name !== 'Unknown Contractor');
         
          console.log('Extracted contractor names from API:', contractorNames);
        }
       
        // Also fetch contractors from employee data for real-time contractor list
        try {
          console.log('Fetching real-time contractor list from employee data...');
          const timestamp = new Date().getTime();
          const employeesResponse = await fetch(`/server/cms_function/employees?returnAll=true&_t=${timestamp}`, {
            method: 'GET',
            headers: {
              'Cache-Control': 'no-cache',
              'Pragma': 'no-cache'
            }
          });
          const employeesData = await employeesResponse.json();
         
          if (employeesData.status === 'success' && employeesData.data && employeesData.data.employees) {
            const employees = employeesData.data.employees;
            console.log(`📊 Total employees found for contractor list: ${employees.length}`);
           
            // Extract unique contractors from employee data
            const employeeContractors = [...new Set(
              employees
                .map(emp => emp.contractor)
                .filter(contractor => contractor && contractor.trim() !== '')
            )];
           
            console.log('🏢 Contractors from employee data:', employeeContractors);
            console.log('🔍 Contractors from API before merge:', contractorNames);
           
            // Merge with API contractors and remove duplicates with better deduplication
            const allContractors = [...contractorNames, ...employeeContractors];
            console.log('🔗 All contractors before deduplication:', allContractors);
           
            // Advanced deduplication: remove duplicates and similar names
            const uniqueContractors = [];
            allContractors.forEach(contractor => {
              if (!contractor || contractor.trim() === '') return;
             
              const normalizedContractor = contractor.trim();
              const isDuplicate = uniqueContractors.some(existing => {
                const normalizedExisting = existing.trim();
                // Check for exact match or if one contains the other (case insensitive)
                return normalizedExisting.toLowerCase() === normalizedContractor.toLowerCase() ||
                       normalizedExisting.toLowerCase().includes(normalizedContractor.toLowerCase()) ||
                       normalizedContractor.toLowerCase().includes(normalizedExisting.toLowerCase());
              });
             
              if (!isDuplicate) {
                uniqueContractors.push(normalizedContractor);
              }
            });
           
            contractorNames = uniqueContractors;
            console.log('✅ Final unique contractors after deduplication:', contractorNames);
          }
        } catch (employeeError) {
          console.warn('Could not fetch contractors from employee data:', employeeError);
        }
         
        console.log('Final contractor list for filters:', contractorNames);
        setContractorList(contractorNames);
      } catch (error) {
        console.error('Error fetching contractors:', error);
        setContractorList([]);
      }
    };

    fetchContractors();
  }, []);

  // Fetch shift list for shift filter
  useEffect(() => {
    const fetchShifts = async () => {
      try {
        console.log('Fetching shift list for shift filter...');
        const response = await fetch('/server/Shift_function/shifts');
        const data = await response.json();
       
        console.log('Shifts API response for shift filter:', data);
       
        if (data.status === 'success' && data.data && data.data.shifts) {
          const shifts = data.data.shifts.map(shift => shift.shiftName).filter(Boolean);
          const uniqueShifts = [...new Set(shifts)]; // Remove duplicates
          console.log('Shift list fetched for shift filter:', uniqueShifts);
          setShiftList(uniqueShifts);
        } else {
          console.log('No shifts found for shift filter');
          setShiftList([]);
        }
      } catch (error) {
        console.error('Error fetching shifts for shift filter:', error);
        setShiftList([]);
      }
    };

    fetchShifts();
  }, []);

  // Function to fetch employees under a specific contractor
  const fetchEmployeesByContractor = async (contractorName) => {
    try {
      console.log(`=== FETCHING EMPLOYEES FOR CONTRACTOR: ${contractorName} ===`);
      console.log('Making API call to: /server/cms_function/employees');
     
      const response = await fetch(`/server/cms_function/employees?userRole=${encodeURIComponent(userRole || '')}&userEmail=${encodeURIComponent(userEmail || '')}`);
      console.log('Response status:', response.status);
      console.log('Response ok:', response.ok);
     
      const data = await response.json();
      console.log('Raw API response:', data);
     
      // Check if response has the expected structure
      if (data.status === 'success' && data.data && data.data.employees) {
        const employees = data.data.employees;
        console.log('All employees fetched:', employees.length);
        console.log('Sample employee data structure:', employees[0]);
        console.log('All employee codes from employee management:', employees.map(emp => emp.employeeCode));
        console.log('Sample employee contractor data:', employees.slice(0, 5).map(emp => ({
          employeeCode: emp.employeeCode,
          contractor: emp.contractor,
          contractorName: emp.contractorName
        })));
       
        // Filter employees by contractor - use the correct field name 'contractor'
        const employeesUnderContractor = employees.filter(employee => {
          // Use the correct field name 'contractor' from the employee data structure
          const employeeContractor = employee.contractor;
         
          // More robust comparison with multiple fallback options
          let isMatch = false;
         
          if (employeeContractor && contractorName) {
            // Direct match
            isMatch = employeeContractor === contractorName;
           
            // Case-insensitive match
            if (!isMatch && typeof employeeContractor === 'string' && typeof contractorName === 'string') {
              isMatch = employeeContractor.toLowerCase().trim() === contractorName.toLowerCase().trim();
            }
           
            // Partial match (in case of slight variations)
            if (!isMatch && typeof employeeContractor === 'string' && typeof contractorName === 'string') {
              const empContractorLower = employeeContractor.toLowerCase().trim();
              const contractorNameLower = contractorName.toLowerCase().trim();
              isMatch = empContractorLower.includes(contractorNameLower) ||
                       contractorNameLower.includes(empContractorLower);
            }
          }
         
          if (isMatch) {
            console.log(`✓ Employee ${employee.employeeCode} belongs to contractor ${contractorName} (employee contractor: ${employeeContractor})`);
          } else {
            console.log(`✗ Employee ${employee.employeeCode} does not belong to contractor ${contractorName} (employee contractor: ${employeeContractor})`);
          }
         
          return isMatch;
        });
       
        console.log(`Found ${employeesUnderContractor.length} employees under contractor ${contractorName}`);
        console.log('Employee codes under contractor:', employeesUnderContractor.map(emp => emp.employeeCode));
       
        return employeesUnderContractor.map(emp => emp.employeeCode);
      } else {
        console.log('No employee data found - unexpected response structure');
        console.log('Response structure:', {
          status: data?.status,
          hasData: !!data?.data,
          hasEmployees: !!data?.data?.employees,
          dataKeys: data ? Object.keys(data) : 'data is null/undefined'
        });
        return [];
      }
    } catch (error) {
      console.error('Error fetching employees by contractor:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      return [];
    }
  };

  // Function to fetch contractor data for tooltip
  const fetchContractorDataForTooltip = async () => {
    try {
      console.log('Fetching contractor data for tooltip...');
      console.log('User role:', userRole, 'User email:', userEmail);
     
      // Fetch employees with proper user role and email parameters
      const response = await fetch(`/server/cms_function/employees?userRole=${encodeURIComponent(userRole || '')}&userEmail=${encodeURIComponent(userEmail || '')}&returnAll=true`);
      const data = await response.json();
     
      if (data.status === 'success' && data.data && data.data.employees) {
        const employees = data.data.employees;
        console.log('Fetched employees for tooltip:', employees.length, 'for user role:', userRole);
        console.log('Sample employee data structure:', employees[0]);
        console.log('Employee code fields available:', employees.slice(0, 3).map(emp => ({
          employeeCode: emp.employeeCode,
          EmployeeCode: emp.EmployeeCode,
          id: emp.id,
          allKeys: Object.keys(emp)
        })));
       
        // Filter to only active employees
        const activeEmployees = employees.filter(emp =>
          emp.employeeStatus === 'Active' || emp.EmployeeStatus === 'Active'
        );
        console.log('Active employees for tooltip:', activeEmployees.length, 'out of', employees.length);
       
        // Group active employees by contractor
        const contractorGroups = {};
        activeEmployees.forEach(employee => {
          const contractor = employee.contractor || employee.contractorName || 'Unknown';
          if (!contractorGroups[contractor]) {
            contractorGroups[contractor] = [];
          }
          contractorGroups[contractor].push({
            employeeCode: employee.employeeCode || employee.EmployeeCode || employee.id || 'N/A',
            employeeName: employee.employeeName || employee.EmployeeName || employee.name || 'N/A',
            contractor: contractor
          });
        });
       
        // Convert to array format for display
        const contractorData = Object.entries(contractorGroups).map(([contractorName, employees]) => ({
          contractorName,
          employeeCount: employees.length,
          employees: employees
        }));
       
        console.log('Contractor data for tooltip:', contractorData);
        console.log('Setting contractor data with length:', contractorData.length);
        setContractorEmployeeData(contractorData);
        return contractorData;
      } else {
        console.log('No employee data found for tooltip. Response:', data);
        // Check if it's a permission issue
        if (data.status === 'failure' && data.message && data.message.includes('permission')) {
          console.log('Permission denied for tooltip data');
        }
        setContractorEmployeeData([]);
        return [];
      }
    } catch (error) {
      console.error('Error fetching contractor data for tooltip:', error);
      setContractorEmployeeData([]);
      return [];
    }
  };

  // Function to handle contractor click for details
  const handleContractorDetailsClick = (contractor) => {
    setSelectedContractorForDetails(contractor);
    setContractorViewMode('employees');
    setShowAllEmployees(false);
  };

  // Function to go back to contractor overview
  const handleBackToContractorOverview = () => {
    setContractorViewMode('overview');
    setSelectedContractorForDetails(null);
    setShowAllEmployees(false);
  };

  // Function to handle Show All button
  const handleShowAllEmployees = () => {
    setShowAllEmployees(true);
  };

  // Function to close contractor tooltip
  const handleCloseContractorTooltip = () => {
    setShowContractorTooltip(false);
    setContractorViewMode('overview');
    setSelectedContractorForDetails(null);
    setShowAllEmployees(false);
  };

  // Function to fetch present employees data
  const fetchPresentEmployeesData = async () => {
    try {
      console.log('Fetching present employees data...');

      const today = new Date().toISOString().split('T')[0];
      const employeesWithFirstIN = new Set();
      // normalized employee id -> earliest FirstIN / latest LastOUT details
      const attendanceDetailsById = {};

      const upsertAttendanceDetail = (rawId, firstIn, lastOut, hours) => {
        const normalizedId = normalizeEmployeeId(rawId);
        if (!normalizedId) return;
        const trimmedFirstIn = String(firstIn || '').trim();
        if (!trimmedFirstIn) return;

        employeesWithFirstIN.add(String(rawId));
        const existing = attendanceDetailsById[normalizedId];
        if (!existing) {
          attendanceDetailsById[normalizedId] = {
            firstIn: trimmedFirstIn,
            lastOut: String(lastOut || '').trim() || 'Still Present',
            hours: hours || 'N/A'
          };
          return;
        }
        if (!existing.firstIn || trimmedFirstIn < existing.firstIn) {
          existing.firstIn = trimmedFirstIn;
        }
        const trimmedLastOut = String(lastOut || '').trim();
        if (trimmedLastOut && (!existing.lastOut || existing.lastOut === 'Still Present' || trimmedLastOut > existing.lastOut)) {
          existing.lastOut = trimmedLastOut;
        }
        if (hours && hours !== 'N/A') existing.hours = hours;
      };

      // 1) BHR / GetAttendanceList (same source as Present Today KPI)
      try {
        const attendanceResponse = await fetch(`/server/GetAttendanceList?startDate=${today}&endDate=${today}&summary=true`);
        const attendanceData = await attendanceResponse.json();

        if (attendanceData && attendanceData.data && attendanceData.data.length > 0) {
          attendanceData.data.forEach((record) => {
            const firstIn = record.FirstIN || record.FirstIn || record.firstIn || '';
            if (String(firstIn).trim()) {
              upsertAttendanceDetail(
                record.EmployeeID || record.EmployeeId || record.employeeId || record.EmployeeCode,
                firstIn,
                record.LastOUT || record.LastOut || record.lastOut || '',
                record.Hours || record.hours || 'N/A'
              );
            }
          });
        }
      } catch (apiError) {
        console.warn('Failed to fetch API attendance data:', apiError);
      }

      // 2) Attendance table (imported Excel on server)
      try {
        const importResponse = await fetch(`/server/importattendance_function/attendance?startDate=${today}&endDate=${today}&perPage=1000`);
        const importData = importResponse.ok ? await importResponse.json() : {};
        const importRecords = getAttendanceRecords(importData);
        importRecords.forEach((record) => {
          const employeeId = getAttendanceRecordEmployeeId(record);
          const firstIn = getAttendanceRecordFirstIn(record);
          if (employeeId && String(firstIn).trim()) {
            upsertAttendanceDetail(
              employeeId,
              firstIn,
              record.lastOut || record.LastOUT || record.LastOut || '',
              record.hours || record.Hours || record.TotalHours || 'N/A'
            );
          }
        });
      } catch (apiError) {
        console.warn('Failed to fetch Attendance table data for present employees:', apiError);
      }

      // 3) localStorage fallback (same as KPI — include records with FirstIN)
      try {
        const importedDataStr = localStorage.getItem('importedAttendanceData');
        if (importedDataStr) {
          const importedData = JSON.parse(importedDataStr) || [];
          const toYMD = (s) => {
            if (!s) return '';
            const m = String(s).match(/^(\d{2})-(\d{2})-(\d{4})$/);
            if (m) return `${m[3]}-${m[2]}-${m[1]}`;
            if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
            const d = new Date(s);
            return isNaN(d) ? '' : d.toISOString().slice(0, 10);
          };

          importedData.forEach((r) => {
            const empId = r.EmployeeID || r.EmployeeId || r.employeeId;
            const firstIn = r.FirstIN || r.FirstIn || r.firstIn || '';
            if (!empId || !String(firstIn).trim()) return;
            // Prefer today's rows when Date is present; otherwise keep (matches KPI fallback)
            const rowDate = toYMD(r.Date);
            if (rowDate && rowDate !== today) return;
            upsertAttendanceDetail(empId, firstIn, r.LastOUT || r.LastOut || r.lastOut || '', r.TotalHours || r.Hours || 'N/A');
          });
        }
      } catch (e) {
        console.warn('Failed to process imported Excel data:', e);
      }

      console.log('Total present attendance IDs found:', employeesWithFirstIN.size);

      // Same employee source as Absent tooltip / Present KPI matching
      const employeeResponse = await fetch(
        `/server/cms_function/employees?returnAll=true&userRole=${encodeURIComponent(userRole || '')}&userEmail=${encodeURIComponent(userEmail || '')}`
      );
      const employeeData = await employeeResponse.json();

      if (!(employeeData.status === 'success' && employeeData.data && employeeData.data.employees)) {
        console.log('No employee details found');
        setPresentEmployeesData([]);
        setContractorEmployeeCounts([]);
        return [];
      }

      const normalizedPresentIds = new Set(
        Array.from(employeesWithFirstIN).map(normalizeEmployeeId).filter(Boolean)
      );

      // Active employees only (same base as Total Employees card)
      const activeEmployees = employeeData.data.employees.filter(
        (emp) => emp.employeeStatus === 'Active' || emp.EmployeeStatus === 'Active'
      );

      // Match from active employee master → attendance
      const presentEmployees = activeEmployees.reduce((list, emp) => {
        const variants = getEmployeeIdVariants(emp);
        const matchedId = variants.find((id) => normalizedPresentIds.has(id));
        if (!matchedId) return list;

        // Keep Unknown so tooltip is not empty; UI labels Unknown as "Employees"
        const contractorName = emp.contractor || emp.contractorName || 'Unknown';
        const details = attendanceDetailsById[matchedId] || {};
        list.push({
          employeeCode: emp.employeeCode || emp.EmployeeCode || emp.id || 'N/A',
          employeeName: emp.employeeName || emp.EmployeeName || emp.name || 'N/A',
          firstIn: details.firstIn || '',
          lastOut: details.lastOut || 'Still Present',
          hours: details.hours || 'N/A',
          contractor: contractorName
        });
        return list;
      }, []);

      console.log('Present employees data:', presentEmployees.length);
      setPresentEmployeesData(presentEmployees);

      const contractorGroups = {};
      presentEmployees.forEach((emp) => {
        const contractor = emp.contractor || 'Unknown';
        if (!contractorGroups[contractor]) contractorGroups[contractor] = [];
        contractorGroups[contractor].push(emp);
      });

      const contractorCounts = Object.entries(contractorGroups).map(([contractorName, employees]) => ({
        contractorName,
        employeeCount: employees.length,
        employees
      }));

      setContractorEmployeeCounts(contractorCounts);
      console.log('Contractor employee counts:', contractorCounts);
      return presentEmployees;
    } catch (error) {
      console.error('Error fetching present employees data:', error);
      setPresentEmployeesData([]);
      setContractorEmployeeCounts([]);
      return [];
    }
  };

  // Function to handle contractor selection and switch to employee view
  const handleContractorClick = (contractorName) => {
    setSelectedPresentContractor(contractorName);
    setPresentViewMode('employees');
  };

  // Function to go back to contractor view
  const handleBackToContractors = () => {
    setPresentViewMode('contractors');
    setSelectedPresentContractor(null);
  };

  // Function to close present tooltip and reset view
  const handleClosePresentTooltip = () => {
    setShowPresentTooltip(false);
    setPresentViewMode('contractors');
    setSelectedPresentContractor(null);
  };

  // Function to fetch absent employees data
  const fetchAbsentEmployeesData = async () => {
    try {
      console.log('Fetching absent employees data...');
     
      const today = new Date().toISOString().split('T')[0];
      const employeesWithFirstIN = new Set();
     
      // Fetch attendance data for today from API
      try {
        const attendanceResponse = await fetch(`/server/GetAttendanceList?startDate=${today}&endDate=${today}&summary=true`);
        const attendanceData = await attendanceResponse.json();
       
        if (attendanceData && attendanceData.data && attendanceData.data.length > 0) {
          attendanceData.data.forEach(record => {
            if (record.FirstIN && record.FirstIN.trim() !== '') {
              employeesWithFirstIN.add(record.EmployeeID);
            }
          });
        }
      } catch (apiError) {
        console.warn('Failed to fetch API attendance data:', apiError);
      }

      // Fetch Attendance table data for today as well
      try {
        const importResponse = await fetch(`/server/importattendance_function/attendance?startDate=${today}&endDate=${today}&perPage=1000`);
        const importData = importResponse.ok ? await importResponse.json() : {};
        const importRecords = getAttendanceRecords(importData);
        if (importRecords.length > 0) {
          importRecords.forEach((record) => {
            const employeeId = getAttendanceRecordEmployeeId(record);
            const firstIn = getAttendanceRecordFirstIn(record);
            if (employeeId && firstIn && String(firstIn).trim() !== '') {
              employeesWithFirstIN.add(String(employeeId));
            }
          });
        }
      } catch (apiError) {
        console.warn('Failed to fetch Attendance table data for absent employees:', apiError);
      }

      // Process imported Excel data for today to identify present employees
      try {
        const importedDataStr = localStorage.getItem('importedAttendanceData');
        if (importedDataStr) {
          const importedData = JSON.parse(importedDataStr) || [];
          console.log('Found imported data for absent calc:', importedData.length, 'records');
         
          const toYMD = (s) => {
            if (!s) return '';
            const m = String(s).match(/^(\d{2})-(\d{2})-(\d{4})$/);
            if (m) return `${m[3]}-${m[2]}-${m[1]}`;
            if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
            const d = new Date(s);
            return isNaN(d) ? '' : d.toISOString().slice(0,10);
          };
         
          const todaysImported = importedData.filter(r => toYMD(r.Date) === today);
          console.log('Today\'s imported records for absent calc:', todaysImported.length);
         
          todaysImported.forEach(r => {
            const empId = r.EmployeeID || r.EmployeeId || r.employeeId;
            if (empId && r.FirstIN && String(r.FirstIN).trim() !== '') {
              employeesWithFirstIN.add(String(empId));
            }
          });
        }
      } catch (e) {
        console.warn('Failed to process imported data for absent calc:', e);
      }
     
      console.log('Total present employees found:', employeesWithFirstIN.size);
      console.log('Present employee IDs:', Array.from(employeesWithFirstIN));
       
      // Fetch all employees to get the complete list
      const employeeResponse = await fetch(`/server/cms_function/employees?returnAll=true&userRole=${encodeURIComponent(userRole || '')}&userEmail=${encodeURIComponent(userEmail || '')}`);
      const employeeData = await employeeResponse.json();
     
      if (employeeData.status === 'success' && employeeData.data && employeeData.data.employees) {
        // Active employees only (same base as Total Employees / Present Today)
        const activeEmployees = employeeData.data.employees.filter(
          (emp) => emp.employeeStatus === 'Active' || emp.EmployeeStatus === 'Active'
        );
        console.log('Active employees in system:', activeEmployees.length, 'of', employeeData.data.employees.length);
        console.log('DEBUG: Present employee IDs in set:', Array.from(employeesWithFirstIN));
        console.log('DEBUG: Sample employee data for matching:', activeEmployees.slice(0, 3).map(emp => ({
          employeeCode: emp.employeeCode,
          EmployeeCode: emp.EmployeeCode,
          id: emp.id,
          employeeName: emp.employeeName
        })));
       
        // Find absent among Active employees only (not in the present list)
        const normalizedPresentIds = new Set(
          Array.from(employeesWithFirstIN).map(normalizeEmployeeId).filter(Boolean)
        );
        const absentEmployees = activeEmployees.filter(emp => {
          const isPresent = getEmployeeIdVariants(emp).some((empId) => normalizedPresentIds.has(empId));
          if (!isPresent) {
            console.log('Absent employee found:', emp.employeeCode || emp.EmployeeCode || emp.id, emp.employeeName);
          }
          return !isPresent;
        }).map(emp => ({
          employeeCode: emp.employeeCode || emp.EmployeeCode || emp.id || 'N/A',
          employeeName: emp.employeeName || emp.EmployeeName || emp.name || 'N/A',
          contractor: emp.contractor || emp.contractorName || 'Unknown'
        }));
       
        console.log('Absent employees data:', absentEmployees);
        setAbsentEmployeesData(absentEmployees);
       
        // Group employees by contractor
        const contractorGroups = {};
        absentEmployees.forEach(emp => {
          const contractor = emp.contractor;
          if (!contractorGroups[contractor]) {
            contractorGroups[contractor] = [];
          }
          contractorGroups[contractor].push(emp);
        });
       
        // Create contractor count data
        const contractorCounts = Object.entries(contractorGroups).map(([contractorName, employees]) => ({
          contractorName,
          employeeCount: employees.length,
          employees: employees
        }));
       
        setAbsentContractorEmployeeCounts(contractorCounts);
        console.log('Absent contractor employee counts:', contractorCounts);
       
        return absentEmployees;
      } else {
        console.log('No employee details found');
        setAbsentEmployeesData([]);
        setAbsentContractorEmployeeCounts([]);
        return [];
      }
    } catch (error) {
      console.error('Error fetching absent employees data:', error);
      setAbsentEmployeesData([]);
      setAbsentContractorEmployeeCounts([]);
      return [];
    }
  };

  // Function to handle absent contractor selection and switch to employee view
  const handleAbsentContractorClick = (contractorName) => {
    setSelectedAbsentContractor(contractorName);
    setAbsentViewMode('employees');
  };

  // Function to go back to absent contractor view
  const handleBackToAbsentContractors = () => {
    setAbsentViewMode('contractors');
    setSelectedAbsentContractor(null);
  };

  // Function to close absent tooltip and reset view
  const handleCloseAbsentTooltip = () => {
    setShowAbsentTooltip(false);
    setAbsentViewMode('contractors');
    setSelectedAbsentContractor(null);
  };

  useEffect(() => {
    if (totalEmployees <= 0) return;
    fetchPresentEmployeesData();
    fetchAbsentEmployeesData();
  }, [totalEmployees]);

  // Fetch contractors for filter
  useEffect(() => {
    fetch('/server/Contracters_function/contractors')
      .then(res => res.json())
      .then(data => {
        console.log('Contractors API response:', data);
        if (data.status === 'success' && data.data && data.data.contractors) {
          const contractorNames = data.data.contractors.map(c => c.ContractorName).filter(Boolean);
          console.log('Extracted contractor names:', contractorNames);
          setContractors(['All', ...contractorNames]);
        } else {
          console.log('No contractors found in response');
          setContractors(['All']);
        }
      })
      .catch(err => {
        console.error('Failed to fetch contractors:', err);
        setContractors(['All']);
      });
  }, []);

  // Click outside handler for contractor dropdown and tooltips
  useEffect(() => {
    function handleClickOutside(event) {
      if (!event.target.closest('.dashboard-filter-icon-container')) {
        setShowContractorDropdown(false);
      }
      if (!event.target.closest('.contractor-tooltip') && !event.target.closest('.dashboard-stat-card')) {
        setShowContractorTooltip(false);
      }
      if (!event.target.closest('.present-tooltip') && !event.target.closest('.dashboard-stat-card')) {
        setShowPresentTooltip(false);
      }
      if (!event.target.closest('.absent-tooltip') && !event.target.closest('.dashboard-stat-card')) {
        setShowAbsentTooltip(false);
      }
      if (!event.target.closest('.misspunch-tooltip') && !event.target.closest('.dashboard-stat-card')) {
        setShowMissPunchTooltip(false);
      }
      if (!event.target.closest('.today-latein-tooltip') && !event.target.closest('.dashboard-stat-card')) {
        setShowTodayLateInTooltip(false);
      }
    }

    if (showContractorDropdown || showContractorTooltip || showPresentTooltip || showAbsentTooltip || showMissPunchTooltip || showTodayLateInTooltip) {
      document.addEventListener('mousedown', handleClickOutside);
    }
   
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showContractorDropdown, showContractorTooltip, showPresentTooltip, showAbsentTooltip, showMissPunchTooltip, showTodayLateInTooltip]);

  // Fetch total employee count
  useEffect(() => {
    fetch('/server/cms_function/employees?returnAll=true')
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success' && data.data && data.data.employees) {
          // Filter to only active employees
          const activeEmployees = data.data.employees.filter(emp =>
            emp.employeeStatus === 'Active' || emp.EmployeeStatus === 'Active'
          );
          setTotalEmployees(activeEmployees.length);
        }
      })
      .catch(err => {
        console.error('Failed to fetch employee count:', err);
        setTotalEmployees(0);
      });
  }, []);

  // Fetch today's attendance data from both BHR and Attendance tables
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format
   
    // Fetch data from both tables in parallel
    const fetchBHRData = fetch(`/server/GetAttendanceList?startDate=${today}&endDate=${today}&summary=true`)
      .then(res => res.json())
      .catch(err => {
        console.error('Failed to fetch BHR data:', err);
        return { data: [] };
      });

    const fetchAttendanceData = fetch(`/server/importattendance_function/attendance?startDate=${today}&endDate=${today}&perPage=1000`)
      .then(res => {
        if (!res.ok) return { data: { attendanceRecords: [] } };
        return res.json();
      })
      .catch(err => {
        console.error('Failed to fetch Attendance table data:', err);
        return { data: { attendanceRecords: [] } };
      });

    Promise.all([fetchBHRData, fetchAttendanceData])
      .then(([bhrData, attendanceData]) => {
        // Count employees who have FirstIN records (regardless of LastOUT or hours)
        const employeesWithFirstIN = new Set();
       
        // Add BHR table attendance records (real-time device data)
        if (bhrData && bhrData.data && bhrData.data.length > 0) {
          console.log('Dashboard: Found BHR data:', bhrData.data.length, 'records');
          bhrData.data.forEach(record => {
            if (record.FirstIN && record.FirstIN.trim() !== '') {
              employeesWithFirstIN.add(record.EmployeeID);
            }
          });
        }
       
        // Add Attendance table records (imported Excel data)
        console.log('Dashboard: Raw attendanceData response:', attendanceData);
        const attendanceRecords = getAttendanceRecords(attendanceData);
        if (attendanceRecords.length > 0) {
          console.log('Dashboard: Found Attendance table data:', attendanceRecords.length, 'records');
          attendanceRecords.forEach(record => {
            console.log('Dashboard: Processing record:', record);
            const firstIn = getAttendanceRecordFirstIn(record);
            const employeeId = getAttendanceRecordEmployeeId(record);
            if (firstIn && String(firstIn).trim() !== '') {
              console.log('Dashboard: Adding employee from Attendance table:', employeeId, 'with FirstIn:', firstIn);
              employeesWithFirstIN.add(employeeId);
            } else {
              console.log('Dashboard: Skipping record - no FirstIn or empty FirstIn:', employeeId, 'FirstIn:', firstIn);
            }
          });
        } else {
          console.log('Dashboard: No Attendance table data found');
          console.log('Dashboard: attendanceData structure:', {
            hasData: !!attendanceData,
            hasDataProperty: !!(attendanceData && attendanceData.data),
            hasAttendanceRecords: attendanceRecords.length > 0,
            recordsLength: attendanceRecords.length
          });
        }

        // Also check localStorage as fallback (for backward compatibility)
        const importedDataStr = localStorage.getItem('importedAttendanceData');
        if (importedDataStr) {
          try {
            const importedData = JSON.parse(importedDataStr);
            if (importedData && importedData.length > 0) {
              console.log('Dashboard: Found localStorage imported data:', importedData.length, 'records');
              importedData.forEach(record => {
                if (record.FirstIN && record.FirstIN.trim() !== '') {
                  console.log('Dashboard: Adding employee from localStorage:', record.EmployeeID);
                  employeesWithFirstIN.add(record.EmployeeID);
                }
              });
            }
          } catch (e) {
            console.error('Error parsing localStorage imported attendance data:', e);
          }
        }
         
        const presentCount = employeesWithFirstIN.size; // All employees who checked in (BHR + Attendance table + localStorage)
        console.log('Dashboard: Total present count:', presentCount);
         
        // Get total employee count for proper calculation
        fetch('/server/cms_function/employees?returnAll=true')
          .then(res => res.json())
          .then(empData => {
            if (empData.status === 'success' && empData.data && empData.data.employees) {
              const employees = empData.data.employees;
              // Filter to only active employees
              const activeEmployees = employees.filter(emp =>
                emp.employeeStatus === 'Active' || emp.EmployeeStatus === 'Active'
              );
              // Active only; include all contractors so Present + Absent = Total Active
              const filteredPresentCount = countMatchedPresentEmployees(activeEmployees, employeesWithFirstIN);
              const totalActive = activeEmployees.length;
              const actualAbsentCount = totalActive - filteredPresentCount;
     
              setTodayAttendance({
                present: filteredPresentCount,
                absent: Math.max(0, actualAbsentCount), // Ensure non-negative
                total: totalActive
              });
            } else {
              setTodayAttendance({
                present: presentCount,
                absent: 0,
                total: presentCount
              });
            }
          })
          .catch(err => {
            console.error('Failed to fetch employee count:', err);
            setTodayAttendance({
              present: presentCount,
              absent: 0,
              total: presentCount
            });
          });
      })
      .catch(err => {
        console.error('Failed to fetch attendance data:', err);
        setTodayAttendance({ present: 0, absent: 0, total: 0 });
      });
  }, []);

  // Auto-refresh attendance data on page load if imported data exists
  useEffect(() => {
    const importedDataStr = localStorage.getItem('importedAttendanceData');
    if (importedDataStr) {
      console.log('Dashboard: Found imported data on page load, auto-refreshing attendance');
      // Small delay to ensure all components are loaded
      setTimeout(() => {
        const today = new Date().toISOString().split('T')[0];
       
        // Fetch data from both tables in parallel
        const fetchBHRData = fetch(`/server/GetAttendanceList?startDate=${today}&endDate=${today}&summary=true`)
          .then(res => res.json())
          .catch(err => {
            console.error('Failed to fetch BHR data:', err);
            return { data: [] };
          });

        const fetchAttendanceData = fetch(`/server/importattendance_function/attendance?startDate=${today}&endDate=${today}&perPage=1000`)
          .then(res => {
            if (!res.ok) return { data: { attendanceRecords: [] } };
            return res.json();
          })
          .catch(err => {
            console.error('Failed to fetch Attendance table data:', err);
            return { data: { attendanceRecords: [] } };
          });

        Promise.all([fetchBHRData, fetchAttendanceData])
          .then(([bhrData, attendanceData]) => {
            const employeesWithFirstIN = new Set();
           
            // Add BHR table attendance records (real-time device data)
            if (bhrData && bhrData.data && bhrData.data.length > 0) {
              console.log('Dashboard (Auto): Found BHR data:', bhrData.data.length, 'records');
              bhrData.data.forEach(record => {
                if (record.FirstIN && record.FirstIN.trim() !== '') {
                  employeesWithFirstIN.add(record.EmployeeID);
                }
              });
            }
           
            // Add Attendance table records (imported Excel data)
            console.log('Dashboard (Auto): Raw attendanceData response:', attendanceData);
            const attendanceRecords = getAttendanceRecords(attendanceData);
            if (attendanceRecords.length > 0) {
              console.log('Dashboard (Auto): Found Attendance table data:', attendanceRecords.length, 'records');
              attendanceRecords.forEach(record => {
                console.log('Dashboard (Auto): Processing record:', record);
                const firstIn = getAttendanceRecordFirstIn(record);
                const employeeId = getAttendanceRecordEmployeeId(record);
                if (firstIn && String(firstIn).trim() !== '') {
                  console.log('Dashboard (Auto): Adding employee from Attendance table:', employeeId, 'with FirstIn:', firstIn);
                  employeesWithFirstIN.add(employeeId);
                } else {
                  console.log('Dashboard (Auto): Skipping record - no FirstIn or empty FirstIn:', employeeId, 'FirstIn:', firstIn);
                }
              });
            } else {
              console.log('Dashboard (Auto): No Attendance table data found');
              console.log('Dashboard (Auto): attendanceData structure:', {
                hasData: !!attendanceData,
                hasDataProperty: !!(attendanceData && attendanceData.data),
                hasAttendanceRecords: attendanceRecords.length > 0,
                recordsLength: attendanceRecords.length
              });
            }

            // Also check localStorage as fallback (for backward compatibility)
            try {
              const importedData = JSON.parse(importedDataStr);
              if (importedData && importedData.length > 0) {
                console.log('Dashboard (Auto): Found localStorage imported data:', importedData.length, 'records');
                importedData.forEach(record => {
                  if (record.FirstIN && record.FirstIN.trim() !== '') {
                    console.log('Dashboard (Auto): Adding employee from localStorage:', record.EmployeeID);
                    employeesWithFirstIN.add(record.EmployeeID);
                  }
                });
              }
            } catch (e) {
              console.error('Error parsing localStorage imported attendance data:', e);
            }
             
            const presentCount = employeesWithFirstIN.size; // All employees who checked in (BHR + Attendance table + localStorage)
            console.log('Dashboard (Auto): Total present count:', presentCount);
           
            // Get total employee count for proper calculation
            fetch('/server/cms_function/employees?returnAll=true')
              .then(res => res.json())
              .then(empData => {
                if (empData.status === 'success' && empData.data && empData.data.employees) {
                  const activeEmployees = empData.data.employees.filter(emp =>
                    emp.employeeStatus === 'Active' || emp.EmployeeStatus === 'Active'
                  );
                  const filteredPresentCount = countMatchedPresentEmployees(activeEmployees, employeesWithFirstIN);
                  const totalActive = activeEmployees.length;
                  const actualAbsentCount = totalActive - filteredPresentCount;
         
                  setTodayAttendance({
                    present: filteredPresentCount,
                    absent: Math.max(0, actualAbsentCount),
                    total: totalActive
                  });
                } else {
                  setTodayAttendance({
                    present: presentCount,
                    absent: 0,
                    total: presentCount
                  });
                }
              })
              .catch(err => {
                console.error('Failed to fetch employee count:', err);
                setTodayAttendance({
                  present: presentCount,
                  absent: 0,
                  total: presentCount
                });
              });
          })
          .catch(err => {
            console.error('Failed to fetch attendance data:', err);
            setTodayAttendance({ present: 0, absent: 0, total: 0 });
          });
      }, 1000); // 1 second delay
    }
  }, []);

  // Manual refresh function for attendance data
  const refreshAttendanceData = () => {
    console.log('Dashboard: Manual refresh triggered');
    const today = new Date().toISOString().split('T')[0];
   
    // Fetch data from both tables in parallel
    const fetchBHRData = fetch(`/server/GetAttendanceList?startDate=${today}&endDate=${today}&summary=true`)
      .then(res => res.json())
      .catch(err => {
        console.error('Failed to fetch BHR data:', err);
        return { data: [] };
      });

    const fetchAttendanceData = fetch(`/server/importattendance_function/attendance?startDate=${today}&endDate=${today}&perPage=1000`)
      .then(res => {
        if (!res.ok) return { data: { attendanceRecords: [] } };
        return res.json();
      })
      .catch(err => {
        console.error('Failed to fetch Attendance table data:', err);
        return { data: { attendanceRecords: [] } };
      });

    Promise.all([fetchBHRData, fetchAttendanceData])
      .then(([bhrData, attendanceData]) => {
        // Count employees who have FirstIN records (regardless of LastOUT or hours)
        const employeesWithFirstIN = new Set();
       
        // Add BHR table attendance records (real-time device data)
        if (bhrData && bhrData.data && bhrData.data.length > 0) {
          console.log('Dashboard (Manual): Found BHR data:', bhrData.data.length, 'records');
          bhrData.data.forEach(record => {
            if (record.FirstIN && record.FirstIN.trim() !== '') {
              employeesWithFirstIN.add(record.EmployeeID);
            }
          });
        }
       
        // Add Attendance table records (imported Excel data)
        console.log('Dashboard (Manual): Raw attendanceData response:', attendanceData);
        const attendanceRecords = getAttendanceRecords(attendanceData);
        if (attendanceRecords.length > 0) {
          console.log('Dashboard (Manual): Found Attendance table data:', attendanceRecords.length, 'records');
          attendanceRecords.forEach(record => {
            console.log('Dashboard (Manual): Processing record:', record);
            const firstIn = getAttendanceRecordFirstIn(record);
            const employeeId = getAttendanceRecordEmployeeId(record);
            if (firstIn && String(firstIn).trim() !== '') {
              console.log('Dashboard (Manual): Adding employee from Attendance table:', employeeId, 'with FirstIn:', firstIn);
              employeesWithFirstIN.add(employeeId);
            } else {
              console.log('Dashboard (Manual): Skipping record - no FirstIn or empty FirstIn:', employeeId, 'FirstIn:', firstIn);
            }
          });
        } else {
          console.log('Dashboard (Manual): No Attendance table data found');
          console.log('Dashboard (Manual): attendanceData structure:', {
            hasData: !!attendanceData,
            hasDataProperty: !!(attendanceData && attendanceData.data),
            hasAttendanceRecords: attendanceRecords.length > 0,
            recordsLength: attendanceRecords.length
          });
        }

        // Also check localStorage as fallback (for backward compatibility)
        const importedDataStr = localStorage.getItem('importedAttendanceData');
        if (importedDataStr) {
          try {
            const importedData = JSON.parse(importedDataStr);
            if (importedData && importedData.length > 0) {
              console.log('Dashboard (Manual): Found localStorage imported data:', importedData.length, 'records');
              importedData.forEach(record => {
                if (record.FirstIN && record.FirstIN.trim() !== '') {
                  console.log('Dashboard (Manual): Adding employee from localStorage:', record.EmployeeID);
                  employeesWithFirstIN.add(record.EmployeeID);
                }
              });
            }
          } catch (e) {
            console.error('Error parsing localStorage imported attendance data:', e);
          }
        }
         
        const presentCount = employeesWithFirstIN.size; // All employees who checked in (BHR + Attendance table + localStorage)
        console.log('Dashboard (Manual): Total present count:', presentCount);
       
        // Get total employee count for proper calculation
        fetch('/server/cms_function/employees?returnAll=true')
          .then(res => res.json())
          .then(empData => {
            if (empData.status === 'success' && empData.data && empData.data.employees) {
              const activeEmployees = empData.data.employees.filter(emp =>
                emp.employeeStatus === 'Active' || emp.EmployeeStatus === 'Active'
              );
              const filteredPresentCount = countMatchedPresentEmployees(activeEmployees, employeesWithFirstIN);
              const totalActive = activeEmployees.length;
              const actualAbsentCount = totalActive - filteredPresentCount;
     
              setTodayAttendance({
                present: filteredPresentCount,
                absent: Math.max(0, actualAbsentCount),
                total: totalActive
              });
            } else {
              setTodayAttendance({
                present: presentCount,
                absent: 0,
                total: presentCount
              });
            }
          })
          .catch(err => {
            console.error('Failed to fetch employee count:', err);
            setTodayAttendance({
              present: presentCount,
              absent: 0,
              total: presentCount
            });
          });
      })
      .catch(err => {
        console.error('Failed to fetch attendance data:', err);
        setTodayAttendance({ present: 0, absent: 0, total: 0 });
      });
  };

  // Listen for changes to imported attendance data
  useEffect(() => {
    const handleStorageChange = () => {
      // Refresh attendance data when imported data changes
      const today = new Date().toISOString().split('T')[0];
     
      // Fetch data from both tables in parallel
      const fetchBHRData = fetch(`/server/GetAttendanceList?startDate=${today}&endDate=${today}&summary=true`)
        .then(res => res.json())
        .catch(err => {
          console.error('Failed to fetch BHR data:', err);
          return { data: [] };
        });

    const fetchAttendanceData = fetch(`/server/importattendance_function/attendance?startDate=${today}&endDate=${today}&perPage=1000`)
      .then(res => {
        if (!res.ok) return { data: { attendanceRecords: [] } };
        return res.json();
      })
      .catch(err => {
        console.error('Failed to fetch Attendance table data:', err);
        return { data: { attendanceRecords: [] } };
      });

      Promise.all([fetchBHRData, fetchAttendanceData])
        .then(([bhrData, attendanceData]) => {
          // Count employees who have FirstIN records (regardless of LastOUT or hours)
          const employeesWithFirstIN = new Set();
         
          // Add BHR table attendance records (real-time device data)
          if (bhrData && bhrData.data && bhrData.data.length > 0) {
            console.log('Dashboard (Event): Found BHR data:', bhrData.data.length, 'records');
            bhrData.data.forEach(record => {
              if (record.FirstIN && record.FirstIN.trim() !== '') {
                employeesWithFirstIN.add(record.EmployeeID);
              }
            });
          }
         
          // Add Attendance table records (imported Excel data)
          console.log('Dashboard (Event): Raw attendanceData response:', attendanceData);
          const attendanceRecords = getAttendanceRecords(attendanceData);
          if (attendanceRecords.length > 0) {
            console.log('Dashboard (Event): Found Attendance table data:', attendanceRecords.length, 'records');
            attendanceRecords.forEach(record => {
              console.log('Dashboard (Event): Processing record:', record);
              const firstIn = getAttendanceRecordFirstIn(record);
              const employeeId = getAttendanceRecordEmployeeId(record);
              if (firstIn && String(firstIn).trim() !== '') {
                console.log('Dashboard (Event): Adding employee from Attendance table:', employeeId, 'with FirstIn:', firstIn);
                employeesWithFirstIN.add(employeeId);
              } else {
                console.log('Dashboard (Event): Skipping record - no FirstIn or empty FirstIn:', employeeId, 'FirstIn:', firstIn);
              }
            });
          } else {
            console.log('Dashboard (Event): No Attendance table data found');
            console.log('Dashboard (Event): attendanceData structure:', {
              hasData: !!attendanceData,
              hasDataProperty: !!(attendanceData && attendanceData.data),
              hasAttendanceRecords: attendanceRecords.length > 0,
              recordsLength: attendanceRecords.length
            });
          }

          // Also check localStorage as fallback (for backward compatibility)
          const importedDataStr = localStorage.getItem('importedAttendanceData');
          if (importedDataStr) {
            try {
              const importedData = JSON.parse(importedDataStr);
              if (importedData && importedData.length > 0) {
                console.log('Dashboard (Event): Found localStorage imported data:', importedData.length, 'records');
                importedData.forEach(record => {
                  if (record.FirstIN && record.FirstIN.trim() !== '') {
                    console.log('Dashboard (Event): Adding employee from localStorage:', record.EmployeeID);
                    employeesWithFirstIN.add(record.EmployeeID);
                  }
                });
              }
            } catch (e) {
              console.error('Error parsing localStorage imported attendance data:', e);
            }
          }
           
          const presentCount = employeesWithFirstIN.size; // All employees who checked in (BHR + Attendance table + localStorage)
          console.log('Dashboard (Event): Total present count:', presentCount);
         
          // Get total employee count for proper calculation
          fetch('/server/cms_function/employees?returnAll=true')
            .then(res => res.json())
            .then(empData => {
              if (empData.status === 'success' && empData.data && empData.data.employees) {
                const activeEmployees = empData.data.employees.filter(emp =>
                  emp.employeeStatus === 'Active' || emp.EmployeeStatus === 'Active'
                );
                const filteredPresentCount = countMatchedPresentEmployees(activeEmployees, employeesWithFirstIN);
                const totalActive = activeEmployees.length;
                const actualAbsentCount = totalActive - filteredPresentCount;
       
                setTodayAttendance({
                  present: filteredPresentCount,
                  absent: Math.max(0, actualAbsentCount),
                  total: totalActive
                });
              } else {
                setTodayAttendance({
                  present: presentCount,
                  absent: 0,
                  total: presentCount
                });
              }
            })
            .catch(err => {
              console.error('Failed to fetch employee count:', err);
              setTodayAttendance({
                present: presentCount,
                absent: 0,
                total: presentCount
              });
            });
         
          // Also refresh the present employees tooltip data
          fetchPresentEmployeesData();
        })
        .catch(err => {
          console.error('Failed to fetch attendance data:', err);
          setTodayAttendance({ present: 0, absent: 0, total: 0 });
        });
    };

    // Listen for localStorage changes
    window.addEventListener('storage', handleStorageChange);
   
    // Also listen for custom events (for same-tab updates)
    window.addEventListener('importedDataChanged', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('importedDataChanged', handleStorageChange);
    };
  }, []);

  // Fetch previous day Miss Punch list (yesterday's data; updates when you open the dashboard each day)
  useEffect(() => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const prevDate = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD

    let url = `/server/reports_function/misspunch?startDate=${prevDate}&endDate=${prevDate}`;
    if (userEmail) url += `&userEmail=${encodeURIComponent(userEmail)}`;
    if (userRole) url += `&userRole=${encodeURIComponent(userRole)}`;

    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        const list = data.data || [];
        setPrevDayMissPunchData(Array.isArray(list) ? list : []);
      })
      .catch((err) => {
        console.error('Failed to fetch previous day miss punch:', err);
        setPrevDayMissPunchData([]);
      });
  }, [userRole, userEmail]);

  // Fetch today's Late In list (daily date - today; used for card count and tooltip)
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    let url = `/server/reports_function/latein?startDate=${today}&endDate=${today}`;
    if (userEmail) url += `&userEmail=${encodeURIComponent(userEmail)}`;
    if (userRole) url += `&userRole=${encodeURIComponent(userRole)}`;
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        const list = data.data || [];
        setTodayLateInData(Array.isArray(list) ? list : []);
      })
      .catch((err) => {
        console.error('Failed to fetch today late in:', err);
        setTodayLateInData([]);
      });
  }, [userRole, userEmail]);

  // Fetch monthly attendance data for pie chart from muster reports
  useEffect(() => {
    const fetchMonthlyAttendance = async () => {
      try {
        setIsAttendanceLoading(true);
        console.log('Fetching monthly attendance for:', selectedMonth);
        const [year, month] = selectedMonth.split('-');
        const startDate = `${selectedMonth}-01`;
        const endDate = new Date(parseInt(year), parseInt(month), 0).toISOString().split('T')[0]; // Last day of month
       
        console.log('API Request:', { startDate, endDate });
        const response = await fetch(`/server/attendance_muster_function?startDate=${startDate}&endDate=${endDate}&source=both`);
        const data = await response.json();
       
        console.log('API Response:', data);
        console.log('Muster data length:', data?.muster?.length || 0);
        console.log('Sample muster data:', data?.muster?.slice(0, 2) || 'No data');
       
        if (data && data.muster && data.muster.length > 0) {
          let presentTotal = 0;
          let absentTotal = 0;
          // Employee-based: use all employees from muster (no contractor filter)
          const filteredEmployeeIndices = data.muster.map((_, index) => index);
          console.log('Including all employees (employee-based attendance):', filteredEmployeeIndices.length);
         
          // Count total present and absent from muster reports
          let statusCounts = { Present: 0, Absent: 0, 'Half Day Present': 0, Other: 0 };
         
          data.muster.forEach((employeeAttendance, empIndex) => {
            if (!filteredEmployeeIndices.includes(empIndex)) return;
            if (employeeAttendance && employeeAttendance.length > 0) {
              console.log(`Employee ${empIndex + 1} attendance:`, employeeAttendance.slice(0, 10)); // Show first 10 days
             
              // Count each day's status for this employee
              employeeAttendance.forEach((dayStatus, dayIndex) => {
                if (dayStatus === 'Present' || dayStatus === 'P') {
                  presentTotal += 1;
                  statusCounts.Present += 1;
                } else if (dayStatus === 'Absent' || dayStatus === 'A') {
                  absentTotal += 1;
                  statusCounts.Absent += 1;
                } else if (dayStatus === '0.5' || dayStatus === 0.5 || dayStatus === 'Half Day Present') {
                  // Half day present counts as 0.5 present and 0.5 absent
                  presentTotal += 0.5;
                  absentTotal += 0.5;
                  statusCounts['Half Day Present'] += 1;
                } else {
                  statusCounts.Other += 1;
                  console.log(`Unknown status: "${dayStatus}" for employee ${empIndex + 1}, day ${dayIndex + 1}`);
                }
              });
            }
          });
         
          console.log('Status counts breakdown:', statusCounts);
         
          // Calculate totals without half-day splitting
          let rawPresent = statusCounts.Present + statusCounts['Half Day Present'];
          let rawAbsent = statusCounts.Absent;
          let rawHalfDay = statusCounts['Half Day Present'];
         
          console.log('Raw counts (before half-day splitting):', {
            rawPresent,
            rawAbsent,
            rawHalfDay,
            total: rawPresent + rawAbsent + rawHalfDay
          });
         
          console.log('Monthly Attendance Totals from Muster:', { presentTotal, absentTotal });
         
          // Alternative calculation: treat half-day as full present
          let altPresentTotal = statusCounts.Present + statusCounts['Half Day Present'];
          let altAbsentTotal = statusCounts.Absent;
         
          console.log('Alternative calculation (half-day = full present):', {
            altPresentTotal,
            altAbsentTotal
          });
         
          const newPieData = [
            { name: 'Present', value: Math.round(presentTotal), color: '#4ECDC4' },
            { name: 'Absent', value: Math.round(absentTotal), color: '#FF6B6B' },
          ];
         
          console.log('Setting attendance pie data:', newPieData);
          setAttendancePieData(newPieData);
        } else {
          console.log('No attendance data found for the selected month');
          const emptyPieData = [
            { name: 'Present', value: 0, color: '#4ECDC4' },
            { name: 'Absent', value: 0, color: '#FF6B6B' },
          ];
          console.log('Setting empty attendance pie data:', emptyPieData);
          setAttendancePieData(emptyPieData);
        }
      } catch (err) {
        console.error('Failed to fetch monthly attendance:', err);
        setAttendancePieData([
          { name: 'Present', value: 0, color: '#4ECDC4' },
          { name: 'Absent', value: 0, color: '#FF6B6B' },
        ]);
      } finally {
        setIsAttendanceLoading(false);
      }
    };
   
    fetchMonthlyAttendance();
  }, [selectedMonth]);

  // Fetch last 7 days attendance trend data
  useEffect(() => {
    const fetchAttendanceTrend = async () => {
      try {
        setIsTrendLoading(true);
       
        // Calculate last 7 days
        const today = new Date();
        const last7Days = [];
        const trendData = [];
       
        for (let i = 6; i >= 0; i--) {
          const date = new Date(today);
          date.setDate(today.getDate() - i);
          const dateStr = date.toISOString().split('T')[0];
          const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
         
          last7Days.push({ date: dateStr, day: dayName });
        }
       
        console.log('Fetching attendance trend for last 7 days (employee-based):', last7Days);
       
        // Fetch attendance data for each day - all employees from muster (no contractor filter)
        const attendancePromises = last7Days.map(async ({ date, day }) => {
          try {
            const response = await fetch(`/server/attendance_muster_function?startDate=${date}&endDate=${date}&source=both`);
            const data = await response.json();
            let presentCount = 0;
            let totalEmployees = 0;
           
            if (data && data.muster && data.muster.length > 0) {
              totalEmployees = data.muster.length;
              data.muster.forEach((employeeAttendance) => {
                if (employeeAttendance && employeeAttendance.length > 0) {
                  const dayStatus = employeeAttendance[0];
                  if (dayStatus === 'Present' || dayStatus === 'P') presentCount += 1;
                }
              });
            }
           
            // Calculate percentage (present count / total employees * 100)
            const attendancePercentage = totalEmployees > 0 ? (presentCount / totalEmployees) * 100 : 0;
           
            console.log(`Day ${day}: Present: ${presentCount}, Total: ${totalEmployees}, Percentage: ${attendancePercentage.toFixed(2)}%`);
           
            return {
              day,
              present: Math.round(attendancePercentage * 100) / 100, // Round to 2 decimal places
              date: date,
              presentCount: presentCount,
              totalEmployees: totalEmployees
            };
          } catch (err) {
            console.error(`Failed to fetch attendance for ${date}:`, err);
            return { day, present: 0, date: date, presentCount: 0, totalEmployees: 0 };
          }
        });
       
        const results = await Promise.all(attendancePromises);
        console.log('Attendance trend results:', results);
       
        setAttendanceTrendData(results);
      } catch (err) {
        console.error('Failed to fetch attendance trend:', err);
        setAttendanceTrendData([]);
      } finally {
        setIsTrendLoading(false);
      }
    };
   
    fetchAttendanceTrend();
  }, [trendRefreshKey]);

  // Fetch shift distribution data (today's assignments from NewShiftMap) - only show shifts that exist in Shift_function
  useEffect(() => {
    const fetchShiftData = async () => {
      try {
        console.log('Fetching live shift distribution from NewShiftMap for today...');

        // 1) Get shifts from Shift_function - only these will be shown in Live Shift Distribution
        let shiftNamesFromDB = [];
        try {
          const shiftsRes = await fetch('/server/Shift_function/shifts');
          const shiftsJson = await shiftsRes.json();
          if (shiftsJson.status === 'success' && shiftsJson.data && shiftsJson.data.shifts) {
            shiftNamesFromDB = shiftsJson.data.shifts.map(s => (s.shiftName || s.ShiftName || '').trim()).filter(Boolean);
            shiftNamesFromDB = [...new Set(shiftNamesFromDB)];
            console.log('Shifts from Shift_function (will display in Live Shift Distribution):', shiftNamesFromDB);
          }
        } catch (e) {
          console.warn('Failed to fetch shifts from Shift_function:', e);
        }
        setDashboardShiftOrder(shiftNamesFromDB);

        // Today in YYYY-MM-DD
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const todayStr = `${year}-${month}-${day}`;

        const params = new URLSearchParams();
        params.set('startDate', todayStr);
        params.set('endDate', todayStr);
        if (userRole) params.set('userRole', userRole);
        if (userEmail) params.set('userEmail', userEmail);

        const res = await fetch(`/server/newshiftmap_function/newshiftmaps?${params.toString()}`);
        const data = await res.json();

        if (data.status !== 'success') {
          console.error('Failed to fetch NewShiftMap schedules:', data);
          setShiftDistribution({});
          return;
        }

        const schedules = (data.data && data.data.schedules) || [];
        console.log(`Fetched ${schedules.length} NewShiftMap schedules for ${todayStr}`);

        // Build distribution per shift type from today's schedules (only for shift types that exist in Shift_function)
        const distribution = {};

        schedules.forEach(schedule => {
          const shiftTypeRaw = schedule.shiftType || schedule.ShiftType;
          const shiftType = String(shiftTypeRaw || '').trim();
          if (!shiftType) return;
          if (shiftNamesFromDB.length > 0 && !shiftNamesFromDB.includes(shiftType)) return; // only count if shift is in Shift_function

          if (!distribution[shiftType]) {
            distribution[shiftType] = { assigned: 0, attended: 0, percentage: 0 };
          }

          distribution[shiftType].assigned += 1;
          distribution[shiftType].attended += 1;
        });

        // Ensure every shift from Shift_function appears (with 0 if not in schedules)
        shiftNamesFromDB.forEach(name => {
          if (!distribution[name]) {
            distribution[name] = { assigned: 0, attended: 0, percentage: 0 };
          }
        });

        // Keep only keys that are in Shift_function (in case we had no shift list and allowed all)
        const filteredDistribution = {};
        shiftNamesFromDB.forEach(name => {
          if (distribution[name]) filteredDistribution[name] = distribution[name];
        });
        if (shiftNamesFromDB.length === 0) {
          Object.assign(filteredDistribution, distribution);
        }

        // Calculate simple percentages (attended / assigned)
        Object.keys(filteredDistribution).forEach(shiftType => {
          const shift = filteredDistribution[shiftType];
          shift.percentage = shift.assigned > 0 ? Math.round((shift.attended / shift.assigned) * 100) : 0;
        });

        console.log('Live shift distribution from NewShiftMap (today):', filteredDistribution);
        setShiftDistribution(filteredDistribution);
      } catch (err) {
        console.error('Failed to fetch shift distribution from NewShiftMap:', err);
        setShiftDistribution({});
        setDashboardShiftOrder([]);
      }
    };

    fetchShiftData();
  }, [userRole, userEmail]);

  // Fetch daily shift data for last 7 days - Real-time data only, counting PRESENT employees in General shift
  useEffect(() => {
    const fetchDailyShiftData = async () => {
      try {
        setIsShiftDataLoading(true);
        console.log('🔄 Fetching real-time daily shift data for last 7 days...');
       
        // Calculate last 7 days including today
        const today = new Date();
       
        const targetDays = [];
       
        // Add last 7 days
        for (let i = 6; i >= 0; i--) {
          const date = new Date(today);
          date.setDate(date.getDate() - i);
          const dateStr = date.toISOString().split('T')[0];
          const dayName = i === 0 ? 'Today' : date.toLocaleDateString('en-US', { weekday: 'short' });
          targetDays.push({ date: dateStr, day: dayName });
        }
       
        console.log('📅 Target days (Last 7 days):', targetDays);
       
        // Preload employees for name mapping
        const empIdToName = {};
        const empIdToCode = {};
        try {
          const empRes = await fetch(`/server/cms_function/employees?returnAll=true&userRole=${encodeURIComponent(userRole || '')}&userEmail=${encodeURIComponent(userEmail || '')}`);
          const empJson = await empRes.json();
          if (empJson?.status === 'success' && empJson?.data?.employees) {
            for (const e of empJson.data.employees) {
              const code = e.employeeCode || e.EmployeeCode || e.EmployeeID || e.id;
              const name = e.employeeName || e.EmployeeName || e.name || '';
              const internalId = String(e.id || e.EmployeeID || e.EmployeeId || e.employeeId || e.EmployeeCode || code || '');
              if (code) empIdToName[String(code)] = name || String(code);
              if (internalId && code) empIdToCode[internalId] = String(code);
              if (code) empIdToCode[String(code)] = String(code); // self-map when we already have code
            }
          }
        } catch (e) {
          console.warn('⚠️ Failed to preload employees for name mapping:', e);
        }

        // Fetch shift and attendance data for each day using real-time data
        const dailyData = [];
       
        for (const { date, day } of targetDays) {
          try {
            console.log(`🔄 Fetching data for ${date} (${day})...`);
           
            // Fetch attendance using the same logic as dashboard "Present Today" count
            // This includes BHR table, Attendance table, and localStorage
            // IMPORTANT: Fetch attendance data independently, regardless of shiftmaps status
            const presentIds = new Set();
           
            // 1. Fetch from BHR table (GetAttendanceList) - same as dashboard
            try {
              const attRes = await fetch(`/server/GetAttendanceList?startDate=${date}&endDate=${date}&summary=true`);
              const attJson = await attRes.json();
              if (attJson?.data?.length) {
                for (const rec of attJson.data) {
                  const rawEid = String(rec.EmployeeID || rec.EmployeeId || rec.employeeId || rec.EmployeeCode || '');
                  const eid = empIdToCode[rawEid] || rawEid; // normalize to employeeCode when possible
                  const firstIn = rec.FirstIN || rec.FirstIn || rec.firstIn || '';
                  if (eid && firstIn && String(firstIn).trim() !== '') {
                    presentIds.add(eid);
                  }
                }
              }
            } catch (e) {
              console.warn(`⚠️ Failed to fetch BHR attendance for ${date}:`, e);
            }

            // 2. Fetch from Attendance table (importattendance_function) - same as dashboard
            try {
              const importRes = await fetch(`/server/importattendance_function/attendance?startDate=${date}&endDate=${date}&perPage=1000`);
              const importJson = importRes.ok ? await importRes.json() : { data: { attendanceRecords: [] } };
              if (importJson?.data?.attendanceRecords?.length) {
                for (const rec of importJson.data.attendanceRecords) {
                  const rawEid = String(rec.employeeId || rec.EmployeeID || rec.EmployeeId || rec.employeeCode || '');
                  const eid = empIdToCode[rawEid] || rawEid;
                  const firstIn = rec.firstIn || rec.FirstIN || rec.FirstIn || '';
                  if (eid && firstIn && String(firstIn).trim() !== '') {
                    presentIds.add(eid);
                  }
                }
              }
            } catch (e) {
              console.warn(`⚠️ Failed to fetch Attendance table data for ${date}:`, e);
            }

            // 3. Check localStorage as fallback (for backward compatibility) - same as dashboard
            const todayDate = new Date().toISOString().split('T')[0];
            if (date === todayDate) {
              try {
                const importedDataStr = localStorage.getItem('importedAttendanceData');
                if (importedDataStr) {
                  const importedData = JSON.parse(importedDataStr);
                  if (importedData && importedData.length > 0) {
                    for (const rec of importedData) {
                      const rawEid = String(rec.EmployeeID || rec.EmployeeId || rec.employeeId || rec.EmployeeCode || '');
                      const eid = empIdToCode[rawEid] || rawEid;
                      const firstIn = rec.FirstIN || rec.FirstIn || rec.firstIn || '';
                      if (eid && firstIn && String(firstIn).trim() !== '') {
                        presentIds.add(eid);
                      }
                    }
                  }
                }
              } catch (e) {
                console.warn(`⚠️ Failed to parse localStorage data for ${date}:`, e);
              }
            }

            // 4. Filter out employees with "Unknown" contractors - same as dashboard
            let filteredPresentIds = [];
            try {
              const empRes = await fetch(`/server/cms_function/employees?returnAll=true&userRole=${encodeURIComponent(userRole || '')}&userEmail=${encodeURIComponent(userEmail || '')}`);
              const empJson = await empRes.json();
              if (empJson?.status === 'success' && empJson?.data?.employees) {
                const employees = empJson.data.employees;
                const isKnownContractor = (contractorName) => {
                  const name = (contractorName || '').trim().toLowerCase();
                  return name && name !== 'unknown' && name !== 'unknown contractor';
                };
               
                filteredPresentIds = Array.from(presentIds).filter(empId => {
                  const match = employees.find(emp => (
                    emp.employeeCode === empId ||
                    emp.employeeCode === String(empId) ||
                    emp.EmployeeCode === empId ||
                    emp.EmployeeCode === String(empId) ||
                    emp.id === empId ||
                    emp.id === String(empId)
                  ));
                  return match && isKnownContractor(match.contractor || match.contractorName);
                });
              } else {
                // If employee data fetch fails, use all present IDs
                filteredPresentIds = Array.from(presentIds);
              }
            } catch (e) {
              console.warn(`⚠️ Failed to filter by contractor for ${date}:`, e);
              // If filtering fails, use all present IDs
              filteredPresentIds = Array.from(presentIds);
            }

            // Fetch shiftmap data for this date to get assigned shifts
            const dailyDistribution = {};
            const presentByShift = {};
           
            try {
              const shiftmapsRes = await fetch(`/server/Shiftmap_function/shiftmaps?date=${date}`);
              const shiftmapsJson = await shiftmapsRes.json();
             
              if (shiftmapsJson?.status === 'success' && shiftmapsJson?.data?.shiftmaps) {
                const shiftmaps = shiftmapsJson.data.shiftmaps || [];
               
                // Create mapping: employeeCode -> assignedShift
                // shiftmap stores employeeId (internal ID), but we need to match by employeeCode
                const shiftMapByCode = {}; // employeeCode -> assignedShift
               
                // Map employees to their assigned shifts for this date
                shiftmaps.forEach(mapping => {
                  const empInternalId = String(mapping.employeeId || '');
                  const assignedShift = String(mapping.assignedShift || 'General').trim();
                  const fromDate = mapping.fromdate;
                  const toDate = mapping.todate;
                 
                  // Check if this mapping covers the current date
                  let shouldInclude = false;
                  if (fromDate && toDate) {
                    const currentDate = new Date(date);
                    const startDate = new Date(fromDate);
                    const endDate = new Date(toDate);
                   
                    if (currentDate >= startDate && currentDate <= endDate) {
                      shouldInclude = true;
                    }
                  } else {
                    // If no date range, use the mapping
                    shouldInclude = true;
                  }
                 
                  if (shouldInclude && empInternalId) {
                    // Convert employeeId (internal ID) to employeeCode using empIdToCode mapping
                    const empCode = empIdToCode[empInternalId] || empInternalId;
                    // Store with both internal ID and code for matching
                    shiftMapByCode[empCode] = assignedShift;
                    shiftMapByCode[empInternalId] = assignedShift; // Also store by internal ID
                  }
                });
               
                // Count present employees by their assigned shift
                filteredPresentIds.forEach(empCode => {
                  // Try to find assigned shift by employee code
                  const assignedShift = shiftMapByCode[empCode] || shiftMapByCode[String(empCode)] || 'General';
                 
                  if (!dailyDistribution[assignedShift]) {
                    dailyDistribution[assignedShift] = 0;
                    presentByShift[assignedShift] = [];
                  }
                 
                  dailyDistribution[assignedShift]++;
                  const empName = empIdToName[empCode] || empCode;
                  presentByShift[assignedShift].push(empName);
                });
               
                console.log(`📈 Present employees on ${day} (${date}) by shift:`, dailyDistribution);
              } else {
                // Fallback: if shiftmap fetch fails, use General for all
                const generalCount = filteredPresentIds.length;
                dailyDistribution['General'] = generalCount;
                presentByShift['General'] = filteredPresentIds.map(eid => empIdToName[eid] || eid);
                console.log(`📈 Present employees on ${day} (${date}):`, generalCount, '(fallback to General - shiftmap fetch failed)');
              }
            } catch (shiftErr) {
              console.warn(`⚠️ Failed to fetch shiftmap data for ${date}:`, shiftErr);
              // Fallback: use General for all if shiftmap fetch fails
              const generalCount = filteredPresentIds.length;
              dailyDistribution['General'] = generalCount;
              presentByShift['General'] = filteredPresentIds.map(eid => empIdToName[eid] || eid);
              console.log(`📈 Present employees on ${day} (${date}):`, generalCount, '(fallback to General - shiftmap error)');
            }

            // Always push data, even if count is 0
            dailyData.push({
              date: day,
              shifts: dailyDistribution,
              presentEmployees: presentByShift
            });
          } catch (err) {
            console.error(`❌ Failed to fetch data for ${date}:`, err);
            // Even on error, push empty data structure so chart can render
            dailyData.push({
              date: day,
              shifts: { General: 0 },
              presentEmployees: { General: [] }
            });
          }
        }
       
        console.log('📊 Final daily shift data (real-time only):', dailyData);
          setDailyShiftData(dailyData);
          setIsShiftDataLoading(false);
       
      } catch (err) {
        console.error('❌ Failed to fetch daily shift data:', err);
        setIsShiftDataLoading(false);
        // Even on error, ensure we have structure for all 7 days with 0 values
        const today = new Date();
        const errorData = [];
        for (let i = 6; i >= 0; i--) {
          const date = new Date(today);
          date.setDate(date.getDate() - i);
          const dayName = i === 0 ? 'Today' : date.toLocaleDateString('en-US', { weekday: 'short' });
          errorData.push({
            date: dayName,
            shifts: { General: 0 },
            presentEmployees: { General: [] }
          });
        }
        setDailyShiftData(errorData);
      }
    };
   
    fetchDailyShiftData();
  }, [userRole, userEmail, shiftDataRefreshKey]);

  // Auto-refresh shift data every 5 minutes to ensure real-time data
  useEffect(() => {
    const fetchDailyShiftData = async () => {
      try {
        console.log('🔄 Auto-refreshing shift data for real-time updates...');
       
        // Calculate last 7 days including today
        const today = new Date();
        const targetDays = [];
        for (let i = 6; i >= 0; i--) {
          const date = new Date(today);
          date.setDate(date.getDate() - i);
          const dateStr = date.toISOString().split('T')[0];
          const dayName = i === 0 ? 'Today' : date.toLocaleDateString('en-US', { weekday: 'short' });
          targetDays.push({ date: dateStr, day: dayName });
        }
       
        // Preload employees for name mapping
        const empIdToName = {};
        const empIdToCode = {};
        try {
          const empRes = await fetch(`/server/cms_function/employees?returnAll=true&userRole=${encodeURIComponent(userRole || '')}&userEmail=${encodeURIComponent(userEmail || '')}`);
          const empJson = await empRes.json();
          if (empJson?.status === 'success' && empJson?.data?.employees) {
            for (const e of empJson.data.employees) {
              const code = e.employeeCode || e.EmployeeCode || e.EmployeeID || e.id;
              const name = e.employeeName || e.EmployeeName || e.name || '';
              const internalId = String(e.id || e.EmployeeID || e.EmployeeId || e.employeeId || e.EmployeeCode || code || '');
              if (code) empIdToName[String(code)] = name || String(code);
              if (internalId && code) empIdToCode[internalId] = String(code);
              if (code) empIdToCode[String(code)] = String(code);
            }
          }
        } catch (e) {
          console.warn('⚠️ Failed to preload employees for name mapping:', e);
        }

        const dailyData = [];
        for (const { date, day } of targetDays) {
          try {
            const presentIds = new Set();
           
            // 1. Fetch from BHR table
            try {
              const attRes = await fetch(`/server/GetAttendanceList?startDate=${date}&endDate=${date}&summary=true`);
              const attJson = await attRes.json();
              if (attJson?.data?.length) {
                for (const rec of attJson.data) {
                  const rawEid = String(rec.EmployeeID || rec.EmployeeId || rec.employeeId || rec.EmployeeCode || '');
                  const eid = empIdToCode[rawEid] || rawEid;
                  const firstIn = rec.FirstIN || rec.FirstIn || rec.firstIn || '';
                  if (eid && firstIn && String(firstIn).trim() !== '') {
                    presentIds.add(eid);
                  }
                }
              }
            } catch (e) {
              console.warn(`⚠️ Failed to fetch BHR attendance for ${date}:`, e);
            }

            // 2. Fetch from Attendance table
            try {
              const importRes = await fetch(`/server/importattendance_function/attendance?startDate=${date}&endDate=${date}&perPage=1000`);
              const importJson = importRes.ok ? await importRes.json() : { data: { attendanceRecords: [] } };
              if (importJson?.data?.attendanceRecords?.length) {
                for (const rec of importJson.data.attendanceRecords) {
                  const rawEid = String(rec.employeeId || rec.EmployeeID || rec.EmployeeId || rec.employeeCode || '');
                  const eid = empIdToCode[rawEid] || rawEid;
                  const firstIn = rec.firstIn || rec.FirstIN || rec.FirstIn || '';
                  if (eid && firstIn && String(firstIn).trim() !== '') {
                    presentIds.add(eid);
                  }
                }
              }
            } catch (e) {
              console.warn(`⚠️ Failed to fetch Attendance table data for ${date}:`, e);
            }

            // 3. Check localStorage for today
            const todayDate = new Date().toISOString().split('T')[0];
            if (date === todayDate) {
              try {
                const importedDataStr = localStorage.getItem('importedAttendanceData');
                if (importedDataStr) {
                  const importedData = JSON.parse(importedDataStr);
                  if (importedData && importedData.length > 0) {
                    for (const rec of importedData) {
                      const rawEid = String(rec.EmployeeID || rec.EmployeeId || rec.employeeId || rec.EmployeeCode || '');
                      const eid = empIdToCode[rawEid] || rawEid;
                      const firstIn = rec.FirstIN || rec.FirstIn || rec.firstIn || '';
                      if (eid && firstIn && String(firstIn).trim() !== '') {
                        presentIds.add(eid);
                      }
                    }
                  }
                }
              } catch (e) {
                console.warn(`⚠️ Failed to parse localStorage data for ${date}:`, e);
              }
            }

            // 4. Filter out employees with "Unknown" contractors
            let filteredPresentIds = [];
            try {
              const empRes = await fetch(`/server/cms_function/employees?returnAll=true&userRole=${encodeURIComponent(userRole || '')}&userEmail=${encodeURIComponent(userEmail || '')}`);
              const empJson = await empRes.json();
              if (empJson?.status === 'success' && empJson?.data?.employees) {
                const employees = empJson.data.employees;
                const isKnownContractor = (contractorName) => {
                  const name = (contractorName || '').trim().toLowerCase();
                  return name && name !== 'unknown' && name !== 'unknown contractor';
                };
               
                filteredPresentIds = Array.from(presentIds).filter(empId => {
                  const match = employees.find(emp => (
                    emp.employeeCode === empId ||
                    emp.employeeCode === String(empId) ||
                    emp.EmployeeCode === empId ||
                    emp.EmployeeCode === String(empId) ||
                    emp.id === empId ||
                    emp.id === String(empId)
                  ));
                  return match && isKnownContractor(match.contractor || match.contractorName);
                });
              } else {
                filteredPresentIds = Array.from(presentIds);
              }
            } catch (e) {
              filteredPresentIds = Array.from(presentIds);
            }

            const generalIds = filteredPresentIds;
            const generalCount = generalIds.length;
            const dailyDistribution = { General: generalCount };
            const presentByShift = { General: generalIds.map(eid => empIdToName[eid] || eid) };

            dailyData.push({
              date: day,
              shifts: dailyDistribution,
              presentEmployees: presentByShift
            });
          } catch (err) {
            console.error(`❌ Failed to fetch data for ${date}:`, err);
            dailyData.push({
              date: day,
              shifts: { General: 0 },
              presentEmployees: { General: [] }
            });
          }
        }
       
        console.log('📊 Auto-refreshed daily shift data:', dailyData);
        setDailyShiftData(dailyData);
      } catch (err) {
        console.error('❌ Failed to auto-refresh daily shift data:', err);
      }
    };

    const interval = setInterval(fetchDailyShiftData, 5 * 60 * 1000); // 5 minutes
    return () => clearInterval(interval);
  }, [userRole, userEmail]);

  // Test function to verify month calculation
  const testMonthCalculation = () => {
    const today = new Date();
    console.log(`🧪 Testing month calculation for current date: ${today.toDateString()}`);
   
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const monthName = date.toLocaleDateString('en-US', { month: 'short' });
      const monthKey = date.toISOString().slice(0, 7);
     
      months.push({
        month: monthName,
        monthKey: monthKey,
        year: date.getFullYear(),
        monthNum: date.getMonth() + 1
      });
     
      console.log(`🧪 Month ${i}: ${monthName} ${date.getFullYear()} (${monthKey})`);
    }
   
    return months;
  };

  // Fetch CL Addition Trend data based on employee joining dates - Real-time data
  // Helper function to parse employee joining dates consistently
  const parseEmployeeJoiningDate = (dateOfJoining) => {
    if (!dateOfJoining) return null;
   
    let joiningDate;
    if (typeof dateOfJoining === 'string') {
      joiningDate = new Date(dateOfJoining);
     
      // If the date is invalid, try parsing as timestamp
      if (isNaN(joiningDate.getTime())) {
        const timestamp = parseInt(dateOfJoining);
        if (!isNaN(timestamp)) {
          joiningDate = new Date(timestamp);
        }
      }
    } else if (dateOfJoining instanceof Date) {
      joiningDate = dateOfJoining;
    } else {
      return null;
    }
   
    // Check if the date is valid
    if (isNaN(joiningDate.getTime())) {
      return null;
    }
   
    return joiningDate;
  };

  // Helper function to get employees for a specific month with consistent filtering
  const getEmployeesForMonth = (employees, targetMonth, targetYear, contractorFilter = 'all') => {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthIndex = monthNames.indexOf(targetMonth);
    const monthNum = monthIndex + 1;
   
    return employees.filter(emp => {
      if (!emp.dateOfJoining) return false;
     
      const joinDate = parseEmployeeJoiningDate(emp.dateOfJoining);
      if (!joinDate) return false;
     
      const joinYear = joinDate.getFullYear();
      const joinMonth = joinDate.getMonth() + 1;
     
      // Check if employee joined in the target month and year
      const isTargetMonth = joinYear === targetYear && joinMonth === monthNum;
     
      // Apply contractor filter if not 'all'
      const contractorMatch = contractorFilter === 'all' ||
        (emp.contractor && emp.contractor.toLowerCase().includes(contractorFilter.toLowerCase()));
     
      return isTargetMonth && contractorMatch;
    });
  };

  const fetchClAdditionTrend = async (contractorFilter = 'all') => {
    try {
      setIsClAdditionLoading(true);
      console.log('🔄 Fetching REAL-TIME CL Addition Trend data for contractor:', contractorFilter);
     
      // Test month calculation first
      testMonthCalculation();
     
      // Get current date and calculate last 6 months dynamically
      const today = new Date();
      const months = [];
     
      console.log(`📅 Current date: ${today.toDateString()}`);
      console.log(`📅 Current month: ${today.getMonth() + 1}, Year: ${today.getFullYear()}`);
     
      for (let i = 5; i >= 0; i--) {
        const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const monthName = date.toLocaleDateString('en-US', { month: 'short' });
        const monthKey = date.toISOString().slice(0, 7); // YYYY-MM format
       
        months.push({
          month: monthName,
          monthKey: monthKey,
          year: date.getFullYear(),
          monthNum: date.getMonth() + 1
        });
       
        console.log(`📅 Month ${i}: ${monthName} ${date.getFullYear()} (${monthKey})`);
      }
     
      console.log('📊 Fetching LIVE employee data for CL Addition Trend...');
      // Add timestamp to prevent caching and ensure real-time data
      const timestamp = new Date().getTime();
      const response = await fetch(`/server/cms_function/employees?returnAll=true&_t=${timestamp}`, {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      const data = await response.json();
     
      console.log('✅ CL Addition API response (REAL-TIME):', data);
     
      if (data.status === 'success' && data.data && data.data.employees) {
        const employees = data.data.employees;
        console.log(`📈 Total employees found for addition trend: ${employees.length} (LIVE DATA)`);
       
        // Debug: Show sample employee data structure
        if (employees.length > 0) {
          console.log('📋 Sample employee data structure:', {
            dateOfJoining: employees[0].dateOfJoining,
            contractor: employees[0].contractor,
            employeeName: employees[0].employeeName,
            employeeCode: employees[0].employeeCode
          });
         
          // Show employees with joining dates
          const employeesWithJoiningDates = employees.filter(emp => emp.dateOfJoining);
          console.log(`📅 Employees with joining dates: ${employeesWithJoiningDates.length}/${employees.length}`);
         
          if (employeesWithJoiningDates.length > 0) {
            console.log('📅 Sample joining dates:', employeesWithJoiningDates.slice(0, 5).map(emp => ({
              employeeName: emp.employeeName,
              dateOfJoining: emp.dateOfJoining,
              contractor: emp.contractor
            })));
          }
        }
       
        // Filter employees by contractor if not 'all'
        let filteredEmployees = employees;
        if (contractorFilter !== 'all') {
          filteredEmployees = employees.filter(employee =>
            employee.contractor && employee.contractor.toLowerCase().includes(contractorFilter.toLowerCase())
          );
          console.log(`🎯 Filtered employees for contractor ${contractorFilter}: ${filteredEmployees.length}`);
        }
       
        // Initialize monthly counts with contractor breakdown
        const monthlyCounts = {};
        const contractorBreakdown = {};
       
        months.forEach(({ month, monthKey }) => {
          monthlyCounts[month] = {
            count: 0,
            monthKey,
            contractors: {}
          };
        });
       
        // Count employees who joined in each month using unified function (REAL-TIME DATA)
        let totalProcessed = 0;
        let totalMatched = 0;
        let invalidDates = 0;
       
        // Use the current year for all calculations
        const currentYear = new Date().getFullYear();
       
        months.forEach(({ month, monthKey }) => {
          // Get employees for this specific month using unified function
          const monthEmployees = getEmployeesForMonth(filteredEmployees, month, currentYear, contractorFilter);
         
          console.log(`📊 ${month} ${currentYear}: Found ${monthEmployees.length} employees using unified function`);
         
          // Update monthly count
          monthlyCounts[month].count = monthEmployees.length;
         
          // Update contractor breakdown for this month
          const monthContractorBreakdown = {};
          monthEmployees.forEach(emp => {
            const contractorName = emp.contractor || 'No Contractor';
            monthContractorBreakdown[contractorName] = (monthContractorBreakdown[contractorName] || 0) + 1;
           
            // Update overall contractor breakdown
            if (!contractorBreakdown[contractorName]) {
              contractorBreakdown[contractorName] = 0;
            }
            contractorBreakdown[contractorName]++;
           
            totalMatched++;
            console.log(`👤 Employee joined in ${month}: ${emp.employeeName || emp.employeeCode} (${contractorName}) - ${emp.dateOfJoining} - LIVE DATA`);
          });
         
          monthlyCounts[month].contractors = monthContractorBreakdown;
        });
       
        console.log(`📊 Processing summary: ${totalProcessed} employees with joining dates, ${totalMatched} matched to last 6 months, ${invalidDates} invalid dates`);
       
        // Convert to chart data format with contractor breakdown
        const trendData = months.map(({ month }) => ({
          month: month,
          value: monthlyCounts[month].count,
          target: 15, // Set a target of 15 employees per month
          lastUpdated: new Date().toISOString(),
          isRealTime: true,
          contractorBreakdown: monthlyCounts[month].contractors
        }));
       
        console.log('🚀 CL Addition Trend data (REAL-TIME):', trendData);
        console.log('📊 Monthly counts breakdown:', monthlyCounts);
        console.log('📊 Contractor Breakdown (REAL-TIME):', contractorBreakdown);
       
        // Debug specific month data
        const mayData = monthlyCounts['May'];
        if (mayData) {
          console.log('🔍 May data breakdown:', {
            count: mayData.count,
            contractors: mayData.contractors
          });
        }
        setClAdditionTrendData(trendData);
        setContractorBreakdownData(contractorBreakdown);
      } else {
        console.log('⚠️ No employee data found for addition trend, using sample data');
        // Fallback to sample data if no real data
        const sampleData = months.map(({ month }) => ({
          month: month,
          value: Math.floor(Math.random() * 20) + 5,
          target: 15,
          lastUpdated: new Date().toISOString(),
          isRealTime: false,
          note: 'Sample data - no real employee data available'
        }));
        setClAdditionTrendData(sampleData);
      }
    } catch (err) {
      console.error('❌ Failed to fetch CL Addition Trend data:', err);
      // Fallback to sample data on error
      const sampleData = [
        { month: 'Jan', value: 12, target: 15, lastUpdated: new Date().toISOString(), isRealTime: false, note: 'Sample data - API error' },
        { month: 'Feb', value: 18, target: 15, lastUpdated: new Date().toISOString(), isRealTime: false, note: 'Sample data - API error' },
        { month: 'Mar', value: 8, target: 15, lastUpdated: new Date().toISOString(), isRealTime: false, note: 'Sample data - API error' },
        { month: 'Apr', value: 22, target: 15, lastUpdated: new Date().toISOString(), isRealTime: false, note: 'Sample data - API error' },
        { month: 'May', value: 16, target: 15, lastUpdated: new Date().toISOString(), isRealTime: false, note: 'Sample data - API error' },
        { month: 'Jun', value: 25, target: 15, lastUpdated: new Date().toISOString(), isRealTime: false, note: 'Sample data - API error' },
      ];
      setClAdditionTrendData(sampleData);
    } finally {
      setIsClAdditionLoading(false);
    }
  };


  // Fetch Late In Report week-wise (Monday–Sunday) for current calendar month only (line chart)
  const fetchLateInTrend = async () => {
    try {
      setIsLateInTrendLoading(true);
      const today = new Date();
      const year = today.getFullYear();
      const month = today.getMonth();
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const startDate = firstDay.toISOString().split('T')[0];
      const endDate = lastDay.toISOString().split('T')[0];
      let url = `/server/reports_function/latein?startDate=${startDate}&endDate=${endDate}&grace=10`;
      if (userEmail) url += `&userEmail=${encodeURIComponent(userEmail)}`;
      if (userRole) url += `&userRole=${encodeURIComponent(userRole)}`;
      const res = await fetch(url);
      const json = await res.json();
      const rows = Array.isArray(json.data) ? json.data : [];
      // Build weeks (Mon–Sun) that fall within current month: from Monday of week containing 1st to last week that overlaps month
      const toMonday = (firstDay.getDay() + 6) % 7;
      const weekStart = new Date(firstDay);
      weekStart.setDate(firstDay.getDate() - toMonday);
      const weeks = [];
      let mon = new Date(weekStart);
      while (mon <= lastDay) {
        const sun = new Date(mon);
        sun.setDate(mon.getDate() + 6);
        if (sun < firstDay) { mon.setDate(mon.getDate() + 7); continue; }
        const monStr = mon.toISOString().split('T')[0];
        const sunStr = sun.toISOString().split('T')[0];
        const monLabel = `${mon.toLocaleDateString('en-US', { weekday: 'short' })} ${mon.getDate()} ${mon.toLocaleDateString('en-US', { month: 'short' })}`;
        const sunLabel = `${sun.toLocaleDateString('en-US', { weekday: 'short' })} ${sun.getDate()} ${sun.toLocaleDateString('en-US', { month: 'short' })}`;
        weeks.push({ weekLabel: `${monLabel} - ${sunLabel}`, startStr: monStr, endStr: sunStr, value: 0 });
        mon.setDate(mon.getDate() + 7);
      }
      rows.forEach((row) => {
        const d = (row.date || '').toString().slice(0, 10);
        if (!d) return;
        const w = weeks.find((wk) => d >= wk.startStr && d <= wk.endStr);
        if (w) w.value += 1;
      });
      setLateInTrendData(weeks.map((w) => ({ weekLabel: w.weekLabel, value: w.value })));
    } catch (err) {
      console.error('Failed to fetch Late In trend:', err);
      setLateInTrendData([]);
    } finally {
      setIsLateInTrendLoading(false);
    }
  };

  // Handle contractor selection change for CL Addition Trend
  const handleClAdditionContractorChange = (contractor) => {
    setSelectedContractorForCLAddition(contractor);
    fetchClAdditionTrend(contractor);
    // Recreate the chart after data is updated
    setTimeout(() => {
      createCLCharts();
    }, 1000);
  };

  // Fetch detailed employee data for a specific month
  const fetchMonthEmployeeDetails = async (month, contractorFilter = 'all') => {
    try {
      console.log(`🔍 Fetching employee details for ${month}, contractor: ${contractorFilter}`);
     
      // Show loading state
      setIsLoadingMonthDetails(true);
      setMonthEmployeeDetails([]);
      setSelectedChartMonth(month);
      setShowMonthDetails(true);
     
      // Get current date and calculate the specific month
      const today = new Date();
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthIndex = monthNames.indexOf(month);
     
      if (monthIndex === -1) {
        console.error('Invalid month:', month);
        return;
      }
     
      // Calculate the year and month for the API call
      const targetDate = new Date(today.getFullYear(), monthIndex, 1);
      const year = targetDate.getFullYear();
      const monthNum = monthIndex + 1;
     
      console.log(`📅 Target date: ${year}-${monthNum.toString().padStart(2, '0')}`);
     
      // Fetch all employees
      const timestamp = new Date().getTime();
      const response = await fetch(`/server/cms_function/employees?returnAll=true&_t=${timestamp}`, {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      const data = await response.json();
     
      if (data.status === 'success' && data.data && data.data.employees) {
        const employees = data.data.employees;
        console.log(`📊 Total employees found: ${employees.length}`);
       
        // Use unified function to get employees for the specific month
        const monthEmployees = getEmployeesForMonth(employees, month, year, contractorFilter);
       
        console.log(`✅ Found ${monthEmployees.length} employees who joined in ${month} ${year}`);
        console.log(`🔍 Month employees details:`, monthEmployees.map(emp => ({
          name: emp.employeeName,
          contractor: emp.contractor,
          dateOfJoining: emp.dateOfJoining,
          parsedDate: new Date(emp.dateOfJoining).toISOString().slice(0, 7)
        })));
       
        // Process employee data for modal display
        const processedEmployees = monthEmployees.map(emp => ({
          name: emp.employeeName || 'Unknown Employee',
          employeeId: emp.employeeCode || 'N/A',
          contractor: emp.contractor || 'Unknown Contractor',
          department: emp.department || 'N/A',
          designation: emp.designation || 'N/A',
          joiningDate: emp.dateOfJoining,
          phone: emp.phone || 'N/A',
          email: emp.personalEmail || 'N/A',
          location: emp.location || 'N/A'
        }));
       
        // Group by contractor for detailed breakdown
        const contractorBreakdown = {};
        processedEmployees.forEach(emp => {
          const contractor = emp.contractor || 'Unknown Contractor';
          if (!contractorBreakdown[contractor]) {
            contractorBreakdown[contractor] = [];
          }
          contractorBreakdown[contractor].push(emp);
        });
       
        setMonthEmployeeDetails(processedEmployees);
        setSelectedChartMonth(month);
        setShowMonthDetails(true);
        setIsLoadingMonthDetails(false);
       
        console.log('📋 Month employee details:', monthEmployees);
        console.log('🏢 Contractor breakdown:', contractorBreakdown);
       
        return { employees: monthEmployees, contractorBreakdown };
      } else {
        console.log('⚠️ No employee data found');
        setMonthEmployeeDetails([]);
        setIsLoadingMonthDetails(false);
        return { employees: [], contractorBreakdown: {} };
      }
    } catch (err) {
      console.error('❌ Failed to fetch month employee details:', err);
      setMonthEmployeeDetails([]);
      setIsLoadingMonthDetails(false);
      return { employees: [], contractorBreakdown: {} };
    }
  };


  useEffect(() => {
    fetchLateInTrend();
    const intervalId = setInterval(() => {
      fetchLateInTrend();
    }, 30000);
    return () => clearInterval(intervalId);
  }, []);

  // Fetch CL Attrition Trend data based on employee exit dates - Real-time data only
  const fetchClAttritionTrend = async (contractorFilter = 'all') => {
    try {
      setIsClAttritionLoading(true);
      console.log('🔄 Fetching real-time CL Attrition Trend data for contractor:', contractorFilter);
     
      // Get current date and calculate last 6 months
      const today = new Date();
      const months = [];
     
      for (let i = 5; i >= 0; i--) {
        const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const monthName = date.toLocaleDateString('en-US', { month: 'short' });
        const monthKey = date.toISOString().slice(0, 7); // YYYY-MM format
       
        months.push({
          month: monthName,
          monthKey: monthKey,
          year: date.getFullYear(),
          monthNum: date.getMonth() + 1
        });
      }
     
      console.log('📅 Last 6 months for attrition analysis:', months);
     
      console.log('🔄 Fetching real-time employee data for CL Attrition Trend...');
      const response = await fetch('/server/cms_function/employees?returnAll=true');
      const data = await response.json();
     
      console.log('📊 CL Attrition API response:', data);
     
      if (data.status === 'success' && data.data && data.data.employees) {
        const employees = data.data.employees;
        console.log('📋 Total employees found for attrition analysis:', employees.length);
       
        // Filter employees by contractor if not 'all'
        let filteredEmployees = employees;
        if (contractorFilter !== 'all') {
          filteredEmployees = employees.filter(employee =>
            employee.ContractorName && employee.ContractorName.toLowerCase() === contractorFilter.toLowerCase()
          );
          console.log(`📊 Filtered employees for contractor ${contractorFilter}:`, filteredEmployees.length);
        }
       
        // First, collect all unique months with exit dates
        const allExitMonths = new Set();
        filteredEmployees.forEach(employee => {
          if (employee.dateOfExit) {
            const exitDate = new Date(employee.dateOfExit);
            const exitMonthKey = exitDate.toISOString().slice(0, 7); // YYYY-MM format
            allExitMonths.add(exitMonthKey);
          }
        });
       
        // Add months with exit dates to our months array if not already present
        allExitMonths.forEach(monthKey => {
          const existingMonth = months.find(m => m.monthKey === monthKey);
          if (!existingMonth) {
            const date = new Date(monthKey + '-01');
            const monthName = date.toLocaleDateString('en-US', { month: 'short' });
            months.push({
              month: monthName,
              monthKey: monthKey,
              year: date.getFullYear(),
              monthNum: date.getMonth() + 1
            });
          }
        });
       
        // Sort months by date
        months.sort((a, b) => a.monthKey.localeCompare(b.monthKey));
       
        // Reinitialize monthly counts with all months using monthKey as unique identifier
        const monthlyCounts = {};
        months.forEach(({ month, monthKey }) => {
          monthlyCounts[monthKey] = { count: 0, month: month, monthKey: monthKey };
        });
       
        // Count employees who left in each month based on real exit dates
        let totalExits = 0;
        filteredEmployees.forEach(employee => {
          if (employee.dateOfExit) {
            const exitDate = new Date(employee.dateOfExit);
            const exitMonthKey = exitDate.toISOString().slice(0, 7); // YYYY-MM format
           
            // Find the corresponding month in our months array
            const monthData = months.find(m => m.monthKey === exitMonthKey);
            if (monthData) {
              monthlyCounts[monthData.monthKey].count++;
              totalExits++;
              console.log(`✅ Employee ${employee.employeeCode || employee.id} left in ${monthData.month} (${employee.dateOfExit})`);
            }
          }
        });
       
        console.log(`📊 Total employees with exit dates: ${totalExits}`);
       
        // Convert to chart data format with real-time data only
        const trendData = months.map(({ month, monthKey, year }) => {
          // Check if there are multiple months with the same name (different years)
          const sameMonthCount = months.filter(m => m.month === month).length;
          const displayMonth = sameMonthCount > 1 ? `${month} ${year}` : month;
         
          return {
            month: displayMonth,
            value: monthlyCounts[monthKey].count,
            benchmark: 8, // Set a benchmark of 8 employees per month
            isRealTime: true // Mark as real-time data
          };
        });
       
        console.log('📊 Real-time CL Attrition Trend data:', trendData);
        setClAttritionTrendData(trendData);
      } else {
        console.log('⚠️ No employee data found for attrition analysis');
        // No fallback data - show empty data
        const emptyData = months.map(({ month }) => ({
          month: month,
          value: 0,
          benchmark: 8,
          isRealTime: true // Mark as real-time data (showing 0 is real-time)
        }));
        setClAttritionTrendData(emptyData);
      }
    } catch (err) {
      console.error('❌ Failed to fetch CL Attrition Trend data:', err);
      // No fallback data - show empty data
      // Create fallback months array for error case
      const today = new Date();
      const fallbackMonths = [];
      for (let i = 5; i >= 0; i--) {
        const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const monthName = date.toLocaleDateString('en-US', { month: 'short' });
        fallbackMonths.push({ month: monthName });
      }
     
      const emptyData = fallbackMonths.map(({ month }) => ({
        month: month,
        value: 0,
        benchmark: 8,
        isRealTime: true // Mark as real-time data (error case still shows real-time 0)
      }));
      setClAttritionTrendData(emptyData);
    } finally {
      setIsClAttritionLoading(false);
    }
  };

  // Fetch Payroll Earned Gross & Total Salary month-wise (last 6 months) for chart
  const fetchPayrollGrossTrend = async () => {
    try {
      setIsPayrollTrendLoading(true);
      const today = new Date();
      const months = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        months.push({
          month: d.toLocaleDateString('en-US', { month: 'short' }),
          monthKey: d.toISOString().slice(0, 7),
        });
      }
      const trend = [];
      for (const { month, monthKey } of months) {
        let earnedGross = 0;
        let totalSalary = 0;
        try {
          const params = new URLSearchParams({ month: monthKey });
          if (userEmail) params.set('userEmail', userEmail);
          const res = await fetch(`/server/payroll_function/report?${params.toString()}`);
          const result = await res.json();
          const rows = Array.isArray(result.data) ? result.data : [];
          rows.forEach((r) => {
            earnedGross += Number(r.earnedSalaryCross) || 0;
            totalSalary += Number(r.actualTotalSalary) || 0;
          });
        } catch (e) {
          console.warn('Payroll trend: report failed for', monthKey, e.message);
        }
        trend.push({ month, earnedGross, totalSalary });
      }
      setPayrollGrossTrendData(trend);
    } catch (err) {
      console.error('Failed to fetch payroll gross trend:', err);
      setPayrollGrossTrendData([]);
    } finally {
      setIsPayrollTrendLoading(false);
    }
  };

  // Fetch LOH and OT hours month-wise (last 6 months) for comparison chart
  const fetchLohOtTrend = async () => {
    try {
      setIsLohOtLoading(true);
      const today = new Date();
      const months = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        months.push({
          month: d.toLocaleDateString('en-US', { month: 'short' }),
          monthKey: d.toISOString().slice(0, 7),
          startDate: `${d.toISOString().slice(0, 7)}-01`,
          endDate: `${d.toISOString().slice(0, 7)}-${String(lastDay).padStart(2, '0')}`,
        });
      }
      const trend = [];
      for (const { month, monthKey, startDate, endDate } of months) {
        let lohHours = 0;
        let otHours = 0;
        try {
          let lohUrl = `/server/reports_function/loh?startDate=${startDate}&endDate=${endDate}`;
          if (userEmail) lohUrl += `&userEmail=${encodeURIComponent(userEmail)}`;
          if (userRole) lohUrl += `&userRole=${encodeURIComponent(userRole)}`;
          const lohRes = await fetch(lohUrl);
          if (lohRes.ok) {
            const lohJson = await lohRes.json();
            const lohRows = Array.isArray(lohJson.data) ? lohJson.data : [];
            lohRows.forEach((r) => {
              lohHours += parseFloat(r.lossOfHours) || 0;
            });
          }
        } catch (e) {
          console.warn('LOH trend: fetch failed for', monthKey, e.message);
        }
        try {
          let otUrl = `/server/reports_function/monthly-overtime?month=${monthKey}`;
          if (userEmail) otUrl += `&userEmail=${encodeURIComponent(userEmail)}`;
          if (userRole) otUrl += `&userRole=${encodeURIComponent(userRole)}`;
          const otRes = await fetch(otUrl);
          if (otRes.ok) {
            const otJson = await otRes.json();
            const otRows = Array.isArray(otJson.data) ? otJson.data : [];
            otRows.forEach((r) => {
              otHours += parseFloat(r.totalOvertimeHours) || 0;
            });
          }
        } catch (e) {
          console.warn('OT trend: fetch failed for', monthKey, e.message);
        }
        trend.push({ month, lohHours: Math.round(lohHours * 100) / 100, otHours: Math.round(otHours * 100) / 100 });
      }
      setLohOtTrendData(trend);
    } catch (err) {
      console.error('Failed to fetch LOH/OT trend:', err);
      setLohOtTrendData([]);
    } finally {
      setIsLohOtLoading(false);
    }
  };

  // Handle contractor selection change for CL Attrition Trend
  const handleClAttritionContractorChange = (contractor) => {
    setSelectedContractorForCLAttrition(contractor);
    fetchClAttritionTrend(contractor);
    // Recreate the chart after data is updated
    setTimeout(() => {
      createCLCharts();
    }, 1000);
  };

  useEffect(() => {
    fetchPayrollGrossTrend();
    fetchLohOtTrend();
  }, []);

  // Function to create CL charts
  const createCLCharts = () => {
    // Late In Report - Week Wise (Mon–Sun) line chart (replaces CL Addition in this card)
    if (window.Chart && clAdditionChartRef.current) {
      const existingChart = window.Chart.getChart(clAdditionChartRef.current);
      if (existingChart) existingChart.destroy();
      const labels = lateInTrendData.length > 0 ? lateInTrendData.map(d => d.weekLabel) : [];
      const values = lateInTrendData.length > 0 ? lateInTrendData.map(d => d.value) : [];
      const chart = new window.Chart(clAdditionChartRef.current, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Late In Count',
              data: values,
              borderColor: '#4ECDC4',
              backgroundColor: 'rgba(78, 205, 196, 0.1)',
              tension: 0.4,
              fill: true,
              pointRadius: 4,
              pointHoverRadius: 6,
              pointBackgroundColor: '#4ECDC4',
              pointBorderColor: '#fff',
              pointBorderWidth: 2,
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 1500, easing: 'easeInOutQuart' },
          interaction: { intersect: false, mode: 'index' },
          plugins: {
            legend: { position: 'top' },
            title: {
              display: true,
              text: `Late In Report - Week Wise (Mon–Sun with date, Current Month ${new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}) - LIVE`,
              font: { size: 16, weight: 'bold' }
            },
            tooltip: {
              callbacks: {
                label: (ctx) => `Late In Count: ${ctx.parsed.y}`
              }
            }
          },
          scales: {
            y: { beginAtZero: true },
            x: { ticks: { maxRotation: 45, minRotation: 45, maxTicksLimit: 6 } }
          }
        }
      });
      clAdditionChartRef.current.chart = chart;
      try { chart.update('none'); } catch (_) {}
    }

    // Payroll Earned Gross & Total Salary month-wise line chart (replaces CL Attrition)
    if (window.Chart && clAttritionChartRef.current) {
      const existingChart = window.Chart.getChart(clAttritionChartRef.current);
      if (existingChart) existingChart.destroy();
      const labels = payrollGrossTrendData.length > 0 ? payrollGrossTrendData.map(d => d.month) : [];
      const earnedData = payrollGrossTrendData.map(d => d.earnedGross);
      const totalData = payrollGrossTrendData.map(d => d.totalSalary);
      const chart = new window.Chart(clAttritionChartRef.current, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Earned Gross Salary',
              data: earnedData,
              borderColor: '#4ECDC4',
              backgroundColor: 'rgba(78, 205, 196, 0.1)',
              tension: 0.4,
              fill: true,
              pointRadius: 4,
              pointHoverRadius: 6,
            },
            {
              label: 'Total Salary',
              data: totalData,
              borderColor: '#45B7D1',
              backgroundColor: 'rgba(69, 183, 209, 0.1)',
              tension: 0.4,
              fill: true,
              pointRadius: 4,
              pointHoverRadius: 6,
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 1500, easing: 'easeInOutQuart' },
          plugins: {
            legend: { position: 'top' },
            title: {
              display: true,
              text: 'Payroll - Earned Gross & Total Salary (Last 6 Months)',
              font: { size: 16, weight: 'bold' }
            },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const v = ctx.parsed.y;
                  return `${ctx.dataset.label}: ${typeof v === 'number' ? v.toLocaleString('en-IN') : v}`;
                }
              }
            }
          },
          scales: {
            y: { beginAtZero: true, ticks: { callback: (v) => (v >= 100000 ? (v / 100000).toFixed(1) + 'L' : v) } },
            x: { ticks: { maxTicksLimit: 8 } }
          }
        }
      });
      clAttritionChartRef.current.chart = chart;
      try { chart.update('none'); } catch (_) {}
    }

    // LOH and OT Hours Month Report - comparison line chart (two lines, smooth)
    if (window.Chart && lohOtChartRef.current) {
      const existingChart = window.Chart.getChart(lohOtChartRef.current);
      if (existingChart) existingChart.destroy();
      const labels = lohOtTrendData.length > 0 ? lohOtTrendData.map((d) => d.month) : [];
      const lohValues = lohOtTrendData.length > 0 ? lohOtTrendData.map((d) => d.lohHours) : [];
      const otValues = lohOtTrendData.length > 0 ? lohOtTrendData.map((d) => d.otHours) : [];
      const chart = new window.Chart(lohOtChartRef.current, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'LOH (Loss of Hours)',
              data: lohValues,
              borderColor: '#DC2626',
              backgroundColor: 'rgba(220, 38, 38, 0.1)',
              tension: 0.4,
              fill: true,
              pointRadius: 5,
              pointHoverRadius: 7,
              pointBackgroundColor: '#DC2626',
              pointBorderColor: '#fff',
              pointBorderWidth: 2,
            },
            {
              label: 'OT Hours',
              data: otValues,
              borderColor: '#22C55E',
              backgroundColor: 'rgba(34, 197, 94, 0.1)',
              tension: 0.4,
              fill: true,
              pointRadius: 5,
              pointHoverRadius: 7,
              pointBackgroundColor: '#22C55E',
              pointBorderColor: '#fff',
              pointBorderWidth: 2,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 1500, easing: 'easeInOutQuart' },
          interaction: { intersect: false, mode: 'index' },
          plugins: {
            legend: { position: 'top' },
            title: {
              display: true,
              text: 'LOH and OT Hours Month Report (Last 6 Months)',
              font: { size: 16, weight: 'bold' },
            },
            tooltip: {
              callbacks: {
                label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y} hrs`,
              },
            },
          },
          scales: {
            y: {
              beginAtZero: true,
              title: { display: true, text: 'Hours' },
            },
            x: {
              title: { display: true, text: 'Month' },
              ticks: { maxTicksLimit: 6 },
            },
          },
        },
      });
      lohOtChartRef.current.chart = chart;
      try { chart.update('none'); } catch (_) {}
    }
  };


  useEffect(() => {
    if (lateInTrendData.length > 0 || payrollGrossTrendData.length > 0 || lohOtTrendData.length > 0) {
      const t = setTimeout(() => {
        createCLCharts();
        requestAnimationFrame(() => {
          if (clAdditionChartRef.current?.chart) clAdditionChartRef.current.chart.resize();
          if (clAttritionChartRef.current?.chart) clAttritionChartRef.current.chart.resize();
          if (lohOtChartRef.current?.chart) lohOtChartRef.current.chart.resize();
        });
      }, 350);
      return () => clearTimeout(t);
    }
  }, [lateInTrendData, payrollGrossTrendData, lohOtTrendData]);

  // Fetch Contractor Performance Data for Scoring Table
  const fetchContractorScoringData = async () => {
    try {
      setIsScoringLoading(true);
      console.log('Fetching Contractor Performance Data for Scoring Table...');
     
      // Get current date and calculate last 30 days
      const today = new Date();
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(today.getDate() - 30);
     
      const startDate = thirtyDaysAgo.toISOString().split('T')[0];
      const endDate = today.toISOString().split('T')[0];
     
      console.log('Date range for data fetch:', { startDate, endDate });
     
      // Fetch data from multiple APIs
      const [contractorsResponse, employeesResponse, ehsViolationsResponse, criticalIncidentsResponse] = await Promise.all([
        fetch('/server/Contracters_function/contractors'),
        fetch(`/server/cms_function/employees?returnAll=true&userRole=${encodeURIComponent(userRole || '')}&userEmail=${encodeURIComponent(userEmail || '')}`),
        fetch(`/server/EHSViolation_function/violations?startDate=${startDate}&endDate=${endDate}&returnAll=true`),
        fetch(`/server/CriticalIncident_function/incidents?startDate=${startDate}&endDate=${endDate}&returnAll=true`)
      ]);

      console.log('API Responses received:', {
        contractorsStatus: contractorsResponse.status,
        employeesStatus: employeesResponse.status,
        ehsStatus: ehsViolationsResponse.status,
        criticalStatus: criticalIncidentsResponse.status
      });

      const contractorsData = await contractorsResponse.json();
      const employeesData = await employeesResponse.json();
      const ehsViolationsData = await ehsViolationsResponse.json();
      const criticalIncidentsData = await criticalIncidentsResponse.json();

      console.log('Contractors Data:', contractorsData);
      console.log('Employees Data:', employeesData);
      console.log('EHS Violations Data:', ehsViolationsData);
      console.log('Critical Incidents Data:', criticalIncidentsData);

      // Debug: Check if we're getting the expected data structure
      if (contractorsData.data?.contractors) {
        console.log('Contractors found:', contractorsData.data.contractors.length);
        console.log('First contractor:', contractorsData.data.contractors[0]);
      } else {
        console.log('No contractors data structure found');
        console.log('Full contractors response:', contractorsData);
      }

      if (employeesData.data?.employees) {
        console.log('Employees found:', employeesData.data.employees.length);
        console.log('First employee:', employeesData.data.employees[0]);
      } else {
        console.log('No employees data structure found');
        console.log('Full employees response:', employeesData);
      }

      if (ehsViolationsData.data?.violations) {
        console.log('EHS violations found:', ehsViolationsData.data.violations.length);
        if (ehsViolationsData.data.violations.length > 0) {
          console.log('First EHS violation:', ehsViolationsData.data.violations[0]);
        }
      } else {
        console.log('No EHS violations data structure found');
        console.log('Full EHS violations response:', ehsViolationsData);
      }

      if (criticalIncidentsData.data?.incidents) {
        console.log('Critical incidents found:', criticalIncidentsData.data.incidents.length);
        if (criticalIncidentsData.data.incidents.length > 0) {
          console.log('First critical incident:', criticalIncidentsData.data.incidents[0]);
        }
      } else {
        console.log('No critical incidents data structure found');
        console.log('Full critical incidents response:', criticalIncidentsData);
      }

      if (contractorsData.status === 'success' && contractorsData.data && contractorsData.data.contractors) {
        const contractors = contractorsData.data.contractors;
        const employees = employeesData.data?.employees || [];
        const ehsViolations = ehsViolationsData.data?.violations || [];
        const criticalIncidents = criticalIncidentsData.data?.incidents || [];
       
        // Debug: Log sample contractor structure
        if (contractors.length > 0) {
          console.log('Sample contractor structure:', contractors[0]);
          console.log('Available contractor fields:', Object.keys(contractors[0]));
        }
       
        console.log('Processing contractors:', contractors.length);
        console.log('Total employees:', employees.length);
        console.log('Total EHS violations:', ehsViolations.length);
        console.log('Total critical incidents:', criticalIncidents.length);
       
        // Debug: Log all contractor names from contractors API
        console.log('Contractor names from contractors API:', contractors.map(c => c.ContractorName));
       
        // Debug: Log all unique contractor names from employees data
        const uniqueEmployeeContractors = [...new Set(employees.map(emp =>
          emp.ContractorName || emp.contractorName || emp.contractor || emp.Contractor || emp.contractor_name
        ).filter(Boolean))];
        console.log('Unique contractor names from employees data:', uniqueEmployeeContractors);
       
        const scoringData = [];

        contractors.forEach(contractor => {
          if (contractor.ContractorName) {
            // Debug: Log the first few employees to see their structure
            if (employees.length > 0) {
              console.log('Sample employee structure:', employees[0]);
              console.log('Available employee fields:', Object.keys(employees[0]));
            }
           
            // Get all employees under this contractor - try multiple possible field names
            const contractorEmployees = employees.filter(emp => {
              const empContractor = emp.ContractorName || emp.contractorName || emp.contractor || emp.Contractor || emp.contractor_name;
             
              // More flexible matching to handle variations in contractor names
              const matches = empContractor === contractor.ContractorName ||
                            (empContractor && contractor.ContractorName &&
                             (empContractor.toLowerCase().includes(contractor.ContractorName.toLowerCase()) ||
                              contractor.ContractorName.toLowerCase().includes(empContractor.toLowerCase())));
             
              if (matches) {
                console.log(`Employee ${emp.EmployeeCode || emp.employeeCode || emp.id} belongs to contractor ${contractor.ContractorName} (matched with ${empContractor})`);
              }
              return matches;
            });
           
            console.log(`Contractor ${contractor.ContractorName} has ${contractorEmployees.length} employees:`,
              contractorEmployees.map(emp => emp.EmployeeCode || emp.employeeCode || emp.id));

            // Count EHS violations for employees under this contractor
            let ehsCount = 0;
            if (ehsViolations.length > 0) {
              // Debug: Log sample violation structure
              if (ehsViolations.length > 0) {
                console.log('Sample EHS violation structure:', ehsViolations[0]);
                console.log('Available EHS violation fields:', Object.keys(ehsViolations[0]));
              }
             
              ehsCount = ehsViolations.filter(violation => {
                // Check if the violation is for an employee under this contractor
                return contractorEmployees.some(emp => {
                  const empCode = emp.EmployeeCode || emp.employeeCode || emp.id;
                  const violationEmpId = violation.ContractEmployeeID || violation.contractEmployeeID || violation.contractEmployeeId || violation.employeeId || violation.employee_id || violation.id;
                  const matches = empCode && violationEmpId && empCode.toString() === violationEmpId.toString();
                  if (matches) {
                    console.log(`EHS violation ${violation.id || violation.ID} matches employee ${empCode} under contractor ${contractor.ContractorName}`);
                  }
                  return matches;
                });
              }).length;
            }

            // Count critical incidents for employees under this contractor
            let criticalCount = 0;
            if (criticalIncidents.length > 0) {
              // Debug: Log sample incident structure
              if (criticalIncidents.length > 0) {
                console.log('Sample Critical Incident structure:', criticalIncidents[0]);
                console.log('Available Critical Incident fields:', Object.keys(criticalIncidents[0]));
              }
             
              criticalCount = criticalIncidents.filter(incident => {
                // Check if the incident is for an employee under this contractor
                return contractorEmployees.some(emp => {
                  const empCode = emp.EmployeeCode || emp.employeeCode || emp.id;
                  const incidentEmpId = incident.ContractEmplyee || incident.contractEmployee || incident.contractEmployeeId || incident.employeeId || incident.employee_id || incident.id;
                  const matches = empCode && incidentEmpId && empCode.toString() === incidentEmpId.toString();
                  if (matches) {
                    console.log(`Critical incident ${incident.id || incident.ID} matches employee ${empCode} under contractor ${contractor.ContractorName}`);
                  }
                  return matches;
                });
              }).length;
            }

            console.log(`Contractor ${contractor.ContractorName} - CIR: ${criticalCount}, EHS: ${ehsCount}`);

            // Calculate scores based on scoring matrix
            const cirScoreData = getCIRScore(criticalCount);
            const ehsScoreData = getEHSScore(ehsCount);
           
            // Calculate overall score (average of CIR and EHS scores)
            const overallScore = Math.round((cirScoreData.score + ehsScoreData.score) / 2);

            const contractorData = {
              contractor: contractor.ContractorName,
              employeeCount: contractorEmployees.length,
              cirCount: criticalCount,
              ehsCount: ehsCount,
              cirScore: cirScoreData.score,
              ehsScore: ehsScoreData.score,
              overallScore: overallScore,
              cirRemark: cirScoreData.remark,
              ehsRemark: ehsScoreData.remark
            };
           
            console.log('Contractor scoring data processed:', contractorData);
            scoringData.push(contractorData);
          }
        });

        // Sort by overall score (highest first)
        scoringData.sort((a, b) => b.overallScore - a.overallScore);

        // If no real data or all contractors have 0 employees, create sample data
        if (scoringData.length === 0 || scoringData.every(c => c.employeeCount === 0)) {
          console.log('No real contractor data found or all contractors have 0 employees, creating sample data');
          const sampleData = [
            { contractor: 'ABC Corp', employeeCount: 15, cirCount: 3, ehsCount: 1, cirScore: 60, ehsScore: 100, overallScore: 80, cirRemark: 'Needs improvement, recurring issues', ehsRemark: 'Fully compliant' },
            { contractor: 'XYZ Ltd', employeeCount: 12, cirCount: 1, ehsCount: 0, cirScore: 80, ehsScore: 100, overallScore: 90, cirRemark: 'Minor lapses, immediate corrective action', ehsRemark: 'Fully compliant' },
            { contractor: 'DEF Inc', employeeCount: 18, cirCount: 5, ehsCount: 2, cirScore: 40, ehsScore: 80, overallScore: 60, cirRemark: 'Serious concern, high risk', ehsRemark: 'Minor lapses, manageable' },
            { contractor: 'GHI Co', employeeCount: 8, cirCount: 0, ehsCount: 0, cirScore: 100, ehsScore: 100, overallScore: 100, cirRemark: 'Zero tolerance maintained', ehsRemark: 'Fully compliant' },
            { contractor: 'JKL Pvt', employeeCount: 22, cirCount: 2, ehsCount: 1, cirScore: 80, ehsScore: 100, overallScore: 90, cirRemark: 'Minor lapses, immediate corrective action', ehsRemark: 'Fully compliant' },
          ];
          setContractorScoringData(sampleData);
        } else {
          console.log('Final Contractor Scoring Data:', scoringData);
          setContractorScoringData(scoringData);
        }
      } else {
        console.log('No contractors found, using sample data');
        const sampleData = [
          { contractor: 'ABC Corp', employeeCount: 15, cirCount: 3, ehsCount: 1, cirScore: 60, ehsScore: 100, overallScore: 80, cirRemark: 'Needs improvement, recurring issues', ehsRemark: 'Fully compliant' },
          { contractor: 'XYZ Ltd', employeeCount: 12, cirCount: 1, ehsCount: 0, cirScore: 80, ehsScore: 100, overallScore: 90, cirRemark: 'Minor lapses, immediate corrective action', ehsRemark: 'Fully compliant' },
          { contractor: 'DEF Inc', employeeCount: 18, cirCount: 5, ehsCount: 2, cirScore: 40, ehsScore: 80, overallScore: 60, cirRemark: 'Serious concern, high risk', ehsRemark: 'Minor lapses, manageable' },
          { contractor: 'GHI Co', employeeCount: 8, cirCount: 0, ehsCount: 0, cirScore: 100, ehsScore: 100, overallScore: 100, cirRemark: 'Zero tolerance maintained', ehsRemark: 'Fully compliant' },
          { contractor: 'JKL Pvt', employeeCount: 22, cirCount: 2, ehsCount: 1, cirScore: 80, ehsScore: 100, overallScore: 90, cirRemark: 'Minor lapses, immediate corrective action', ehsRemark: 'Fully compliant' },
        ];
        setContractorScoringData(sampleData);
      }
    } catch (err) {
      console.error('Failed to fetch Contractor Performance Data:', err);
      // Fallback to sample data on error
      const sampleData = [
        { contractor: 'ABC Corp', employeeCount: 15, cirCount: 3, ehsCount: 1, cirScore: 60, ehsScore: 100, overallScore: 80, cirRemark: 'Needs improvement, recurring issues', ehsRemark: 'Fully compliant' },
        { contractor: 'XYZ Ltd', employeeCount: 12, cirCount: 1, ehsCount: 0, cirScore: 80, ehsScore: 100, overallScore: 90, cirRemark: 'Minor lapses, immediate corrective action', ehsRemark: 'Fully compliant' },
        { contractor: 'DEF Inc', employeeCount: 18, cirCount: 5, ehsCount: 2, cirScore: 40, ehsScore: 80, overallScore: 60, cirRemark: 'Serious concern, high risk', ehsRemark: 'Minor lapses, manageable' },
        { contractor: 'GHI Co', employeeCount: 8, cirCount: 0, ehsCount: 0, cirScore: 100, ehsScore: 100, overallScore: 100, cirRemark: 'Zero tolerance maintained', ehsRemark: 'Fully compliant' },
        { contractor: 'JKL Pvt', employeeCount: 22, cirCount: 2, ehsCount: 1, cirScore: 80, ehsScore: 100, overallScore: 90, cirRemark: 'Minor lapses, immediate corrective action', ehsRemark: 'Fully compliant' },
      ];
      setContractorScoringData(sampleData);
    } finally {
      setIsScoringLoading(false);
    }
  };

  // Handle PDF Download for Contractor Performance Scoring
  const handleDownloadContractorScoringPDF = () => {
    try {
      // Get current date for filename
      const currentDate = new Date();
      const dateString = currentDate.toISOString().split('T')[0];
      const timeString = currentDate.toTimeString().split(' ')[0].replace(/:/g, '-');
     
      // Create HTML content for PDF
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Contractor Performance Scoring Report</title>
          <style>
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              margin: 0;
              padding: 12px;
              background: #f8fafc;
              color: #1e293b;
              font-size: 0.85rem;
            }
            .header {
              text-align: center;
              margin-bottom: 15px;
              padding: 12px;
              background: linear-gradient(135deg, #0a41b1 0%, #3cd9e8 100%);
              color: white;
              border-radius: 8px;
              box-shadow: 0 2px 10px rgba(10, 65, 177, 0.3);
            }
            .header h1 {
              margin: 0 0 6px 0;
              font-size: 1.5rem;
              font-weight: 700;
            }
            .header p {
              margin: 0;
              font-size: 0.85rem;
              opacity: 0.9;
            }
            .report-info {
              background: white;
              padding: 12px;
              border-radius: 8px;
              margin-bottom: 12px;
              box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            }
            .report-info h3 {
              margin: 0 0 10px 0;
              color: #0a41b1;
              font-size: 1rem;
            }
            .info-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
              gap: 10px;
            }
            .info-item {
              display: flex;
              flex-direction: column;
            }
            .info-label {
              font-weight: 600;
              color: #64748b;
              font-size: 0.75rem;
              margin-bottom: 3px;
            }
            .info-value {
              color: #1e293b;
              font-size: 0.85rem;
            }
            .table-container {
              background: white;
              border-radius: 8px;
              overflow: hidden;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            table {
              width: 100%;
              border-collapse: collapse;
              font-size: 0.8rem;
            }
            th {
              background: linear-gradient(135deg, #0a41b1, #3cd9e8);
              color: white;
              padding: 8px 8px;
              text-align: left;
              font-weight: 600;
              font-size: 0.8rem;
            }
            td {
              padding: 8px;
              border-bottom: 1px solid #e2e8f0;
            }
            tr:nth-child(even) {
              background: #f8fafc;
            }
            tr:hover {
              background: #f1f5f9;
            }
            .rank-badge {
              display: inline-block;
              background: linear-gradient(135deg, #0a41b1, #3cd9e8);
              color: white;
              padding: 4px 8px;
              border-radius: 12px;
              font-weight: 600;
              font-size: 0.7rem;
              min-width: 24px;
              text-align: center;
            }
            .score-display {
              display: flex;
              align-items: center;
              gap: 6px;
            }
            .score-value {
              font-weight: 700;
              font-size: 0.9rem;
              color: #0a41b1;
            }
            .score-bar {
              width: 50px;
              height: 6px;
              background: #e2e8f0;
              border-radius: 3px;
              overflow: hidden;
            }
            .score-fill {
              height: 100%;
              border-radius: 3px;
              transition: width 0.3s ease;
            }
            .status-badge {
              display: inline-block;
              padding: 4px 8px;
              border-radius: 12px;
              font-weight: 600;
              font-size: 0.7rem;
              text-align: center;
              min-width: 65px;
            }
            .status-excellent {
              background: linear-gradient(135deg, #4ecdc4, #44a08d);
              color: white;
            }
            .status-good {
              background: linear-gradient(135deg, #ffd93d, #ff9f43);
              color: white;
            }
            .status-fair {
              background: linear-gradient(135deg, #ff9f43, #ff6b6b);
              color: white;
            }
            .status-poor {
              background: linear-gradient(135deg, #ff6b6b, #ee5a52);
              color: white;
            }
            .employee-count {
              text-align: center;
            }
            .employee-count-value {
              font-weight: 700;
              font-size: 0.9rem;
              color: #0a41b1;
            }
            .employee-count-label {
              font-size: 0.7rem;
              color: #64748b;
            }
            .metric-display {
              text-align: center;
            }
            .metric-count {
              font-weight: 700;
              font-size: 0.9rem;
              color: #0a41b1;
            }
            .metric-score {
              font-size: 0.75rem;
              color: #64748b;
              margin-left: 4px;
            }
            .metric-remark {
              font-size: 0.7rem;
              color: #64748b;
              margin-top: 2px;
              font-style: italic;
            }
            .footer {
              margin-top: 15px;
              text-align: center;
              color: #64748b;
              font-size: 0.75rem;
            }
            @media print {
              body { margin: 0; padding: 8px; }
              .header { margin-bottom: 12px; }
              table { font-size: 0.75rem; }
              th, td { padding: 6px 4px; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Contractor Performance Scoring Report</h1>
            <p>Generated on ${currentDate.toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}</p>
          </div>
         
          <div class="report-info">
            <h3>Report Summary</h3>
            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">Total Contractors</span>
                <span class="info-value">${contractorScoringData.length}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Total Employees</span>
                <span class="info-value">${contractorScoringData.reduce((sum, contractor) => sum + contractor.employeeCount, 0)}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Average Score</span>
                <span class="info-value">${contractorScoringData.length > 0 ? (contractorScoringData.reduce((sum, contractor) => sum + contractor.overallScore, 0) / contractorScoringData.length).toFixed(1) : 0}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Report Period</span>
                <span class="info-value">Last 30 Days</span>
              </div>
            </div>
          </div>
         
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Contractor</th>
                  <th>Employees</th>
                  <th>CIR Count</th>
                  <th>EHS Violations</th>
                  <th>Overall Score</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${contractorScoringData.map((contractor, index) => `
                  <tr>
                    <td>
                      <span class="rank-badge">${index + 1}</span>
                    </td>
                    <td style="font-weight: 600; color: #0a41b1;">${contractor.contractor}</td>
                    <td class="employee-count">
                      <div>
                        <span class="employee-count-value">${contractor.employeeCount}</span>
                        <div class="employee-count-label">employees</div>
                      </div>
                    </td>
                    <td class="metric-display">
                      <div>
                        <span class="metric-count">${contractor.cirCount}</span>
                        <span class="metric-score">(${contractor.cirScore})</span>
                        <div class="metric-remark">${contractor.cirRemark}</div>
                      </div>
                    </td>
                    <td class="metric-display">
                      <div>
                        <span class="metric-count">${contractor.ehsCount}</span>
                        <span class="metric-score">(${contractor.ehsScore})</span>
                        <div class="metric-remark">${contractor.ehsRemark}</div>
                      </div>
                    </td>
                    <td>
                      <div class="score-display">
                        <span class="score-value">${contractor.overallScore}</span>
                        <div class="score-bar">
                          <div class="score-fill" style="width: ${contractor.overallScore}%; background: ${
                            contractor.overallScore >= 80 ? '#4ecdc4' :
                            contractor.overallScore >= 60 ? '#ffd93d' :
                            contractor.overallScore >= 40 ? '#ff9f43' : '#ff6b6b'
                          }"></div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span class="status-badge status-${contractor.overallScore >= 80 ? 'excellent' :
                        contractor.overallScore >= 60 ? 'good' :
                        contractor.overallScore >= 40 ? 'fair' : 'poor'}">
                        ${contractor.overallScore >= 80 ? 'Excellent' :
                          contractor.overallScore >= 60 ? 'Good' :
                          contractor.overallScore >= 40 ? 'Fair' : 'Poor'}
                      </span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
         
          <div class="footer">
            <p>This report was generated automatically by the Payroll Management System</p>
            <p>For questions or support, please contact your system administrator</p>
          </div>
        </body>
        </html>
      `;
     
      // Create a blob with the HTML content
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
     
      // Create a temporary link element for download
      const link = document.createElement('a');
      link.href = url;
      link.download = `Contractor_Performance_Scoring_${dateString}_${timeString}.html`;
     
      // Append to body, click, and remove
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
     
      // Clean up the URL object
      URL.revokeObjectURL(url);
     
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Error generating PDF. Please try again.');
    }
  };

  // Handle PDF Download for CL Addition Trend - Enhanced with All Contractors Data
  const handleDownloadCLAdditionTrendPDF = async () => {
    try {
      // Get current date for filename
      const currentDate = new Date();
      const dateString = currentDate.toISOString().split('T')[0];
      const timeString = currentDate.toTimeString().split(' ')[0].replace(/:/g, '-');
     
      console.log('🔄 Starting comprehensive CL Addition Trend PDF generation...');
     
      // Fetch all contractors data for comprehensive report
      const allContractorsData = {};
      const contractorsList = [];
     
      // Get all contractors from the current contractor list
      if (contractorList && contractorList.length > 0) {
        // Filter out 'All' option as it's just a filter, not an actual contractor
        const actualContractors = contractorList.filter(contractor => contractor !== 'All');
        contractorsList.push(...actualContractors);
        console.log('📋 Contractors from state (excluding All):', actualContractors);
      }
     
      // Also get contractors from employee data
      try {
        const timestamp = new Date().getTime();
        const response = await fetch(`/server/cms_function/employees?returnAll=true&_t=${timestamp}`, {
          method: 'GET',
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        const data = await response.json();
       
        if (data.status === 'success' && data.data && data.data.employees) {
          const employees = data.data.employees;
          const employeeContractors = [...new Set(
            employees
              .map(emp => emp.contractor)
              .filter(contractor => contractor && contractor.trim() !== '')
          )];
          contractorsList.push(...employeeContractors);
          console.log('📋 Contractors from employee data:', employeeContractors);
        }
      } catch (error) {
        console.log('⚠️ Could not fetch contractors from employee data:', error);
      }
     
      console.log('📋 All contractors before deduplication:', contractorsList);
     
      // Remove duplicates and get unique contractors with advanced deduplication
      const uniqueContractors = [];
      contractorsList.forEach(contractor => {
        if (!contractor || contractor.trim() === '') return;
       
        const normalizedContractor = contractor.trim();
        const isDuplicate = uniqueContractors.some(existing => {
          const normalizedExisting = existing.trim();
          // Check for exact match or if one contains the other (case insensitive)
          return normalizedExisting.toLowerCase() === normalizedContractor.toLowerCase() ||
                 normalizedExisting.toLowerCase().includes(normalizedContractor.toLowerCase()) ||
                 normalizedContractor.toLowerCase().includes(normalizedExisting.toLowerCase());
        });
       
        if (!isDuplicate) {
          uniqueContractors.push(normalizedContractor);
        }
      });
     
      console.log('📊 Unique contractors found after advanced deduplication:', uniqueContractors);
      console.log('📊 Total contractors count:', uniqueContractors.length);
     
      // Fetch data for each contractor
      for (const contractor of uniqueContractors) {
        try {
          console.log(`🔄 Fetching data for contractor: ${contractor}`);
          const contractorData = await fetchClAdditionTrendForContractor(contractor);
          allContractorsData[contractor] = contractorData;
        } catch (error) {
          console.error(`❌ Error fetching data for contractor ${contractor}:`, error);
          allContractorsData[contractor] = {
            trendData: [],
            totalAdditions: 0,
            error: true
          };
        }
      }
     
      // Calculate overall totals
      const overallTotals = clAdditionTrendData.reduce((acc, item) => {
        acc.totalAdditions += item.value;
        acc.monthlyTargets += item.target;
        return acc;
      }, { totalAdditions: 0, monthlyTargets: 0 });
     
      // Create comprehensive HTML content
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>CL Addition Trend Comprehensive Report</title>
          <style>
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              margin: 0;
              padding: 20px;
              background: #f8fafc;
              color: #1e293b;
              line-height: 1.6;
            }
            .header {
              text-align: center;
              margin-bottom: 30px;
              padding: 25px;
              background: linear-gradient(135deg, #0a41b1 0%, #3cd9e8 100%);
              color: white;
              border-radius: 12px;
              box-shadow: 0 4px 20px rgba(10, 65, 177, 0.3);
            }
            .header h1 {
              margin: 0 0 10px 0;
              font-size: 2.5rem;
              font-weight: 700;
            }
            .header p {
              margin: 0;
              font-size: 1.2rem;
              opacity: 0.9;
            }
            .report-info {
              background: white;
              padding: 25px;
              border-radius: 12px;
              margin-bottom: 25px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .report-info h3 {
              margin: 0 0 20px 0;
              color: #0a41b1;
              font-size: 1.4rem;
            }
            .info-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
              gap: 20px;
            }
            .info-item {
              display: flex;
              flex-direction: column;
              padding: 15px;
              background: #f8fafc;
              border-radius: 8px;
              border-left: 4px solid #0a41b1;
            }
            .info-label {
              font-weight: 600;
              color: #64748b;
              font-size: 0.9rem;
              margin-bottom: 5px;
            }
            .info-value {
              color: #1e293b;
              font-size: 1.1rem;
              font-weight: 700;
            }
            .section {
              background: white;
              border-radius: 12px;
              padding: 25px;
              margin-bottom: 25px;
              box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            }
            .section-title {
              font-size: 1.5rem;
              font-weight: 700;
              color: #0a41b1;
              margin-bottom: 20px;
              padding-bottom: 10px;
              border-bottom: 2px solid #e2e8f0;
            }
            .trend-table {
              width: 100%;
              border-collapse: collapse;
              font-size: 0.9rem;
              margin-top: 20px;
            }
            .trend-table th {
              background: linear-gradient(135deg, #0a41b1, #3cd9e8);
              color: white;
              padding: 15px 12px;
              text-align: left;
              font-weight: 600;
              font-size: 0.9rem;
            }
            .trend-table td {
              padding: 12px;
              border-bottom: 1px solid #e2e8f0;
            }
            .trend-table tr:nth-child(even) {
              background: #f8fafc;
            }
            .month-cell {
              font-weight: 600;
              color: #0a41b1;
            }
            .value-cell {
              text-align: center;
              font-weight: 700;
              font-size: 1.1rem;
            }
            .target-cell {
              text-align: center;
              color: #64748b;
            }
            .performance-cell {
              text-align: center;
              font-weight: 600;
            }
            .performance-excellent {
              color: #10B981;
            }
            .performance-good {
              color: #3B82F6;
            }
            .performance-average {
              color: #F59E0B;
            }
            .performance-poor {
              color: #EF4444;
            }
            .contractor-section {
              margin-bottom: 30px;
              page-break-inside: avoid;
            }
            .contractor-header {
              background: linear-gradient(135deg, #f8fafc, #e2e8f0);
              padding: 15px 20px;
              border-radius: 8px;
              margin-bottom: 15px;
              border-left: 4px solid #0a41b1;
            }
            .contractor-name {
              font-size: 1.3rem;
              font-weight: 700;
              color: #0a41b1;
              margin: 0 0 5px 0;
            }
            .contractor-stats {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
              gap: 15px;
              margin-top: 10px;
            }
            .stat-item {
              text-align: center;
              padding: 10px;
              background: white;
              border-radius: 6px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .stat-value {
              font-size: 1.2rem;
              font-weight: 700;
              color: #0a41b1;
            }
            .stat-label {
              font-size: 0.8rem;
              color: #64748b;
              margin-top: 2px;
            }
            .contractor-table {
              width: 100%;
              border-collapse: collapse;
              font-size: 0.85rem;
              margin-top: 15px;
            }
            .contractor-table th {
              background: #64748b;
              color: white;
              padding: 10px 8px;
              text-align: center;
              font-weight: 600;
            }
            .contractor-table td {
              padding: 8px;
              border-bottom: 1px solid #e2e8f0;
              text-align: center;
            }
            .contractor-table tr:nth-child(even) {
              background: #f8fafc;
            }
            .summary-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
              gap: 15px;
              margin-top: 20px;
            }
            .summary-card {
              background: #f8fafc;
              padding: 20px;
              border-radius: 8px;
              text-align: center;
              border: 1px solid #e2e8f0;
            }
            .summary-value {
              font-size: 2rem;
              font-weight: 700;
              color: #0a41b1;
              margin-bottom: 5px;
            }
            .summary-label {
              color: #64748b;
              font-size: 0.9rem;
            }
            .footer {
              margin-top: 40px;
              text-align: center;
              color: #64748b;
              font-size: 0.9rem;
              padding: 20px;
              background: #f8fafc;
              border-radius: 8px;
            }
            .page-break {
              page-break-before: always;
            }
            @media print {
              body { margin: 0; padding: 10px; }
              .header { margin-bottom: 20px; }
              .trend-table, .contractor-table { font-size: 0.8rem; }
              .trend-table th, .trend-table td, .contractor-table th, .contractor-table td { padding: 6px 4px; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>CL Addition Trend Comprehensive Report</h1>
            <p>Generated on ${currentDate.toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}</p>
          </div>
         
          <div class="report-info">
            <h3>Executive Summary</h3>
            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">Report Period</span>
                <span class="info-value">Last 6 Months</span>
              </div>
              <div class="info-item">
                <span class="info-label">Total Contractors</span>
                <span class="info-value">${uniqueContractors.length}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Data Status</span>
                <span class="info-value">${clAdditionTrendData.length > 0 && clAdditionTrendData[0].isRealTime ? 'LIVE DATA' : 'SAMPLE DATA'}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Total Additions</span>
                <span class="info-value">${overallTotals.totalAdditions}</span>
              </div>
            </div>
          </div>
         
          <!-- Overall Summary Section -->
          <div class="section">
            <div class="section-title">Overall Performance Summary</div>
            <div class="summary-grid">
              <div class="summary-card">
                <div class="summary-value">${overallTotals.totalAdditions}</div>
                <div class="summary-label">Total Additions</div>
              </div>
              <div class="summary-card">
                <div class="summary-value">${uniqueContractors.length}</div>
                <div class="summary-label">Active Contractors</div>
              </div>
              <div class="summary-card">
                <div class="summary-value">${clAdditionTrendData.length}</div>
                <div class="summary-label">Months Tracked</div>
              </div>
              <div class="summary-card">
                <div class="summary-value">${(overallTotals.totalAdditions / clAdditionTrendData.length).toFixed(1)}</div>
                <div class="summary-label">Average per Month</div>
              </div>
            </div>
          </div>
         
          <!-- Overall Trend Table -->
          <div class="section">
            <div class="section-title">Overall CL Addition Trend (Last 6 Months)</div>
            <table class="trend-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Employees Joined</th>
                </tr>
              </thead>
              <tbody>
                ${clAdditionTrendData.map((item, index) => {
                  return `
                    <tr>
                      <td class="month-cell">${item.month}</td>
                      <td class="value-cell">${item.value}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
         
          <!-- Individual Contractor Details -->
          <div class="section page-break">
            <div class="section-title">Individual Contractor Performance</div>
            ${uniqueContractors.map((contractor, index) => {
              const contractorData = allContractorsData[contractor];
              if (!contractorData || contractorData.error) {
                return `
                  <div class="contractor-section">
                    <div class="contractor-header">
                      <div class="contractor-name">${contractor}</div>
                      <div style="color: #EF4444; font-size: 0.9rem;">Data not available</div>
            </div>
          </div>
                `;
              }
             
              const totalAdditions = contractorData.trendData.reduce((sum, item) => sum + item.value, 0);
              const totalTarget = contractorData.trendData.reduce((sum, item) => sum + item.target, 0);
              const achievementRate = totalTarget > 0 ? ((totalAdditions / totalTarget) * 100).toFixed(1) : 0;
             
              return `
                <div class="contractor-section">
                  <div class="contractor-header">
                    <div class="contractor-name">${contractor}</div>
                    <div class="contractor-stats">
                      <div class="stat-item">
                        <div class="stat-value">${totalAdditions}</div>
                        <div class="stat-label">Total Additions</div>
                      </div>
                      <div class="stat-item">
                        <div class="stat-value">${contractorData.trendData.length}</div>
                        <div class="stat-label">Months Active</div>
                      </div>
                      <div class="stat-item">
                        <div class="stat-value">${(totalAdditions / contractorData.trendData.length).toFixed(1)}</div>
                        <div class="stat-label">Average per Month</div>
                      </div>
                    </div>
                  </div>
                 
                  <table class="contractor-table">
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th>Additions</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${contractorData.trendData.map((item, monthIndex) => {
                        return `
                          <tr>
                            <td class="month-cell">${item.month}</td>
                            <td class="value-cell">${item.value}</td>
                          </tr>
                        `;
                      }).join('')}
                    </tbody>
                  </table>
                </div>
              `;
            }).join('')}
          </div>
         
          <div class="footer">
            <p>This comprehensive report was generated automatically by the Payroll Management System</p>
            <p>Includes data for all contractors with individual performance breakdowns</p>
            <p>For questions or support, please contact your system administrator</p>
          </div>
        </body>
        </html>
      `;
     
      // Create a blob with the HTML content
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
     
      // Create a temporary link element for download
      const link = document.createElement('a');
      link.href = url;
      link.download = `CL_Addition_Trend_Comprehensive_All_Contractors_${dateString}_${timeString}.html`;
     
      // Append to body, click, and remove
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
     
      // Clean up the URL object
      URL.revokeObjectURL(url);
     
      console.log('✅ Comprehensive CL Addition Trend PDF generated successfully');
     
    } catch (error) {
      console.error('Error generating comprehensive CL Addition Trend PDF:', error);
      alert('Error generating PDF. Please try again.');
    }
  };

  // Helper function to fetch CL Addition Trend data for a specific contractor
  const fetchClAdditionTrendForContractor = async (contractor) => {
    try {
      console.log(`🔄 Fetching CL Addition Trend data for contractor: ${contractor}`);
     
      // Get current date and calculate last 6 months dynamically
      const today = new Date();
      const months = [];
     
      for (let i = 5; i >= 0; i--) {
        const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const monthName = date.toLocaleDateString('en-US', { month: 'short' });
        const monthKey = date.toISOString().slice(0, 7); // YYYY-MM format
       
        months.push({
          month: monthName,
          monthKey: monthKey,
          year: date.getFullYear(),
          monthNum: date.getMonth() + 1
        });
      }
     
      // Fetch employee data
      const timestamp = new Date().getTime();
      const response = await fetch(`/server/cms_function/employees?returnAll=true&_t=${timestamp}`, {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      const data = await response.json();
     
      if (data.status === 'success' && data.data && data.data.employees) {
        const employees = data.data.employees;
       
        // Filter employees by contractor
        const filteredEmployees = employees.filter(employee =>
          employee.contractor && employee.contractor.toLowerCase().includes(contractor.toLowerCase())
        );
       
        // Initialize monthly counts
        const monthlyCounts = {};
        months.forEach(({ month }) => {
          monthlyCounts[month] = { count: 0 };
        });
       
        // Count employees who joined in each month
        const currentYear = new Date().getFullYear();
        months.forEach(({ month }) => {
          const monthEmployees = getEmployeesForMonth(filteredEmployees, month, currentYear, contractor);
          monthlyCounts[month].count = monthEmployees.length;
        });
       
        // Convert to chart data format
        const trendData = months.map(({ month }) => ({
          month: month,
          value: monthlyCounts[month].count,
          target: 15, // Set a target of 15 employees per month
          lastUpdated: new Date().toISOString(),
          isRealTime: true
        }));
       
        return {
          trendData,
          totalAdditions: trendData.reduce((sum, item) => sum + item.value, 0),
          error: false
        };
      } else {
        // Return empty data if no employees found
        const trendData = months.map(({ month }) => ({
          month: month,
          value: 0,
          target: 15,
          lastUpdated: new Date().toISOString(),
          isRealTime: false
        }));
       
        return {
          trendData,
          totalAdditions: 0,
          error: false
        };
      }
    } catch (error) {
      console.error(`❌ Error fetching data for contractor ${contractor}:`, error);
      return {
        trendData: [],
        totalAdditions: 0,
        error: true
      };
    }
  };

  // Handle PDF Download for CL Attrition Trend - Enhanced with All Contractors Data
  const handleDownloadCLAttritionTrendPDF = async () => {
    try {
      // Get current date for filename
      const currentDate = new Date();
      const dateString = currentDate.toISOString().split('T')[0];
      const timeString = currentDate.toTimeString().split(' ')[0].replace(/:/g, '-');
     
      console.log('🔄 Starting comprehensive CL Attrition Trend PDF generation...');
     
      // Fetch all contractors data for comprehensive report
      const allContractorsData = {};
      const contractorsList = [];
     
      // Get all contractors from the current contractor list
      if (contractorList && contractorList.length > 0) {
        // Filter out 'All' option as it's just a filter, not an actual contractor
        const actualContractors = contractorList.filter(contractor => contractor !== 'All');
        contractorsList.push(...actualContractors);
        console.log('📋 Contractors from state (excluding All):', actualContractors);
      }
     
      // Also get contractors from employee data
      try {
        const timestamp = new Date().getTime();
        const response = await fetch(`/server/cms_function/employees?returnAll=true&_t=${timestamp}`, {
          method: 'GET',
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        const data = await response.json();
       
        if (data.status === 'success' && data.data && data.data.employees) {
          const employees = data.data.employees;
          const employeeContractors = [...new Set(
            employees
              .map(emp => emp.contractor)
              .filter(contractor => contractor && contractor.trim() !== '')
          )];
          contractorsList.push(...employeeContractors);
          console.log('📋 Contractors from employee data:', employeeContractors);
        }
      } catch (error) {
        console.log('⚠️ Could not fetch contractors from employee data:', error);
      }
     
      console.log('📋 All contractors before deduplication:', contractorsList);
     
      // Remove duplicates and get unique contractors with advanced deduplication
      const uniqueContractors = [];
      contractorsList.forEach(contractor => {
        if (!contractor || contractor.trim() === '') return;
       
        const normalizedContractor = contractor.trim();
        const isDuplicate = uniqueContractors.some(existing => {
          const normalizedExisting = existing.trim();
          // Check for exact match or if one contains the other (case insensitive)
          return normalizedExisting.toLowerCase() === normalizedContractor.toLowerCase() ||
                 normalizedExisting.toLowerCase().includes(normalizedContractor.toLowerCase()) ||
                 normalizedContractor.toLowerCase().includes(normalizedExisting.toLowerCase());
        });
       
        if (!isDuplicate) {
          uniqueContractors.push(normalizedContractor);
        }
      });
     
      console.log('📊 Unique contractors found after advanced deduplication:', uniqueContractors);
      console.log('📊 Total contractors count:', uniqueContractors.length);
     
      // Fetch data for each contractor
      for (const contractor of uniqueContractors) {
        try {
          console.log(`🔄 Fetching attrition data for contractor: ${contractor}`);
          const contractorData = await fetchClAttritionTrendForContractor(contractor);
          allContractorsData[contractor] = contractorData;
        } catch (error) {
          console.error(`❌ Error fetching attrition data for contractor ${contractor}:`, error);
          allContractorsData[contractor] = {
            trendData: [],
            totalAttrition: 0,
            error: true
          };
        }
      }
     
      // Calculate overall totals
      const overallTotals = clAttritionTrendData.reduce((acc, item) => {
        acc.totalAttrition += item.value;
        return acc;
      }, { totalAttrition: 0 });
     
      // Create comprehensive HTML content
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>CL Attrition Trend Comprehensive Report</title>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            * {
              box-sizing: border-box;
            }
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              margin: 0;
              padding: 30px;
              background: #f8fafc;
              color: #1e293b;
              line-height: 1.6;
              min-width: 1200px;
              font-size: 16px;
            }
            @media screen {
              body {
                padding: 40px;
                max-width: 1400px;
                margin: 0 auto;
              }
            }
            .header {
              text-align: center;
              margin-bottom: 30px;
              padding: 25px;
              background: linear-gradient(135deg, #0a41b1 0%, #3cd9e8 100%);
              color: white;
              border-radius: 12px;
              box-shadow: 0 4px 20px rgba(10, 65, 177, 0.3);
            }
            .header h1 {
              margin: 0 0 10px 0;
              font-size: 2.5rem;
              font-weight: 700;
            }
            .header p {
              margin: 0;
              font-size: 1.2rem;
              opacity: 0.9;
            }
            .report-info {
              background: white;
              padding: 25px;
              border-radius: 12px;
              margin-bottom: 25px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .report-info h3 {
              margin: 0 0 20px 0;
              color: #0a41b1;
              font-size: 1.4rem;
            }
            .info-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
              gap: 20px;
            }
            .info-item {
              display: flex;
              flex-direction: column;
              padding: 15px;
              background: #f8fafc;
              border-radius: 8px;
              border-left: 4px solid #0a41b1;
            }
            .info-label {
              font-weight: 600;
              color: #64748b;
              font-size: 0.9rem;
              margin-bottom: 5px;
            }
            .info-value {
              color: #1e293b;
              font-size: 1.1rem;
              font-weight: 700;
            }
            .section {
              background: white;
              border-radius: 12px;
              padding: 25px;
              margin-bottom: 25px;
              box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            }
            .section-title {
              font-size: 1.5rem;
              font-weight: 700;
              color: #0a41b1;
              margin-bottom: 20px;
              padding-bottom: 10px;
              border-bottom: 2px solid #e2e8f0;
            }
            .trend-table {
              width: 100%;
              border-collapse: collapse;
              font-size: 0.9rem;
              margin-top: 20px;
            }
            .trend-table th {
              background: linear-gradient(135deg, #0a41b1, #3cd9e8);
              color: white;
              padding: 15px 12px;
              text-align: left;
              font-weight: 600;
              font-size: 0.9rem;
            }
            .trend-table td {
              padding: 12px;
              border-bottom: 1px solid #e2e8f0;
            }
            .trend-table tr:nth-child(even) {
              background: #f8fafc;
            }
            .month-cell {
              font-weight: 600;
              color: #0a41b1;
            }
            .value-cell {
              text-align: center;
              font-weight: 700;
              font-size: 1.1rem;
            }
            .benchmark-cell {
              text-align: center;
              color: #64748b;
            }
            .performance-cell {
              text-align: center;
              font-weight: 600;
            }
            .performance-excellent {
              color: #10B981;
            }
            .performance-good {
              color: #3B82F6;
            }
            .performance-average {
              color: #F59E0B;
            }
            .performance-poor {
              color: #EF4444;
            }
            .contractor-section {
              margin-bottom: 30px;
              page-break-inside: avoid;
            }
            .contractor-header {
              background: linear-gradient(135deg, #f8fafc, #e2e8f0);
              padding: 15px 20px;
              border-radius: 8px;
              margin-bottom: 15px;
              border-left: 4px solid #0a41b1;
            }
            .contractor-name {
              font-size: 1.3rem;
              font-weight: 700;
              color: #0a41b1;
              margin: 0 0 5px 0;
            }
            .contractor-stats {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
              gap: 15px;
              margin-top: 10px;
            }
            .stat-item {
              text-align: center;
              padding: 10px;
              background: white;
              border-radius: 6px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .stat-value {
              font-size: 1.2rem;
              font-weight: 700;
              color: #0a41b1;
            }
            .stat-label {
              font-size: 0.8rem;
              color: #64748b;
              margin-top: 2px;
            }
            .contractor-table {
              width: 100%;
              border-collapse: collapse;
              font-size: 0.85rem;
              margin-top: 15px;
            }
            .contractor-table th {
              background: #64748b;
              color: white;
              padding: 10px 8px;
              text-align: center;
              font-weight: 600;
            }
            .contractor-table td {
              padding: 8px;
              border-bottom: 1px solid #e2e8f0;
              text-align: center;
            }
            .contractor-table tr:nth-child(even) {
              background: #f8fafc;
            }
            .summary-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
              gap: 15px;
              margin-top: 20px;
            }
            .summary-card {
              background: #f8fafc;
              padding: 20px;
              border-radius: 8px;
              text-align: center;
              border: 1px solid #e2e8f0;
            }
            .summary-value {
              font-size: 2rem;
              font-weight: 700;
              color: #0a41b1;
              margin-bottom: 5px;
            }
            .summary-label {
              color: #64748b;
              font-size: 0.9rem;
            }
            .footer {
              margin-top: 40px;
              text-align: center;
              color: #64748b;
              font-size: 0.9rem;
              padding: 20px;
              background: #f8fafc;
              border-radius: 8px;
            }
            .page-break {
              page-break-before: always;
            }
            @media print {
              body { margin: 0; padding: 10px; }
              .header { margin-bottom: 20px; }
              .trend-table, .contractor-table { font-size: 0.8rem; }
              .trend-table th, .trend-table td, .contractor-table th, .contractor-table td { padding: 6px 4px; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>CL Attrition Trend Comprehensive Report</h1>
            <p>Generated on ${currentDate.toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}</p>
          </div>
         
          <div class="report-info">
            <h3>Executive Summary</h3>
            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">Report Period</span>
                <span class="info-value">All Exit Dates</span>
              </div>
              <div class="info-item">
                <span class="info-label">Total Contractors</span>
                <span class="info-value">${uniqueContractors.length}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Data Status</span>
                <span class="info-value">${clAttritionTrendData.length > 0 && clAttritionTrendData[0].isRealTime ? 'LIVE DATA' : 'SAMPLE DATA'}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Total Attrition</span>
                <span class="info-value">${overallTotals.totalAttrition}</span>
              </div>
            </div>
          </div>
         
          <!-- Overall Summary Section -->
          <div class="section">
            <div class="section-title">Overall Performance Summary</div>
            <div class="summary-grid">
              <div class="summary-card">
                <div class="summary-value">${overallTotals.totalAttrition}</div>
                <div class="summary-label">Total Attrition</div>
              </div>
              <div class="summary-card">
                <div class="summary-value">${clAttritionTrendData.length}</div>
                <div class="summary-label">Months Tracked</div>
              </div>
              <div class="summary-card">
                <div class="summary-value">${(overallTotals.totalAttrition / clAttritionTrendData.length).toFixed(1)}</div>
                <div class="summary-label">Average per Month</div>
              </div>
              <div class="summary-card">
                <div class="summary-value">${uniqueContractors.length}</div>
                <div class="summary-label">Active Contractors</div>
              </div>
            </div>
          </div>
         
          <!-- Overall Trend Table -->
          <div class="section">
            <div class="section-title">Overall CL Attrition Trend (All Exit Dates)</div>
            <table class="trend-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Employees Left</th>
                </tr>
              </thead>
              <tbody>
                ${clAttritionTrendData.map((item, index) => {
                  return `
                    <tr>
                      <td class="month-cell">${item.month}</td>
                      <td class="value-cell">${item.value}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
         
          <!-- Individual Contractor Details -->
          <div class="section page-break">
            <div class="section-title">Individual Contractor Performance</div>
            ${uniqueContractors.map((contractor, index) => {
              const contractorData = allContractorsData[contractor];
              if (!contractorData || contractorData.error) {
                return `
                  <div class="contractor-section">
                    <div class="contractor-header">
                      <div class="contractor-name">${contractor}</div>
                      <div style="color: #EF4444; font-size: 0.9rem;">Data not available</div>
            </div>
          </div>
                `;
              }
             
              const totalAttrition = contractorData.trendData.reduce((sum, item) => sum + item.value, 0);
             
              return `
                <div class="contractor-section">
                  <div class="contractor-header">
                    <div class="contractor-name">${contractor}</div>
                    <div class="contractor-stats">
                      <div class="stat-item">
                        <div class="stat-value">${totalAttrition}</div>
                        <div class="stat-label">Total Attrition</div>
                      </div>
                      <div class="stat-item">
                        <div class="stat-value">${contractorData.trendData.length}</div>
                        <div class="stat-label">Months Active</div>
                      </div>
                      <div class="stat-item">
                        <div class="stat-value">${(totalAttrition / contractorData.trendData.length).toFixed(1)}</div>
                        <div class="stat-label">Average per Month</div>
                      </div>
                    </div>
                  </div>
                 
                  <table class="contractor-table">
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th>Attrition</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${contractorData.trendData.map((item, monthIndex) => {
                        return `
                          <tr>
                            <td class="month-cell">${item.month}</td>
                            <td class="value-cell">${item.value}</td>
                          </tr>
                        `;
                      }).join('')}
                    </tbody>
                  </table>
                </div>
              `;
            }).join('')}
          </div>
         
          <div class="footer">
            <p>This comprehensive report was generated automatically by the Payroll Management System</p>
            <p>Includes data for all contractors with individual performance breakdowns</p>
            <p>For questions or support, please contact your system administrator</p>
          </div>
        </body>
        </html>
      `;
     
      // Create a blob with the HTML content
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
     
      // Open in new window with proper sizing for better display
      const newWindow = window.open(url, '_blank', 'width=1400,height=900,scrollbars=yes,resizable=yes');
     
      // Also provide download option
      const link = document.createElement('a');
      link.href = url;
      link.download = `CL_Attrition_Trend_Comprehensive_All_Contractors_${dateString}_${timeString}.html`;
     
      // Append to body, click, and remove
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
     
      // Clean up the URL object after a delay to allow download
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
     
      console.log('✅ Comprehensive CL Attrition Trend PDF generated successfully');
     
    } catch (error) {
      console.error('Error generating comprehensive CL Attrition Trend PDF:', error);
      alert('Error generating PDF. Please try again.');
    }
  };

  // Helper function to fetch CL Attrition Trend data for a specific contractor
  const fetchClAttritionTrendForContractor = async (contractor) => {
    try {
      console.log(`🔄 Fetching CL Attrition Trend data for contractor: ${contractor}`);
     
      // Get current date and calculate last 6 months dynamically
      const today = new Date();
      const months = [];
     
      for (let i = 5; i >= 0; i--) {
        const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const monthName = date.toLocaleDateString('en-US', { month: 'short' });
        const monthKey = date.toISOString().slice(0, 7); // YYYY-MM format
       
        months.push({
          month: monthName,
          monthKey: monthKey,
          year: date.getFullYear(),
          monthNum: date.getMonth() + 1
        });
      }
     
      // Fetch employee data
      const timestamp = new Date().getTime();
      const response = await fetch(`/server/cms_function/employees?returnAll=true&_t=${timestamp}`, {
        method: 'GET',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      const data = await response.json();
     
      if (data.status === 'success' && data.data && data.data.employees) {
        const employees = data.data.employees;
       
        // Filter employees by contractor
        const filteredEmployees = employees.filter(employee =>
          employee.contractor && employee.contractor.toLowerCase().includes(contractor.toLowerCase())
        );
       
        // Initialize monthly counts using monthKey as unique identifier
        const monthlyCounts = {};
        months.forEach(({ month, monthKey }) => {
          monthlyCounts[monthKey] = { count: 0, month: month };
        });
       
        // Count employees who left in each month
        filteredEmployees.forEach(employee => {
          if (employee.dateOfExit) {
            const exitDate = new Date(employee.dateOfExit);
            const exitMonthKey = exitDate.toISOString().slice(0, 7); // YYYY-MM format
           
            // Find the corresponding month in our months array
            const monthData = months.find(m => m.monthKey === exitMonthKey);
            if (monthData) {
              monthlyCounts[monthData.monthKey].count++;
            }
          }
        });
       
        // Convert to chart data format
        const trendData = months.map(({ month, monthKey, year }) => {
          // Check if there are multiple months with the same name (different years)
          const sameMonthCount = months.filter(m => m.month === month).length;
          const displayMonth = sameMonthCount > 1 ? `${month} ${year}` : month;
         
          return {
            month: displayMonth,
            value: monthlyCounts[monthKey].count,
            benchmark: 8, // Set a benchmark of 8 employees per month
            lastUpdated: new Date().toISOString(),
            isRealTime: true
          };
        });
       
        return {
          trendData,
          totalAttrition: trendData.reduce((sum, item) => sum + item.value, 0),
          error: false
        };
      } else {
        // Return empty data if no employees found
        const trendData = months.map(({ month }) => ({
          month: month,
          value: 0,
          benchmark: 8,
          lastUpdated: new Date().toISOString(),
          isRealTime: true // This is real-time data showing 0 exits
        }));
       
        return {
          trendData,
          totalAttrition: 0,
          error: false
        };
      }
    } catch (error) {
      console.error(`❌ Error fetching attrition data for contractor ${contractor}:`, error);
      return {
        trendData: [],
        totalAttrition: 0,
        error: true
      };
    }
  };

  // Handle PDF Download for General Shift Daily Employee Count - Enhanced with All Contractors and All Shifts Data
  const handleDownloadGeneralShiftPDF = async () => {
    try {
      // Get current date for filename
      const currentDate = new Date();
      const dateString = currentDate.toISOString().split('T')[0];
      const timeString = currentDate.toTimeString().split(' ')[0].replace(/:/g, '-');
     
      console.log('🔄 Starting comprehensive General Shift Daily Employee Count PDF generation...');
     
      // Check if any employees are assigned to shifts
      const totalAssignedEmployees = Object.values(shiftDistribution).reduce((sum, shift) => sum + (shift.assigned || 0), 0);
      const hasAssignedEmployees = totalAssignedEmployees > 0;
     
      // Fetch all contractors data for comprehensive report
      const allContractorsData = {};
      const contractorsList = [];
     
      // Get all contractors from the current contractor list
      if (contractorList && contractorList.length > 0) {
        // Filter out 'All' option as it's just a filter, not an actual contractor
        const actualContractors = contractorList.filter(contractor => contractor !== 'All');
        contractorsList.push(...actualContractors);
        console.log('📋 Contractors from state (excluding All):', actualContractors);
      }
     
      // Also get contractors from employee data
      try {
        const timestamp = new Date().getTime();
        const response = await fetch(`/server/cms_function/employees?returnAll=true&_t=${timestamp}`, {
          method: 'GET',
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        const data = await response.json();
       
        if (data.status === 'success' && data.data && data.data.employees) {
          const employees = data.data.employees;
          const employeeContractors = [...new Set(
            employees
              .map(emp => emp.contractor)
              .filter(contractor => contractor && contractor.trim() !== '')
          )];
          contractorsList.push(...employeeContractors);
          console.log('📋 Contractors from employee data:', employeeContractors);
        }
      } catch (error) {
        console.log('⚠️ Could not fetch contractors from employee data:', error);
      }
     
      console.log('📋 All contractors before deduplication:', contractorsList);
     
      // Remove duplicates and get unique contractors with advanced deduplication
      const uniqueContractors = [];
      contractorsList.forEach(contractor => {
        if (!contractor || contractor.trim() === '') return;
       
        const normalizedContractor = contractor.trim();
        const isDuplicate = uniqueContractors.some(existing => {
          const normalizedExisting = existing.trim();
          // Check for exact match or if one contains the other (case insensitive)
          return normalizedExisting.toLowerCase() === normalizedContractor.toLowerCase() ||
                 normalizedExisting.toLowerCase().includes(normalizedContractor.toLowerCase()) ||
                 normalizedContractor.toLowerCase().includes(normalizedExisting.toLowerCase());
        });
       
        if (!isDuplicate) {
          uniqueContractors.push(normalizedContractor);
        }
      });
     
      console.log('📊 Unique contractors found after advanced deduplication:', uniqueContractors);
      console.log('📊 Total contractors count:', uniqueContractors.length);
     
      // Fetch shift data for each contractor
      for (const contractor of uniqueContractors) {
        try {
          console.log(`🔄 Fetching shift data for contractor: ${contractor}`);
          const contractorData = await fetchGeneralShiftForContractor(contractor);
          allContractorsData[contractor] = contractorData;
        } catch (error) {
          console.error(`❌ Error fetching shift data for contractor ${contractor}:`, error);
          allContractorsData[contractor] = {
            shiftWiseData: {},
            totalEmployees: 0,
            averageDaily: 0,
            error: true
          };
        }
      }
     
      // Get shift-wise data from current data and also fetch actual shifts from database
      const shiftWiseData = {};
      const chartLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
     
      // First, get all available shifts from the database
      let allAvailableShifts = [];
      try {
        console.log('🔄 Fetching all available shifts from database...');
        const shiftsResponse = await fetch('/server/Shift_function/shifts');
        const shiftsData = await shiftsResponse.json();
       
        if (shiftsData.status === 'success' && shiftsData.data && shiftsData.data.shifts) {
          allAvailableShifts = shiftsData.data.shifts.map(shift => shift.shiftName).filter(Boolean);
          allAvailableShifts = [...new Set(allAvailableShifts)]; // Remove duplicates
          console.log('📋 Available shifts from database:', allAvailableShifts);
        }
      } catch (error) {
        console.error('❌ Error fetching shifts from database:', error);
      }
     
      // Process daily shift data to organize by shift
      dailyShiftData.forEach((dayData, index) => {
        if (dayData.shifts) {
          Object.keys(dayData.shifts).forEach(shiftName => {
            if (!shiftWiseData[shiftName]) {
              shiftWiseData[shiftName] = {
                name: shiftName,
                dailyCounts: [],
                totalEmployees: 0,
                averageDaily: 0
              };
            }
           
            const dayCount = dayData.shifts[shiftName] || 0;
            shiftWiseData[shiftName].dailyCounts.push({
              day: chartLabels[index] || `Day ${index + 1}`,
              count: dayCount
            });
            shiftWiseData[shiftName].totalEmployees += dayCount;
          });
        }
      });
     
      // If no shifts found in daily data, but we have shifts in database, create empty entries
      if (Object.keys(shiftWiseData).length === 0 && allAvailableShifts.length > 0) {
        console.log('📊 No daily shift data found, but shifts exist in database. Creating entries for available shifts...');
        allAvailableShifts.forEach(shiftName => {
          shiftWiseData[shiftName] = {
            name: shiftName,
            dailyCounts: chartLabels.map(day => ({ day, count: 0 })),
            totalEmployees: 0,
            averageDaily: 0
          };
        });
      }
     
      // Calculate averages
      Object.keys(shiftWiseData).forEach(shiftName => {
        const shift = shiftWiseData[shiftName];
        shift.averageDaily = shift.dailyCounts.length > 0 ?
          (shift.totalEmployees / shift.dailyCounts.length).toFixed(1) : 0;
      });
     
      console.log('📊 Final shiftWiseData:', shiftWiseData);
      console.log('📊 Total shifts found:', Object.keys(shiftWiseData).length);
     
      // Create comprehensive HTML content
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>General Shift Daily Employee Count Comprehensive Report</title>
          <style>
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              margin: 0;
              padding: 20px;
              background: #f8fafc;
              color: #1e293b;
              line-height: 1.6;
            }
            .header {
              text-align: center;
              margin-bottom: 30px;
              padding: 25px;
              background: linear-gradient(135deg, #0a41b1 0%, #3cd9e8 100%);
              color: white;
              border-radius: 12px;
              box-shadow: 0 4px 20px rgba(10, 65, 177, 0.3);
            }
            .header h1 {
              margin: 0 0 10px 0;
              font-size: 1.8rem;
              font-weight: 700;
            }
            .header p {
              margin: 0;
              font-size: 0.9rem;
              opacity: 0.9;
            }
            .report-info {
              background: white;
              padding: 25px;
              border-radius: 12px;
              margin-bottom: 25px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .report-info h3 {
              margin: 0 0 20px 0;
              color: #0a41b1;
              font-size: 1.1rem;
            }
            .info-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
              gap: 20px;
            }
            .info-item {
              display: flex;
              flex-direction: column;
              padding: 15px;
              background: #f8fafc;
              border-radius: 8px;
              border-left: 4px solid #0a41b1;
            }
            .info-label {
              font-weight: 600;
              color: #64748b;
              font-size: 0.75rem;
              margin-bottom: 5px;
            }
            .info-value {
              color: #1e293b;
              font-size: 0.9rem;
              font-weight: 700;
            }
            .section {
              background: white;
              border-radius: 12px;
              padding: 25px;
              margin-bottom: 25px;
              box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            }
            .section-title {
              font-size: 1.2rem;
              font-weight: 700;
              color: #0a41b1;
              margin-bottom: 20px;
              padding-bottom: 10px;
              border-bottom: 2px solid #e2e8f0;
            }
            .summary-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
              gap: 20px;
              margin-bottom: 30px;
            }
            .summary-card {
              background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
              padding: 20px;
              border-radius: 12px;
              text-align: center;
              border: 2px solid #e2e8f0;
            }
            .summary-card.shifts {
              background: linear-gradient(135deg, #0a41b1 0%, #3cd9e8 100%);
              color: white;
            }
            .summary-card.employees {
              background: linear-gradient(135deg, #10B981 0%, #059669 100%);
              color: white;
            }
            .summary-card.contractors {
              background: linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%);
              color: white;
            }
            .summary-card.days {
              background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%);
              color: white;
            }
            .summary-card h3 {
              margin: 0 0 10px 0;
              font-size: 0.75rem;
              font-weight: 600;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              opacity: 0.9;
            }
            .summary-card .value {
              font-size: 1.8rem;
              font-weight: 800;
              margin: 0;
            }
            .shift-section {
              margin: 30px 0;
            }
            .shift-section h2 {
              color: #0a41b1;
              font-size: 1.2rem;
              font-weight: 700;
              margin-bottom: 20px;
              padding-bottom: 10px;
              border-bottom: 3px solid #0a41b1;
            }
            .shift-card {
              background: white;
              border: 1px solid #e2e8f0;
              border-radius: 12px;
              margin-bottom: 20px;
              overflow: hidden;
              box-shadow: 0 4px 15px rgba(0,0,0,0.1);
            }
            .shift-header {
              background: linear-gradient(135deg, #0a41b1 0%, #3cd9e8 100%);
              color: white;
              padding: 20px;
              font-size: 1rem;
              font-weight: 700;
            }
            .shift-content {
              padding: 20px;
            }
            .shift-stats {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
              gap: 15px;
              margin-bottom: 20px;
            }
            .stat-item {
              text-align: center;
              padding: 15px;
              background: #f8fafc;
              border-radius: 8px;
              border: 1px solid #e2e8f0;
            }
            .stat-label {
              font-size: 0.7rem;
              color: #64748b;
              font-weight: 600;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              margin-bottom: 5px;
            }
            .stat-value {
              font-size: 1.2rem;
              font-weight: 800;
              color: #0a41b1;
            }
            .daily-table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 15px;
            }
            .daily-table th {
              background: #f8fafc;
              color: #0a41b1;
              padding: 12px;
              text-align: center;
              font-weight: 700;
              font-size: 0.75rem;
              border: 1px solid #e2e8f0;
            }
            .daily-table td {
              padding: 12px;
              text-align: center;
              border: 1px solid #e2e8f0;
              font-weight: 600;
              font-size: 0.85rem;
            }
            .daily-table tr:nth-child(even) {
              background: #f8fafc;
            }
            .highlight {
              background: linear-gradient(135deg, #0a41b1 0%, #3cd9e8 100%);
              color: white;
              padding: 4px 8px;
              border-radius: 4px;
              font-weight: 700;
            }
            .contractors-grid {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 20px;
              margin-bottom: 30px;
            }
            .contractor-section {
              margin-bottom: 0;
              page-break-inside: avoid;
              break-inside: avoid;
            }
            .contractor-header {
              background: linear-gradient(135deg, #f8fafc, #e2e8f0);
              padding: 15px 20px;
              border-radius: 8px;
              margin-bottom: 15px;
              border-left: 4px solid #0a41b1;
            }
            .contractor-name {
              font-size: 1rem;
              font-weight: 700;
              color: #0a41b1;
              margin: 0 0 5px 0;
            }
            .contractor-stats {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
              gap: 15px;
              margin-top: 10px;
            }
            .contractor-stats .stat-item {
              text-align: center;
              padding: 10px;
              background: white;
              border-radius: 6px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .contractor-stats .stat-value {
              font-size: 1rem;
              font-weight: 700;
              color: #0a41b1;
            }
            .contractor-stats .stat-label {
              font-size: 0.7rem;
              color: #64748b;
              margin-top: 2px;
            }
            .contractor-table {
              width: 100%;
              border-collapse: collapse;
              font-size: 0.75rem;
              margin-top: 15px;
            }
            .contractor-table th {
              background: #64748b;
              color: white;
              padding: 10px 8px;
              text-align: center;
              font-weight: 600;
            }
            .contractor-table td {
              padding: 8px;
              border-bottom: 1px solid #e2e8f0;
              text-align: center;
            }
            .contractor-table tr:nth-child(even) {
              background: #f8fafc;
            }
            .footer {
              margin-top: 40px;
              text-align: center;
              color: #64748b;
              font-size: 0.75rem;
              padding: 20px;
              background: #f8fafc;
              border-radius: 8px;
            }
            .page-break {
              page-break-before: always;
            }
            .no-data {
              text-align: center;
              padding: 40px;
              color: #64748b;
              font-style: italic;
            }
            @media print {
              body { margin: 0; padding: 10px; }
              .header { margin-bottom: 20px; }
              .daily-table, .contractor-table { font-size: 0.8rem; }
              .daily-table th, .daily-table td, .contractor-table th, .contractor-table td { padding: 6px 4px; }
            }
          </style>
        </head>
        <body>
            <div class="header">
            <h1>General Shift Daily Employee Count Comprehensive Report</h1>
              <p>${hasAssignedEmployees ? 'L-Shaped Daily Employee Count' : 'Daily Employee Count (No Assignments)'}</p>
              <p>Generated on ${currentDate.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
              day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}</p>
            </div>
           
          <div class="report-info">
            <h3>Executive Summary</h3>
            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">Report Period</span>
                <span class="info-value">Last 7 Days</span>
              </div>
              <div class="info-item">
                <span class="info-label">Total Contractors</span>
                <span class="info-value">${uniqueContractors.length}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Total Shifts</span>
                <span class="info-value">${Object.keys(shiftWiseData).length}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Data Days</span>
                <span class="info-value">${dailyShiftData.length}</span>
              </div>
            </div>
          </div>
         
          <!-- Overall Summary Section -->
          <div class="section">
            <div class="section-title">Overall Shift Performance Summary</div>
              <div class="summary-grid">
              <div class="summary-card shifts">
                  <h3>Total Shifts</h3>
                <div class="value">${Object.keys(shiftWiseData).length}</div>
                </div>
              <div class="summary-card employees">
                  <h3>Total Employees</h3>
                <div class="value">${Object.values(shiftWiseData).reduce((sum, shift) => sum + shift.totalEmployees, 0)}</div>
                </div>
              <div class="summary-card contractors">
                <h3>Total Contractors</h3>
                <div class="value">${uniqueContractors.length}</div>
                </div>
              <div class="summary-card days">
                  <h3>Data Days</h3>
                <div class="value">${dailyShiftData.length}</div>
              </div>
                </div>
              </div>

          <!-- Overall Shift Analysis -->
          <div class="section">
            <div class="section-title">Overall Shift-wise Daily Employee Count Analysis</div>
                <p style="color: #64748b; font-size: 0.85rem; line-height: 1.6; margin-bottom: 20px;">
                  This report provides a detailed breakdown of daily employee counts organized by shift.
                  Each shift section shows the daily distribution of employees over the last 7 days.
                </p>
               
                ${Object.keys(shiftWiseData).length > 0 ?
                  Object.values(shiftWiseData).map(shift => `
                    <div class="shift-card">
                      <div class="shift-header">
                        ${shift.name} Shift
                      </div>
                      <div class="shift-content">
                        <div class="shift-stats">
                          <div class="stat-item">
                            <div class="stat-label">Total Employees</div>
                            <div class="stat-value">${shift.totalEmployees}</div>
                          </div>
                        </div>
                       
                        <table class="daily-table">
                          <thead>
                            <tr>
                              <th>Day</th>
                              <th>Employee Count</th>
                            </tr>
                          </thead>
                          <tbody>
                            ${shift.dailyCounts.map(day => `
                              <tr>
                                <td><strong>${day.day}</strong></td>
                                <td><span class="highlight">${day.count}</span></td>
                              </tr>
                            `).join('')}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  `).join('') :
                  '<div class="no-data">No shift data available for the selected period.</div>'
                }
              </div>
         
          <!-- Individual Contractor Details -->
          <div class="section page-break">
            <div class="section-title">Individual Contractor Performance</div>
            <div class="contractors-grid">
            ${uniqueContractors.map((contractor, index) => {
              const contractorData = allContractorsData[contractor];
              if (!contractorData || contractorData.error) {
                return `
                  <div class="contractor-section">
                    <div class="contractor-header">
                      <div class="contractor-name">${contractor}</div>
                      <div style="color: #EF4444; font-size: 0.75rem;">Data not available</div>
            </div>
                  </div>
                `;
              }
             
              return `
                <div class="contractor-section">
                  <div class="contractor-header">
                    <div class="contractor-name">${contractor}</div>
                    <div class="contractor-stats">
                      <div class="stat-item">
                        <div class="stat-value">${contractorData.totalEmployees}</div>
                        <div class="stat-label">Total Employees</div>
                      </div>
                    </div>
                  </div>
                 
                  ${Object.keys(contractorData.shiftWiseData).length > 0 ? `
                    <table class="contractor-table">
                      <thead>
                        <tr>
                          <th>Shift</th>
                          <th>Total Employees</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${Object.values(contractorData.shiftWiseData).map(shift => `
                          <tr>
                            <td><strong>${shift.name}</strong></td>
                            <td><span class="highlight">${shift.totalEmployees}</span></td>
                          </tr>
                        `).join('')}
                      </tbody>
                    </table>
                  ` : `
                    <div class="no-data">No shift data available for this contractor.</div>
                  `}
                </div>
              `;
            }).join('')}
            </div>
          </div>
         
          <div class="footer">
            <p>This comprehensive report was generated automatically by the Payroll Management System</p>
            <p>Includes data for all contractors and all shifts with individual performance breakdowns</p>
            <p>For questions or support, please contact your system administrator</p>
          </div>
        </body>
        </html>
      `;
     
      // Create a blob with the HTML content
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
     
      // Create a temporary link element for download
      const link = document.createElement('a');
      link.href = url;
      link.download = `General_Shift_Daily_Employee_Count_Comprehensive_All_Contractors_All_Shifts_${dateString}_${timeString}.html`;
     
      // Append to body, click, and remove
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
     
      // Clean up the URL object
      URL.revokeObjectURL(url);
     
      console.log('✅ Comprehensive General Shift Daily Employee Count PDF generated successfully');
     
    } catch (error) {
      console.error('Error generating comprehensive General Shift PDF:', error);
      alert('Error generating PDF. Please try again.');
    }
  };

  // Helper function to fetch General Shift data for a specific contractor
  const fetchGeneralShiftForContractor = async (contractor) => {
    try {
      console.log(`🔄 Fetching General Shift data for contractor: ${contractor}`);
     
      // Calculate last 7 days
      const today = new Date();
      const last7Days = [];
     
      for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(today.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const dayName = i === 0 ? 'Today' : date.toLocaleDateString('en-US', { weekday: 'short' });
       
        last7Days.push({ date: dateStr, day: dayName });
      }
     
      // Get employees under this contractor
      const employeesUnderContractor = await fetchEmployeesByContractor(contractor);
     
      if (employeesUnderContractor.length === 0) {
        return {
          shiftWiseData: {},
          totalEmployees: 0,
          averageDaily: 0,
          error: false
        };
      }
     
      // Preload employees for name mapping
      const empIdToCode = {};
      try {
        const empRes = await fetch(`/server/cms_function/employees?returnAll=true&userRole=${encodeURIComponent(userRole || '')}&userEmail=${encodeURIComponent(userEmail || '')}`);
        const empJson = await empRes.json();
        if (empJson?.status === 'success' && empJson?.data?.employees) {
          for (const e of empJson.data.employees) {
            const code = e.employeeCode || e.EmployeeCode || e.EmployeeID || e.id;
            const internalId = String(e.id || e.EmployeeID || e.EmployeeId || e.employeeId || e.EmployeeCode || code || '');
            if (internalId && code) empIdToCode[internalId] = String(code);
            if (code) empIdToCode[String(code)] = String(code);
          }
        }
      } catch (e) {
        console.warn('⚠️ Failed to preload employees for name mapping:', e);
      }
     
      // Get shift-wise data for this contractor using actual attendance data
      const shiftWiseData = {};
      const dailyCounts = [];
     
      // Process daily attendance data for this contractor
      for (let i = 0; i < last7Days.length; i++) {
        const { date, day } = last7Days[i];
        const presentIds = new Set();
       
        try {
          // 1. Fetch from BHR table (GetAttendanceList)
          try {
            const attRes = await fetch(`/server/GetAttendanceList?startDate=${date}&endDate=${date}&summary=true`);
            const attJson = await attRes.json();
            if (attJson?.data?.length) {
              for (const rec of attJson.data) {
                const rawEid = String(rec.EmployeeID || rec.EmployeeId || rec.employeeId || rec.EmployeeCode || '');
                const eid = empIdToCode[rawEid] || rawEid;
                const firstIn = rec.FirstIN || rec.FirstIn || rec.firstIn || '';
                if (eid && firstIn && String(firstIn).trim() !== '') {
                  // Check if this employee belongs to the contractor
                  if (employeesUnderContractor.includes(eid) ||
                      employeesUnderContractor.includes(String(eid)) ||
                      employeesUnderContractor.includes(Number(eid))) {
                    presentIds.add(eid);
                  }
                }
              }
            }
          } catch (e) {
            console.warn(`⚠️ Failed to fetch BHR attendance for ${date}:`, e);
          }

          // 2. Fetch from Attendance table
          try {
            const importRes = await fetch(`/server/importattendance_function/attendance?startDate=${date}&endDate=${date}&perPage=1000`);
            const importJson = importRes.ok ? await importRes.json() : { data: { attendanceRecords: [] } };
            if (importJson?.data?.attendanceRecords?.length) {
              for (const rec of importJson.data.attendanceRecords) {
                const rawEid = String(rec.employeeId || rec.EmployeeID || rec.EmployeeId || rec.employeeCode || '');
                const eid = empIdToCode[rawEid] || rawEid;
                const firstIn = rec.firstIn || rec.FirstIN || rec.FirstIn || '';
                if (eid && firstIn && String(firstIn).trim() !== '') {
                  if (employeesUnderContractor.includes(eid) ||
                      employeesUnderContractor.includes(String(eid)) ||
                      employeesUnderContractor.includes(Number(eid))) {
                    presentIds.add(eid);
                  }
                }
              }
            }
          } catch (e) {
            console.warn(`⚠️ Failed to fetch Attendance table data for ${date}:`, e);
          }

          // 3. Check localStorage for today
          const todayDate = new Date().toISOString().split('T')[0];
          if (date === todayDate) {
            try {
              const importedDataStr = localStorage.getItem('importedAttendanceData');
              if (importedDataStr) {
                const importedData = JSON.parse(importedDataStr);
                if (importedData && importedData.length > 0) {
                  for (const rec of importedData) {
                    const rawEid = String(rec.EmployeeID || rec.EmployeeId || rec.employeeId || rec.EmployeeCode || '');
                    const eid = empIdToCode[rawEid] || rawEid;
                    const firstIn = rec.FirstIN || rec.FirstIn || rec.firstIn || '';
                    if (eid && firstIn && String(firstIn).trim() !== '') {
                      if (employeesUnderContractor.includes(eid) ||
                          employeesUnderContractor.includes(String(eid)) ||
                          employeesUnderContractor.includes(Number(eid))) {
                        presentIds.add(eid);
                      }
                    }
                  }
                }
              }
            } catch (e) {
              console.warn(`⚠️ Failed to parse localStorage data for ${date}:`, e);
            }
          }

          // Count present employees for this contractor on this day
          const presentCount = presentIds.size;
          dailyCounts.push({ day, count: presentCount });
         
          // Add to General shift (all present employees are counted as General)
          if (!shiftWiseData['General']) {
            shiftWiseData['General'] = {
              name: 'General',
              dailyCounts: [],
              totalEmployees: 0,
              averageDaily: 0
            };
          }
          shiftWiseData['General'].dailyCounts.push({ day, count: presentCount });
         
        } catch (err) {
          console.error(`Failed to fetch attendance data for ${date}:`, err);
          dailyCounts.push({ day, count: 0 });
          if (!shiftWiseData['General']) {
            shiftWiseData['General'] = {
              name: 'General',
              dailyCounts: [],
              totalEmployees: 0,
              averageDaily: 0
            };
          }
          shiftWiseData['General'].dailyCounts.push({ day, count: 0 });
        }
      }
     
      // Calculate totals and averages
      Object.keys(shiftWiseData).forEach(shiftName => {
        const shift = shiftWiseData[shiftName];
        shift.totalEmployees = shift.dailyCounts.reduce((sum, day) => sum + day.count, 0);
        shift.averageDaily = shift.dailyCounts.length > 0 ?
          (shift.totalEmployees / shift.dailyCounts.length).toFixed(1) : 0;
      });
     
      const totalEmployees = Object.values(shiftWiseData).reduce((sum, shift) => sum + shift.totalEmployees, 0);
      const averageDaily = dailyCounts.length > 0 ? (totalEmployees / dailyCounts.length).toFixed(1) : 0;
     
      return {
        shiftWiseData: shiftWiseData,
        totalEmployees: totalEmployees,
        averageDaily: parseFloat(averageDaily),
        error: false
      };
    } catch (error) {
      console.error(`❌ Error fetching shift data for contractor ${contractor}:`, error);
      return {
        shiftWiseData: {},
        totalEmployees: 0,
        averageDaily: 0,
        error: true
      };
    }
  };

  // Handle PDF Download for Monthly Attendance Distribution
  // Handle PDF Download for Monthly Attendance Distribution - Enhanced with All Contractors Data
  const handleDownloadMonthlyAttendancePDF = async () => {
    try {
      // Get current date for filename
      const currentDate = new Date();
      const dateString = currentDate.toISOString().split('T')[0];
      const timeString = currentDate.toTimeString().split(' ')[0].replace(/:/g, '-');
     
      console.log('🔄 Starting comprehensive Monthly Attendance Distribution PDF generation...');
     
      // Format the selected month for display
      const [year, month] = selectedMonth.split('-');
      const monthName = new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
     
      // Fetch all contractors data for comprehensive report
      const allContractorsData = {};
      const contractorsList = [];
     
      // Get all contractors from the current contractor list
      if (contractorList && contractorList.length > 0) {
        // Filter out 'All' option as it's just a filter, not an actual contractor
        const actualContractors = contractorList.filter(contractor => contractor !== 'All');
        contractorsList.push(...actualContractors);
        console.log('📋 Contractors from state (excluding All):', actualContractors);
      }
     
      // Also get contractors from employee data
      try {
        const timestamp = new Date().getTime();
        const response = await fetch(`/server/cms_function/employees?returnAll=true&_t=${timestamp}`, {
          method: 'GET',
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        const data = await response.json();
       
        if (data.status === 'success' && data.data && data.data.employees) {
          const employees = data.data.employees;
          const employeeContractors = [...new Set(
            employees
              .map(emp => emp.contractor)
              .filter(contractor => contractor && contractor.trim() !== '')
          )];
          contractorsList.push(...employeeContractors);
          console.log('📋 Contractors from employee data:', employeeContractors);
        }
      } catch (error) {
        console.log('⚠️ Could not fetch contractors from employee data:', error);
      }
     
      console.log('📋 All contractors before deduplication:', contractorsList);
     
      // Remove duplicates and get unique contractors with advanced deduplication
      const uniqueContractors = [];
      contractorsList.forEach(contractor => {
        if (!contractor || contractor.trim() === '') return;
       
        const normalizedContractor = contractor.trim();
        const isDuplicate = uniqueContractors.some(existing => {
          const normalizedExisting = existing.trim();
          // Check for exact match or if one contains the other (case insensitive)
          return normalizedExisting.toLowerCase() === normalizedContractor.toLowerCase() ||
                 normalizedExisting.toLowerCase().includes(normalizedContractor.toLowerCase()) ||
                 normalizedContractor.toLowerCase().includes(normalizedExisting.toLowerCase());
        });
       
        if (!isDuplicate) {
          uniqueContractors.push(normalizedContractor);
        }
      });
     
      console.log('📊 Unique contractors found after advanced deduplication:', uniqueContractors);
      console.log('📊 Total contractors count:', uniqueContractors.length);
     
      // Fetch attendance data for each contractor
      for (const contractor of uniqueContractors) {
        try {
          console.log(`🔄 Fetching attendance data for contractor: ${contractor}`);
          const contractorData = await fetchMonthlyAttendanceForContractor(contractor);
          allContractorsData[contractor] = contractorData;
        } catch (error) {
          console.error(`❌ Error fetching attendance data for contractor ${contractor}:`, error);
          allContractorsData[contractor] = {
            presentDays: 0,
            absentDays: 0,
            totalDays: 0,
            attendanceRate: 0,
            error: true
          };
        }
      }
     
      // Calculate overall totals from current data
      const totalPresent = attendancePieData.find(item => item.name === 'Present')?.value || 0;
      const totalAbsent = attendancePieData.find(item => item.name === 'Absent')?.value || 0;
      const totalDays = totalPresent + totalAbsent;
      const presentPercentage = totalDays > 0 ? ((totalPresent / totalDays) * 100).toFixed(1) : 0;
      const absentPercentage = totalDays > 0 ? ((totalAbsent / totalDays) * 100).toFixed(1) : 0;
     
      // Create comprehensive HTML content
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Monthly Attendance Distribution Comprehensive Report</title>
          <style>
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              margin: 0;
              padding: 20px;
              background: #f8fafc;
              color: #1e293b;
              line-height: 1.6;
            }
            .header {
              text-align: center;
              margin-bottom: 30px;
              padding: 25px;
              background: linear-gradient(135deg, #0a41b1 0%, #3cd9e8 100%);
              color: white;
              border-radius: 12px;
              box-shadow: 0 4px 20px rgba(10, 65, 177, 0.3);
            }
            .header h1 {
              margin: 0 0 10px 0;
              font-size: 2.5rem;
              font-weight: 700;
            }
            .header p {
              margin: 0;
              font-size: 1.2rem;
              opacity: 0.9;
            }
            .report-info {
              background: white;
              padding: 25px;
              border-radius: 12px;
              margin-bottom: 25px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .report-info h3 {
              margin: 0 0 20px 0;
              color: #0a41b1;
              font-size: 1.4rem;
            }
            .info-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
              gap: 20px;
            }
            .info-item {
              display: flex;
              flex-direction: column;
              padding: 15px;
              background: #f8fafc;
              border-radius: 8px;
              border-left: 4px solid #0a41b1;
            }
            .info-label {
              font-weight: 600;
              color: #64748b;
              font-size: 0.9rem;
              margin-bottom: 5px;
            }
            .info-value {
              color: #1e293b;
              font-size: 1.1rem;
              font-weight: 700;
            }
            .section {
              background: white;
              border-radius: 12px;
              padding: 25px;
              margin-bottom: 25px;
              box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            }
            .section-title {
              font-size: 1.5rem;
              font-weight: 700;
              color: #0a41b1;
              margin-bottom: 20px;
              padding-bottom: 10px;
              border-bottom: 2px solid #e2e8f0;
            }
            .attendance-summary {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
              gap: 20px;
              margin-bottom: 30px;
            }
            .summary-card {
              background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
              border-radius: 12px;
              padding: 20px;
              text-align: center;
              border: 2px solid transparent;
              transition: all 0.3s ease;
            }
            .summary-card.present {
              background: linear-gradient(135deg, #4ECDC4 0%, #44a08d 100%);
              color: white;
            }
            .summary-card.absent {
              background: linear-gradient(135deg, #FF6B6B 0%, #ee5a52 100%);
              color: white;
            }
            .summary-card.total {
              background: linear-gradient(135deg, #0a41b1 0%, #3cd9e8 100%);
              color: white;
            }
            .summary-value {
              font-size: 2.5rem;
              font-weight: 800;
              margin-bottom: 10px;
            }
            .summary-label {
              font-size: 1.1rem;
              font-weight: 600;
              opacity: 0.9;
            }
            .summary-percentage {
              font-size: 1.2rem;
              font-weight: 700;
              margin-top: 5px;
            }
            .attendance-table {
              width: 100%;
              border-collapse: collapse;
              font-size: 0.9rem;
              margin-top: 20px;
            }
            .attendance-table th {
              background: linear-gradient(135deg, #0a41b1, #3cd9e8);
              color: white;
              padding: 15px 12px;
              text-align: left;
              font-weight: 600;
              font-size: 0.9rem;
            }
            .attendance-table td {
              padding: 12px;
              border-bottom: 1px solid #e2e8f0;
            }
            .attendance-table tr:nth-child(even) {
              background: #f8fafc;
            }
            .status-cell {
              text-align: center;
              font-weight: 600;
            }
            .status-present {
              color: #10B981;
            }
            .status-absent {
              color: #EF4444;
            }
            .contractor-section {
              margin-bottom: 30px;
              page-break-inside: avoid;
            }
            .contractor-header {
              background: linear-gradient(135deg, #f8fafc, #e2e8f0);
              padding: 15px 20px;
              border-radius: 8px;
              margin-bottom: 15px;
              border-left: 4px solid #0a41b1;
            }
            .contractor-name {
              font-size: 1.3rem;
              font-weight: 700;
              color: #0a41b1;
              margin: 0 0 5px 0;
            }
            .contractor-stats {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
              gap: 15px;
              margin-top: 10px;
            }
            .stat-item {
              text-align: center;
              padding: 10px;
              background: white;
              border-radius: 6px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .stat-value {
              font-size: 1.2rem;
              font-weight: 700;
              color: #0a41b1;
            }
            .stat-label {
              font-size: 0.8rem;
              color: #64748b;
              margin-top: 2px;
            }
            .contractor-table {
              width: 100%;
              border-collapse: collapse;
              font-size: 0.85rem;
              margin-top: 15px;
            }
            .contractor-table th {
              background: #64748b;
              color: white;
              padding: 10px 8px;
              text-align: center;
              font-weight: 600;
            }
            .contractor-table td {
              padding: 8px;
              border-bottom: 1px solid #e2e8f0;
              text-align: center;
            }
            .contractor-table tr:nth-child(even) {
              background: #f8fafc;
            }
            .footer {
              margin-top: 40px;
              text-align: center;
              color: #64748b;
              font-size: 0.9rem;
              padding: 20px;
              background: #f8fafc;
              border-radius: 8px;
            }
            .page-break {
              page-break-before: always;
            }
            @media print {
              body { margin: 0; padding: 10px; }
              .header { margin-bottom: 20px; }
              .attendance-table, .contractor-table { font-size: 0.8rem; }
              .attendance-table th, .attendance-table td, .contractor-table th, .contractor-table td { padding: 6px 4px; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Monthly Attendance Distribution Comprehensive Report</h1>
            <p>Generated on ${currentDate.toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}</p>
          </div>
         
          <div class="report-info">
            <h3>Executive Summary</h3>
            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">Report Period</span>
                <span class="info-value">${monthName}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Total Contractors</span>
                <span class="info-value">${uniqueContractors.length}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Total Days Tracked</span>
                <span class="info-value">${totalDays}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Overall Attendance Rate</span>
                <span class="info-value">${presentPercentage}%</span>
              </div>
            </div>
          </div>
         
          <!-- Overall Summary Section -->
          <div class="section">
            <div class="section-title">Overall Attendance Summary</div>
            <div class="attendance-summary">
              <div class="summary-card present">
                <div class="summary-value">${totalPresent}</div>
                <div class="summary-label">Present Days</div>
                <div class="summary-percentage">${presentPercentage}%</div>
              </div>
              <div class="summary-card absent">
                <div class="summary-value">${totalAbsent}</div>
                <div class="summary-label">Absent Days</div>
                <div class="summary-percentage">${absentPercentage}%</div>
              </div>
              <div class="summary-card total">
                <div class="summary-value">${totalDays}</div>
                <div class="summary-label">Total Days</div>
                <div class="summary-percentage">100%</div>
              </div>
            </div>
          </div>
         
          <!-- Individual Contractor Details -->
          <div class="section page-break">
            <div class="section-title">Individual Contractor Details</div>
            ${uniqueContractors.map((contractor, index) => {
              const contractorData = allContractorsData[contractor];
              if (!contractorData || contractorData.error) {
                return `
                  <div class="contractor-section">
                    <div class="contractor-header">
                      <div class="contractor-name">${contractor}</div>
                      <div style="color: #EF4444; font-size: 0.9rem;">Data not available</div>
                </div>
                </div>
                `;
              }
             
              const attendanceRate = contractorData.totalDays > 0 ? ((contractorData.presentDays / contractorData.totalDays) * 100).toFixed(1) : 0;
             
              return `
                <div class="contractor-section">
                  <div class="contractor-header">
                    <div class="contractor-name">${contractor}</div>
                    <div class="contractor-stats">
                <div class="stat-item">
                        <div class="stat-value">${contractorData.presentDays}</div>
                        <div class="stat-label">Present Days</div>
                </div>
                <div class="stat-item">
                        <div class="stat-value">${contractorData.absentDays}</div>
                        <div class="stat-label">Absent Days</div>
                </div>
                <div class="stat-item">
                        <div class="stat-value">${attendanceRate}%</div>
                        <div class="stat-label">Attendance Rate</div>
                </div>
                <div class="stat-item">
                        <div class="stat-value">${contractorData.totalDays}</div>
                        <div class="stat-label">Total Days</div>
                </div>
              </div>
            </div>
                 
                  <table class="contractor-table">
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>Count</th>
                        <th>Percentage</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td class="status-cell status-present">Present</td>
                        <td class="status-cell">${contractorData.presentDays}</td>
                        <td class="status-cell">${attendanceRate}%</td>
                      </tr>
                      <tr>
                        <td class="status-cell status-absent">Absent</td>
                        <td class="status-cell">${contractorData.absentDays}</td>
                        <td class="status-cell">${(100 - parseFloat(attendanceRate)).toFixed(1)}%</td>
                      </tr>
                    </tbody>
                  </table>
          </div>
              `;
            }).join('')}
          </div>
         
        </body>
        </html>
      `;
     
      // Create a blob with the HTML content
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
     
      // Create a temporary link element for download
      const link = document.createElement('a');
      link.href = url;
      link.download = `Monthly_Attendance_Distribution_Comprehensive_All_Contractors_${selectedMonth}_${dateString}_${timeString}.html`;
     
      // Append to body, click, and remove
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
     
      // Clean up the URL object
      URL.revokeObjectURL(url);
     
      console.log('✅ Comprehensive Monthly Attendance Distribution PDF generated successfully');
     
    } catch (error) {
      console.error('Error generating comprehensive Monthly Attendance Distribution PDF:', error);
      alert('Error generating PDF. Please try again.');
    }
  };

  // Helper function to fetch Monthly Attendance data for a specific contractor
  const fetchMonthlyAttendanceForContractor = async (contractor) => {
    try {
      console.log(`🔄 Fetching Monthly Attendance data for contractor: ${contractor}`);
     
      // Format the selected month for API call
      const [year, month] = selectedMonth.split('-');
      const startDate = `${selectedMonth}-01`;
      const endDate = new Date(parseInt(year), parseInt(month), 0).toISOString().split('T')[0];
     
      // Fetch muster data
      const response = await fetch(`/server/attendance_muster_function?startDate=${startDate}&endDate=${endDate}&source=both`);
      const data = await response.json();
     
      if (data && data.muster && data.muster.length > 0) {
        // Get employees under this contractor
        const employeesUnderContractor = await fetchEmployeesByContractor(contractor);
       
        if (employeesUnderContractor.length === 0) {
          return {
            presentDays: 0,
            absentDays: 0,
            totalDays: 0,
            attendanceRate: 0,
            error: false
          };
        }
       
        // Find indices of these employees in the muster data
        const filteredEmployeeIndices = [];
        data.employees.forEach((employee, empIndex) => {
          const employeeId = employee;
          if (employeesUnderContractor.includes(employeeId) ||
              employeesUnderContractor.includes(String(employeeId)) ||
              employeesUnderContractor.includes(Number(employeeId))) {
            filteredEmployeeIndices.push(empIndex);
          }
        });
       
        // Count attendance for this contractor
        let presentDays = 0;
        let absentDays = 0;
        let statusCounts = { Present: 0, Absent: 0, 'Half Day Present': 0, Other: 0 };
       
        data.muster.forEach((employeeAttendance, empIndex) => {
          if (!filteredEmployeeIndices.includes(empIndex)) {
            return; // Skip this employee
          }
         
          if (employeeAttendance && employeeAttendance.length > 0) {
            employeeAttendance.forEach((dayStatus) => {
              if (dayStatus === 'Present' || dayStatus === 'P') {
                presentDays += 1;
                statusCounts.Present += 1;
              } else if (dayStatus === 'Absent' || dayStatus === 'A') {
                absentDays += 1;
                statusCounts.Absent += 1;
              } else if (dayStatus === '0.5' || dayStatus === 0.5 || dayStatus === 'Half Day Present') {
                presentDays += 0.5;
                absentDays += 0.5;
                statusCounts['Half Day Present'] += 1;
              } else {
                statusCounts.Other += 1;
              }
            });
          }
        });
       
        const totalDays = presentDays + absentDays;
        const attendanceRate = totalDays > 0 ? ((presentDays / totalDays) * 100).toFixed(1) : 0;
       
        return {
          presentDays: Math.round(presentDays),
          absentDays: Math.round(absentDays),
          totalDays: Math.round(totalDays),
          attendanceRate: parseFloat(attendanceRate),
          error: false
        };
      } else {
        return {
          presentDays: 0,
          absentDays: 0,
          totalDays: 0,
          attendanceRate: 0,
          error: false
        };
      }
    } catch (error) {
      console.error(`❌ Error fetching attendance data for contractor ${contractor}:`, error);
      return {
        presentDays: 0,
        absentDays: 0,
        totalDays: 0,
        attendanceRate: 0,
        error: true
      };
    }
  };

  // Handle PDF Download for Last 7 Days Attendance Percentage
  // Handle PDF Download for Last 7 Days Attendance Percentage - Enhanced with All Contractors Data
  const handleDownloadAttendanceTrendPDF = async () => {
    try {
      // Get current date for filename
      const currentDate = new Date();
      const dateString = currentDate.toISOString().split('T')[0];
      const timeString = currentDate.toTimeString().split(' ')[0].replace(/:/g, '-');
     
      console.log('🔄 Starting comprehensive Last 7 Days Attendance Percentage PDF generation...');
     
      // Fetch all contractors data for comprehensive report
      const allContractorsData = {};
      const contractorsList = [];
     
      // Get all contractors from the current contractor list
      if (contractorList && contractorList.length > 0) {
        // Filter out 'All' option as it's just a filter, not an actual contractor
        const actualContractors = contractorList.filter(contractor => contractor !== 'All');
        contractorsList.push(...actualContractors);
        console.log('📋 Contractors from state (excluding All):', actualContractors);
      }
     
      // Also get contractors from employee data
      try {
        const timestamp = new Date().getTime();
        const response = await fetch(`/server/cms_function/employees?returnAll=true&_t=${timestamp}`, {
          method: 'GET',
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        const data = await response.json();
       
        if (data.status === 'success' && data.data && data.data.employees) {
          const employees = data.data.employees;
          const employeeContractors = [...new Set(
            employees
              .map(emp => emp.contractor)
              .filter(contractor => contractor && contractor.trim() !== '')
          )];
          contractorsList.push(...employeeContractors);
          console.log('📋 Contractors from employee data:', employeeContractors);
        }
      } catch (error) {
        console.log('⚠️ Could not fetch contractors from employee data:', error);
      }
     
      console.log('📋 All contractors before deduplication:', contractorsList);
     
      // Remove duplicates and get unique contractors with advanced deduplication
      const uniqueContractors = [];
      contractorsList.forEach(contractor => {
        if (!contractor || contractor.trim() === '') return;
       
        const normalizedContractor = contractor.trim();
        const isDuplicate = uniqueContractors.some(existing => {
          const normalizedExisting = existing.trim();
          // Check for exact match or if one contains the other (case insensitive)
          return normalizedExisting.toLowerCase() === normalizedContractor.toLowerCase() ||
                 normalizedExisting.toLowerCase().includes(normalizedContractor.toLowerCase()) ||
                 normalizedContractor.toLowerCase().includes(normalizedExisting.toLowerCase());
        });
       
        if (!isDuplicate) {
          uniqueContractors.push(normalizedContractor);
        }
      });
     
      console.log('📊 Unique contractors found after advanced deduplication:', uniqueContractors);
      console.log('📊 Total contractors count:', uniqueContractors.length);
     
      // Fetch attendance trend data for each contractor
      for (const contractor of uniqueContractors) {
        try {
          console.log(`🔄 Fetching attendance trend data for contractor: ${contractor}`);
          const contractorData = await fetchAttendanceTrendForContractor(contractor);
          allContractorsData[contractor] = contractorData;
        } catch (error) {
          console.error(`❌ Error fetching attendance trend data for contractor ${contractor}:`, error);
          allContractorsData[contractor] = {
            trendData: [],
            averageAttendance: 0,
            highestDay: 0,
            lowestDay: 0,
            error: true
          };
        }
      }
     
      // Fetch fresh real-time overall statistics for all employees
      // This ensures we get accurate data including all employees (not just those assigned to contractors)
      console.log('🔄 Fetching fresh real-time overall attendance data for all employees...');
     
      const overallDataByDay = {};
      const today = new Date();
      const last7Days = [];
     
      // Initialize structure for last 7 days
      for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
        last7Days.push({ date: dateStr, day: dayName });
        overallDataByDay[dateStr] = {
          label: dayName,
          date: dateStr,
          presentCount: 0,
          totalEmployees: 0,
          value: 0
        };
      }
     
      // Get total employee count from Employee table (for accurate total)
      let totalEmployeeCount = 0;
      try {
        const empResponse = await fetch('/server/cms_function/employees?returnAll=true');
        const empData = await empResponse.json();
        if (empData.status === 'success' && empData.data && empData.data.employees) {
          totalEmployeeCount = empData.data.employees.length;
          console.log(`📊 Total employees in system: ${totalEmployeeCount}`);
        }
      } catch (err) {
        console.error('⚠️ Failed to fetch total employee count:', err);
      }
     
      // Fetch attendance data using the same logic as "Present Today" tooltip
      // This ensures the PDF matches exactly what's shown in the dashboard tooltip
      const freshOverallPromises = last7Days.map(async ({ date, day }) => {
        try {
          console.log(`🔄 Fetching attendance data for ${day} (${date}) using same logic as tooltip...`);
         
          // Use the same logic as fetchPresentEmployeesData - fetch from GetAttendanceList
          const presentEmployeeDetails = [];
          const employeesWithFirstIN = new Set();
         
          // Fetch from GetAttendanceList (same as tooltip)
          try {
            const attendanceResponse = await fetch(`/server/GetAttendanceList?startDate=${date}&endDate=${date}&summary=true`);
            const attendanceData = await attendanceResponse.json();
           
            if (attendanceData && attendanceData.data && attendanceData.data.length > 0) {
              attendanceData.data.forEach(record => {
                if (record.FirstIN && record.FirstIN.trim() !== '') {
                  employeesWithFirstIN.add(record.EmployeeID);
                  presentEmployeeDetails.push({
                    employeeId: record.EmployeeID,
                    firstIn: record.FirstIN
                  });
                }
              });
            }
          } catch (apiError) {
            console.warn(`Failed to fetch API attendance data for ${date}:`, apiError);
          }
         
          // Also check localStorage for imported data (same as tooltip)
          try {
            const importedDataStr = localStorage.getItem('importedAttendanceData');
            if (importedDataStr) {
              const importedData = JSON.parse(importedDataStr) || [];
              const toYMD = (s) => {
                if (!s) return '';
                const m = String(s).match(/^(\d{2})-(\d{2})-(\d{4})$/);
                if (m) return `${m[3]}-${m[2]}-${m[1]}`;
                if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
                const d = new Date(s);
                return isNaN(d) ? '' : d.toISOString().slice(0,10);
              };
             
              const dayImported = importedData.filter(r => toYMD(r.Date) === date);
              if (dayImported.length > 0) {
                const mergedByEmp = {};
                presentEmployeeDetails.forEach(p => {
                  mergedByEmp[p.employeeId] = { ...p };
                });
               
                dayImported.forEach(r => {
                  const empId = r.EmployeeID || r.EmployeeId || r.employeeId;
                  if (!empId) return;
                  const firstIn = r.FirstIN || '';
                  if (firstIn && firstIn.trim() !== '') {
                    employeesWithFirstIN.add(String(empId));
                    if (!mergedByEmp[empId]) {
                      mergedByEmp[empId] = {
                        employeeId: String(empId),
                        firstIn: firstIn
                      };
                    }
                  }
                });
               
                const mergedList = Object.values(mergedByEmp);
                presentEmployeeDetails.length = 0;
                mergedList.forEach(x => presentEmployeeDetails.push(x));
              }
            }
          } catch (e) {
            console.warn(`Failed to process imported data for ${date}:`, e);
          }
         
          // Get employee details to filter out Unknown contractors (same as tooltip)
          let filteredPresentCount = 0;
          if (presentEmployeeDetails.length > 0) {
            try {
              const employeeResponse = await fetch(`/server/cms_function/employees?returnAll=true`);
              const employeeData = await employeeResponse.json();
             
              if (employeeData.status === 'success' && employeeData.data && employeeData.data.employees) {
                const allEmployees = employeeData.data.employees;
               
                // Filter out Unknown contractors (same logic as tooltip)
                const filteredPresentEmployees = presentEmployeeDetails.filter(presentEmp => {
                  const employeeDetails = allEmployees.find(emp =>
                    emp.employeeCode === presentEmp.employeeId ||
                    emp.employeeCode === String(presentEmp.employeeId) ||
                    emp.EmployeeCode === presentEmp.employeeId ||
                    emp.EmployeeCode === String(presentEmp.employeeId) ||
                    emp.id === presentEmp.employeeId ||
                    emp.id === String(presentEmp.employeeId)
                  );
                 
                  if (!employeeDetails) return false;
                 
                  const contractor = employeeDetails.contractor || employeeDetails.contractorName || 'Unknown';
                  const name = (contractor || '').trim().toLowerCase();
                  return name && name !== 'unknown' && name !== 'unknown contractor';
                });
               
                filteredPresentCount = filteredPresentEmployees.length;
              } else {
                filteredPresentCount = presentEmployeeDetails.length;
              }
            } catch (err) {
              console.warn(`Failed to filter employees for ${date}:`, err);
              filteredPresentCount = presentEmployeeDetails.length;
            }
          }
         
          // Use total employee count from Employee table
          const totalEmployees = totalEmployeeCount > 0 ? totalEmployeeCount : 0;
         
          console.log(`✅ Attendance data for ${day} (${date}): Present: ${filteredPresentCount}, Total: ${totalEmployees} (using same logic as tooltip)`);
         
          return {
            date,
            day,
            presentCount: filteredPresentCount,
            totalEmployees: totalEmployees
          };
        } catch (err) {
          console.error(`❌ Failed to fetch attendance data for ${date}:`, err);
          return { date, day, presentCount: 0, totalEmployees: totalEmployeeCount };
        }
      });
     
      // Wait for all fresh data to be fetched
      const freshOverallResults = await Promise.all(freshOverallPromises);
     
      // Populate overall data with fresh results
      freshOverallResults.forEach(result => {
        if (overallDataByDay[result.date]) {
          overallDataByDay[result.date].presentCount = result.presentCount;
          overallDataByDay[result.date].totalEmployees = result.totalEmployees;
        }
      });
     
      console.log('📊 Overall data from fresh fetch:', overallDataByDay);
     
      // Log today's data specifically
      const todayStr = today.toISOString().split('T')[0];
      if (overallDataByDay[todayStr]) {
        console.log(`📊 TODAY (${todayStr}) Overall: ${overallDataByDay[todayStr].presentCount} present out of ${overallDataByDay[todayStr].totalEmployees} total`);
      }
     
      // Calculate percentages for each day
      const transformedTrendData = Object.values(overallDataByDay).map(day => {
        const percentage = day.totalEmployees > 0 ? (day.presentCount / day.totalEmployees) * 100 : 0;
        return {
          label: day.label,
          date: day.date,
          presentCount: day.presentCount,
          totalEmployees: day.totalEmployees,
          value: Math.round(percentage * 100) / 100
        };
      });
     
      const totalDays = transformedTrendData.length;
      const averageAttendance = totalDays > 0 ? (transformedTrendData.reduce((sum, day) => sum + (day.value || 0), 0) / totalDays).toFixed(1) : 0;
      const highestDay = totalDays > 0 ? Math.max(...transformedTrendData.map(day => day.value || 0)) : 0;
      const lowestDay = totalDays > 0 ? Math.min(...transformedTrendData.map(day => day.value || 0)) : 0;
      const highestDayName = totalDays > 0 ? transformedTrendData.find(day => day.value === highestDay)?.label : '';
      const lowestDayName = totalDays > 0 ? transformedTrendData.find(day => day.value === lowestDay)?.label : '';
     
      // Create comprehensive HTML content
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Last 7 Days Attendance Percentage Comprehensive Report</title>
          <style>
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              margin: 0;
              padding: 20px;
              background: #f8fafc;
              color: #1e293b;
              line-height: 1.6;
            }
            .header {
              text-align: center;
              margin-bottom: 30px;
              padding: 25px;
              background: linear-gradient(135deg, #0a41b1 0%, #3cd9e8 100%);
              color: white;
              border-radius: 12px;
              box-shadow: 0 4px 20px rgba(10, 65, 177, 0.3);
            }
            .header h1 {
              margin: 0 0 10px 0;
              font-size: 1.8rem;
              font-weight: 700;
            }
            .header p {
              margin: 0;
              font-size: 0.9rem;
              opacity: 0.9;
            }
            .report-info {
              background: white;
              padding: 25px;
              border-radius: 12px;
              margin-bottom: 25px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .report-info h3 {
              margin: 0 0 20px 0;
              color: #0a41b1;
              font-size: 1.1rem;
            }
            .info-grid {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
              gap: 20px;
            }
            .info-item {
              display: flex;
              flex-direction: column;
              padding: 15px;
              background: #f8fafc;
              border-radius: 8px;
              border-left: 4px solid #0a41b1;
            }
            .info-label {
              font-weight: 600;
              color: #64748b;
              font-size: 0.75rem;
              margin-bottom: 5px;
            }
            .info-value {
              color: #1e293b;
              font-size: 0.9rem;
              font-weight: 700;
            }
            .section {
              background: white;
              border-radius: 12px;
              padding: 25px;
              margin-bottom: 25px;
              box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            }
            .section-title {
              font-size: 1.1rem;
              font-weight: 700;
              color: #0a41b1;
              margin-bottom: 20px;
              padding-bottom: 10px;
              border-bottom: 2px solid #e2e8f0;
            }
            .attendance-summary {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
              gap: 20px;
              margin-bottom: 30px;
            }
            .summary-card {
              background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
              border-radius: 12px;
              padding: 20px;
              text-align: center;
              border: 2px solid transparent;
              transition: all 0.3s ease;
            }
            .summary-card.average {
              background: linear-gradient(135deg, #0a41b1 0%, #3cd9e8 100%);
              color: white;
            }
            .summary-card.highest {
              background: linear-gradient(135deg, #10B981 0%, #059669 100%);
              color: white;
            }
            .summary-card.lowest {
              background: linear-gradient(135deg, #EF4444 0%, #DC2626 100%);
              color: white;
            }
            .summary-value {
              font-size: 1.8rem;
              font-weight: 800;
              margin-bottom: 10px;
            }
            .summary-label {
              font-size: 0.85rem;
              font-weight: 600;
              opacity: 0.9;
            }
            .summary-day {
              font-size: 0.75rem;
              font-weight: 500;
              margin-top: 5px;
              opacity: 0.8;
            }
            .trend-table {
              width: 100%;
              border-collapse: collapse;
              font-size: 0.75rem;
              margin-top: 20px;
            }
            .trend-table th {
              background: linear-gradient(135deg, #0a41b1, #3cd9e8);
              color: white;
              padding: 10px 8px;
              text-align: left;
              font-weight: 600;
              font-size: 0.75rem;
            }
            .trend-table td {
              padding: 8px;
              border-bottom: 1px solid #e2e8f0;
            }
            .trend-table tr:nth-child(even) {
              background: #f8fafc;
            }
            .day-cell {
              font-weight: 600;
              color: #0a41b1;
            }
            .percentage-cell {
              text-align: center;
              font-weight: 700;
              font-size: 0.85rem;
            }
            .percentage-excellent {
              color: #10B981;
            }
            .percentage-good {
              color: #3B82F6;
            }
            .percentage-average {
              color: #F59E0B;
            }
            .percentage-poor {
              color: #EF4444;
            }
            .progress-bar {
              width: 100%;
              height: 8px;
              background: #e2e8f0;
              border-radius: 4px;
              overflow: hidden;
              margin-top: 5px;
            }
            .progress-fill {
              height: 100%;
              border-radius: 4px;
              transition: width 0.3s ease;
            }
            .contractor-section {
              margin-bottom: 30px;
              page-break-inside: avoid;
            }
            .contractor-header {
              background: linear-gradient(135deg, #f8fafc, #e2e8f0);
              padding: 15px 20px;
              border-radius: 8px;
              margin-bottom: 15px;
              border-left: 4px solid #0a41b1;
            }
            .contractor-name {
              font-size: 1rem;
              font-weight: 700;
              color: #0a41b1;
              margin: 0 0 5px 0;
            }
            .contractor-stats {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
              gap: 15px;
              margin-top: 10px;
            }
            .stat-item {
              text-align: center;
              padding: 10px;
              background: white;
              border-radius: 6px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .stat-value {
              font-size: 0.95rem;
              font-weight: 700;
              color: #0a41b1;
            }
            .stat-label {
              font-size: 0.7rem;
              color: #64748b;
              margin-top: 2px;
            }
            .contractor-table {
              width: 100%;
              border-collapse: collapse;
              font-size: 0.7rem;
              margin-top: 15px;
            }
            .contractor-table th {
              background: #64748b;
              color: white;
              padding: 8px 6px;
              text-align: center;
              font-weight: 600;
              font-size: 0.7rem;
            }
            .contractor-table td {
              padding: 6px;
              border-bottom: 1px solid #e2e8f0;
              text-align: center;
            }
            .contractor-table tr:nth-child(even) {
              background: #f8fafc;
            }
            .footer {
              margin-top: 40px;
              text-align: center;
              color: #64748b;
              font-size: 0.75rem;
              padding: 20px;
              background: #f8fafc;
              border-radius: 8px;
            }
            .page-break {
              page-break-before: always;
            }
            @media print {
              body { margin: 0; padding: 10px; font-size: 0.85rem; }
              .header { margin-bottom: 20px; }
              .header h1 { font-size: 1.5rem; }
              .header p { font-size: 0.8rem; }
              .trend-table, .contractor-table { font-size: 0.65rem; }
              .trend-table th, .trend-table td, .contractor-table th, .contractor-table td { padding: 5px 3px; }
              .section-title { font-size: 0.95rem; }
              .summary-value { font-size: 1.5rem; }
              .summary-label { font-size: 0.75rem; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Last 7 Days Attendance Percentage Comprehensive Report</h1>
            <p>Generated on ${currentDate.toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}</p>
          </div>
         
          <div class="report-info">
            <h3>Executive Summary</h3>
            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">Report Period</span>
                <span class="info-value">Last 7 Days</span>
              </div>
              <div class="info-item">
                <span class="info-label">Total Contractors</span>
                <span class="info-value">${uniqueContractors.length}</span>
              </div>
              <div class="info-item">
                <span class="info-label">Average Attendance</span>
                <span class="info-value">${averageAttendance}%</span>
              </div>
              <div class="info-item">
                <span class="info-label">Data Points</span>
                <span class="info-value">${totalDays} days</span>
              </div>
            </div>
          </div>
         
          <!-- Overall Summary Section -->
          <div class="section">
            <div class="section-title">Overall Attendance Performance Summary</div>
            <div class="attendance-summary">
              <div class="summary-card average">
                <div class="summary-value">${averageAttendance}%</div>
                <div class="summary-label">Average Attendance</div>
                <div class="summary-day">Last 7 Days</div>
              </div>
              <div class="summary-card highest">
                <div class="summary-value">${highestDay}%</div>
                <div class="summary-label">Highest Day</div>
                <div class="summary-day">${highestDayName}</div>
              </div>
              <div class="summary-card lowest">
                <div class="summary-value">${lowestDay}%</div>
                <div class="summary-label">Lowest Day</div>
                <div class="summary-day">${lowestDayName}</div>
              </div>
            </div>
          </div>
         
          <!-- Overall Trend Table -->
          <div class="section">
            <div class="section-title">Overall Daily Attendance Breakdown</div>
            <table class="trend-table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Date</th>
                  <th>Present</th>
                  <th>Attendance %</th>
                </tr>
              </thead>
              <tbody>
                ${transformedTrendData.map((day, index) => {
                  const dayValue = day.value || 0;
                  const dayLabel = day.label || day.day || 'N/A';
                  const presentCount = day.presentCount || 0;
                  const performance = dayValue >= 90 ? 'excellent' :
                                   dayValue >= 80 ? 'good' :
                                   dayValue >= 70 ? 'average' : 'poor';
                 
                  return `
                    <tr>
                      <td class="day-cell">${dayLabel}</td>
                      <td>${day.date || 'N/A'}</td>
                      <td>${presentCount}</td>
                      <td class="percentage-cell percentage-${performance}">${dayValue.toFixed(2)}%</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
         
          <!-- Individual Contractor Details -->
          <div class="section page-break">
            <div class="section-title">Individual Contractor Performance</div>
            ${uniqueContractors.map((contractor, index) => {
              const contractorData = allContractorsData[contractor];
              if (!contractorData || contractorData.error) {
                return `
                  <div class="contractor-section">
                    <div class="contractor-header">
                      <div class="contractor-name">${contractor}</div>
                      <div style="color: #EF4444; font-size: 0.75rem;">Data not available</div>
                </div>
                </div>
                `;
              }
             
              return `
                <div class="contractor-section">
                  <div class="contractor-header">
                    <div class="contractor-name">${contractor}</div>
                  </div>
                 
                  <table class="contractor-table">
                    <thead>
                      <tr>
                        <th>Day</th>
                        <th>Date</th>
                        <th>Present</th>
                        <th>Attendance %</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${contractorData.trendData.map((day, dayIndex) => {
                        const dayValue = day.value || 0;
                        const dayLabel = day.label || day.day || 'N/A';
                        const presentCount = day.presentCount || 0;
                        const performance = dayValue >= 90 ? 'excellent' :
                                         dayValue >= 80 ? 'good' :
                                         dayValue >= 70 ? 'average' : 'poor';
                       
                        return `
                          <tr>
                            <td class="day-cell">${dayLabel}</td>
                            <td>${day.date || 'N/A'}</td>
                            <td>${presentCount}</td>
                            <td class="percentage-cell percentage-${performance}">${dayValue.toFixed(2)}%</td>
                          </tr>
                        `;
                      }).join('')}
                    </tbody>
                  </table>
                </div>
              `;
            }).join('')}
          </div>
         
          <div class="footer">
            <p>This comprehensive report was generated automatically by the Payroll Management System</p>
            <p>Includes data for all contractors with individual performance breakdowns</p>
            <p>For questions or support, please contact your system administrator</p>
          </div>
        </body>
        </html>
      `;
     
      // Create a blob with the HTML content
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
     
      // Create a temporary link element for download
      const link = document.createElement('a');
      link.href = url;
      link.download = `Last_7_Days_Attendance_Percentage_Comprehensive_All_Contractors_${dateString}_${timeString}.html`;
     
      // Append to body, click, and remove
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
     
      // Clean up the URL object
      URL.revokeObjectURL(url);
     
      console.log('✅ Comprehensive Last 7 Days Attendance Percentage PDF generated successfully');
     
    } catch (error) {
      console.error('Error generating comprehensive Last 7 Days Attendance Percentage PDF:', error);
      alert('Error generating PDF. Please try again.');
    }
  };

  // Helper function to fetch Attendance Trend data for a specific contractor
  const fetchAttendanceTrendForContractor = async (contractor) => {
    try {
      console.log(`🔄 Fetching Attendance Trend data for contractor: ${contractor}`);
     
      // Calculate last 7 days
      const today = new Date();
      const last7Days = [];
     
      for (let i = 6; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
        last7Days.push({
          date: date.toISOString().split('T')[0],
          day: dayName
        });
      }
     
      // Fetch attendance data for each day using same logic as tooltip
      // This ensures contractor data matches exactly what's shown in the tooltip
      const attendancePromises = last7Days.map(async ({ date, day }) => {
        try {
          console.log(`🔄 Fetching attendance for ${contractor} on ${day} (${date}) using tooltip logic...`);
         
          // Use same logic as fetchPresentEmployeesData - fetch from GetAttendanceList
          const presentEmployeeDetails = [];
          const employeesWithFirstIN = new Set();
         
          // Fetch from GetAttendanceList (same as tooltip)
          try {
            const attendanceResponse = await fetch(`/server/GetAttendanceList?startDate=${date}&endDate=${date}&summary=true`);
            const attendanceData = await attendanceResponse.json();
           
            if (attendanceData && attendanceData.data && attendanceData.data.length > 0) {
              attendanceData.data.forEach(record => {
                if (record.FirstIN && record.FirstIN.trim() !== '') {
                  employeesWithFirstIN.add(record.EmployeeID);
                  presentEmployeeDetails.push({
                    employeeId: record.EmployeeID,
                    firstIn: record.FirstIN
                  });
                }
              });
            }
          } catch (apiError) {
            console.warn(`Failed to fetch API attendance data for ${date}:`, apiError);
          }
         
          // Also check localStorage for imported data (same as tooltip)
          try {
            const importedDataStr = localStorage.getItem('importedAttendanceData');
            if (importedDataStr) {
              const importedData = JSON.parse(importedDataStr) || [];
              const toYMD = (s) => {
                if (!s) return '';
                const m = String(s).match(/^(\d{2})-(\d{2})-(\d{4})$/);
                if (m) return `${m[3]}-${m[2]}-${m[1]}`;
                if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
                const d = new Date(s);
                return isNaN(d) ? '' : d.toISOString().slice(0,10);
              };
             
              const dayImported = importedData.filter(r => toYMD(r.Date) === date);
              if (dayImported.length > 0) {
                const mergedByEmp = {};
                presentEmployeeDetails.forEach(p => {
                  mergedByEmp[p.employeeId] = { ...p };
                });
               
                dayImported.forEach(r => {
                  const empId = r.EmployeeID || r.EmployeeId || r.employeeId;
                  if (!empId) return;
                  const firstIn = r.FirstIN || '';
                  if (firstIn && firstIn.trim() !== '') {
                    employeesWithFirstIN.add(String(empId));
                    if (!mergedByEmp[empId]) {
                      mergedByEmp[empId] = {
                        employeeId: String(empId),
                        firstIn: firstIn
                      };
                    }
                  }
                });
               
                const mergedList = Object.values(mergedByEmp);
                presentEmployeeDetails.length = 0;
                mergedList.forEach(x => presentEmployeeDetails.push(x));
              }
            }
          } catch (e) {
            console.warn(`Failed to process imported data for ${date}:`, e);
          }
         
          // Get employee details and filter by contractor (same as tooltip)
          let presentCount = 0;
          let totalEmployees = 0;
         
          if (presentEmployeeDetails.length > 0) {
            try {
              const employeeResponse = await fetch(`/server/cms_function/employees?returnAll=true`);
              const employeeData = await employeeResponse.json();
             
              if (employeeData.status === 'success' && employeeData.data && employeeData.data.employees) {
                const allEmployees = employeeData.data.employees;
               
                // Get employees under this contractor
                const employeesUnderContractor = await fetchEmployeesByContractor(contractor);
                const contractorEmployeeSet = new Set(employeesUnderContractor.map(e => String(e)));
               
                // Filter present employees by contractor (same logic as tooltip)
                const contractorPresentEmployees = presentEmployeeDetails.filter(presentEmp => {
                  const employeeDetails = allEmployees.find(emp =>
                    emp.employeeCode === presentEmp.employeeId ||
                    emp.employeeCode === String(presentEmp.employeeId) ||
                    emp.EmployeeCode === presentEmp.employeeId ||
                    emp.EmployeeCode === String(presentEmp.employeeId) ||
                    emp.id === presentEmp.employeeId ||
                    emp.id === String(presentEmp.employeeId)
                  );
                 
                  if (!employeeDetails) return false;
                 
                  // Check if employee belongs to this contractor
                  const empId = employeeDetails.employeeCode || employeeDetails.EmployeeCode || employeeDetails.id;
                  return contractorEmployeeSet.has(String(empId)) ||
                         contractorEmployeeSet.has(empId) ||
                         (employeeDetails.contractor === contractor || employeeDetails.contractorName === contractor);
                });
               
                presentCount = contractorPresentEmployees.length;
               
                // Get total employees for this contractor
                totalEmployees = employeesUnderContractor.length;
               
                console.log(`✅ ${contractor} on ${day} (${date}): Present: ${presentCount}, Total: ${totalEmployees}`);
              } else {
                // Fallback: use contractor employee list
                const employeesUnderContractor = await fetchEmployeesByContractor(contractor);
                totalEmployees = employeesUnderContractor.length;
                presentCount = 0;
              }
            } catch (err) {
              console.warn(`Failed to filter employees for ${contractor} on ${date}:`, err);
              const employeesUnderContractor = await fetchEmployeesByContractor(contractor);
              totalEmployees = employeesUnderContractor.length;
              presentCount = 0;
            }
          } else {
            // No present employees, but get total for this contractor
            const employeesUnderContractor = await fetchEmployeesByContractor(contractor);
            totalEmployees = employeesUnderContractor.length;
            presentCount = 0;
          }
         
          // Calculate percentage
          const attendancePercentage = totalEmployees > 0 ? (presentCount / totalEmployees) * 100 : 0;
          return {
            day,
            present: Math.round(attendancePercentage * 100) / 100,
            date: date,
            presentCount: presentCount,
            totalEmployees: totalEmployees
          };
        } catch (err) {
          console.error(`Failed to fetch attendance for ${contractor} on ${date}:`, err);
          return { day, present: 0, date: date, presentCount: 0, totalEmployees: 0 };
        }
      });
     
      const results = await Promise.all(attendancePromises);
     
      // Transform contractor data to include label, value, and date
      const transformedContractorData = results.map((item) => {
        return {
          label: item.day || 'N/A',
          value: item.present || 0,
          date: item.date || '',
          day: item.day,
          presentCount: item.presentCount || 0,
          totalEmployees: item.totalEmployees || 0
        };
      });
     
      // Calculate statistics
      const averageAttendance = transformedContractorData.length > 0 ? (transformedContractorData.reduce((sum, day) => sum + (day.value || 0), 0) / transformedContractorData.length).toFixed(1) : 0;
      const highestDay = transformedContractorData.length > 0 ? Math.max(...transformedContractorData.map(day => day.value || 0)) : 0;
      const lowestDay = transformedContractorData.length > 0 ? Math.min(...transformedContractorData.map(day => day.value || 0)) : 0;
     
      return {
        trendData: transformedContractorData,
        averageAttendance: parseFloat(averageAttendance),
        highestDay: Math.round(highestDay),
        lowestDay: Math.round(lowestDay),
        error: false
      };
    } catch (error) {
      console.error(`❌ Error fetching attendance trend data for contractor ${contractor}:`, error);
      return {
        trendData: [],
        averageAttendance: 0,
        highestDay: 0,
        lowestDay: 0,
        error: true
      };
    }
  };

  useEffect(() => {
    fetchContractorScoringData();
  }, []);

  // Cleanup charts on unmount
  useEffect(() => {
    return () => {
      // Destroy all charts to prevent memory leaks
      if (diversityChartRef.current && diversityChartRef.current.chart) {
        diversityChartRef.current.chart.destroy();
      }
      if (attendanceChartRef.current && attendanceChartRef.current.chart) {
        attendanceChartRef.current.chart.destroy();
      }
      if (shiftChartRef.current && shiftChartRef.current.chart) {
        shiftChartRef.current.chart.destroy();
      }

      if (clAdditionChartRef.current && clAdditionChartRef.current.chart) {
        clAdditionChartRef.current.chart.destroy();
      }
      if (clAttritionChartRef.current && clAttritionChartRef.current.chart) {
        clAttritionChartRef.current.chart.destroy();
      }
      if (lohOtChartRef.current && lohOtChartRef.current.chart) {
        lohOtChartRef.current.chart.destroy();
      }
    };
  }, []);

  // Function to refresh all dashboard data
  const refreshAllDashboardData = async () => {
    console.log('🔄 Refreshing all dashboard data including real-time shift data...');
   
    // Refresh all data sources including shift data
  await Promise.all([
    fetchContractorScoringData(),
    fetchLateInTrend(),
    fetchPayrollGrossTrend(),
      // Add shift data refresh
      (async () => {
        try {
          console.log('🔄 Refreshing real-time shift data...');
          const today = new Date();
          const last7Days = [];
         
          for (let i = 6; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(today.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
           
            last7Days.push({ date: dateStr, day: dayName });
          }
         
          const dailyData = [];
         
          for (const { date, day } of last7Days) {
            try {
              const shiftmapsResponse = await fetch(`/server/Shiftmap_function/shiftmaps?date=${date}`);
              const shiftmapsData = await shiftmapsResponse.json();

              if (shiftmapsData.status === 'success' && shiftmapsData.data && shiftmapsData.data.shiftmaps) {
                const shiftmaps = shiftmapsData.data.shiftmaps || [];
                const dailyDistribution = {};
               
                shiftmaps.forEach(mapping => {
                  const shiftName = mapping.shiftName || mapping.assignedShift || 'Unknown';
                  const employeeId = mapping.employeeId;
                 
                  if (shiftName && employeeId) {
                    if (!dailyDistribution[shiftName]) {
                      dailyDistribution[shiftName] = 0;
                    }
                    dailyDistribution[shiftName]++;
                  }
                });

                dailyData.push({
                  date: day,
                  shifts: dailyDistribution
                });
              } else {
                dailyData.push({
                  date: day,
                  shifts: {}
                });
              }
            } catch (err) {
              console.error(`❌ Failed to fetch shift data for ${date}:`, err);
              dailyData.push({
                date: day,
                shifts: {}
              });
            }
          }
         
          setDailyShiftData(dailyData);
          console.log('✅ Real-time shift data refreshed successfully');
        } catch (err) {
          console.error('❌ Failed to refresh shift data:', err);
        }
      })()
  ]);
 
  // Force re-render of charts
  setTimeout(() => {
    window.location.reload();
  }, 1000);
  };

  const userAvatar = "https://images.pexels.com/photos/2379004/pexels-photo-2379004.jpeg?auto=compress&cs=tinysrgb&w=150";
  const userName = userRole === 'App Administrator' ? 'Admin User' : 'App User';

  // Sample activity data with Lucide icons
  const recentActivities = [
    { icon: <User size={20} />, title: 'New Employee Added', description: 'John Doe joined the development team', time: '2 hours ago' },
    { icon: <BarChart3 size={20} />, title: 'Monthly Report Generated', description: 'Contractor performance report is ready', time: '4 hours ago' },
    { icon: <CheckCircle size={20} />, title: 'Contract Approved', description: 'ABC Construction contract approved', time: '6 hours ago' },
    { icon: <Bell size={20} />, title: 'System Update', description: 'Payroll Management System updated to version 2.1', time: '1 day ago' },
    { icon: <Plus size={20} />, title: 'New Application', description: 'Candidate applied for senior position', time: '2 days ago' }
  ];

  // Set loading to false after initial setup
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
      // Try to create CL charts after initial load
      setTimeout(() => {
        createCLCharts();
      }, 500);
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        background: 'white',
        color: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        fontSize: '1.5rem',
        fontWeight: 'bold'
      }}>
        Loading Dashboard...
      </div>
    );
  }

  return (
    <>
      {/* Enhanced Animated Background */}
      <div className="dashboard-background">
        <div className="dashboard-floating-shape dashboard-shape-1"></div>
        <div className="dashboard-floating-shape dashboard-shape-2"></div>
        <div className="dashboard-floating-shape dashboard-shape-3"></div>
        <div className="dashboard-floating-shape dashboard-shape-4"></div>
        <div className="dashboard-floating-shape dashboard-shape-5"></div>
        <div className="dashboard-floating-shape dashboard-shape-6"></div>
      </div>

      <div className="dashboard-root">
        {/* Sidebar with Home page styling */}
        <nav className="cms-sidebar">
          {/* Sidebar Header */}
          <div className="cms-sidebar-header">
            <div className="cms-header-content">
              <div className="cms-logo-section">
                <div className="cms-menu-toggle" onClick={() => setShowSidebarMenu(!showSidebarMenu)}>
                  <div className="cms-three-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <div className="cms-nav">
            {modulesToShow.map((item, idx) => (
              item.children ? (
                <div key={item.label} className={`cms-nav-expandable ${expandedMenus[idx] ? 'expanded' : ''}`}>
                  <div className="cms-nav-item" onClick={() => toggleMenu(idx)}>
                    <span className="cms-nav-icon">{item.icon}</span>
                    <span className="cms-nav-label">{item.label}</span>
                    <span className="cms-expand-icon">
                      <Plus size={16} className={`expand-icon ${expandedMenus[idx] ? 'rotated' : ''}`} />
                    </span>
                  </div>
                  <div className="cms-nav-children">
                    {item.children.map(child => (
                      <Link
                        to={child.path}
                        key={child.label}
                        className={`cms-nav-child ${['/loh-report', '/onduty', '/grace', '/compoff', '/calendar'].includes(child.path) ? 'clock-color-icon' : ''}`}
                      >
                        <span className="cms-nav-icon">{child.icon}</span>
                        <span className="cms-nav-label">{child.label}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              ) : (
                <Link
                  to={item.path}
                  className={`cms-nav-item ${['/loh-report', '/onduty', '/grace', '/compoff', '/calendar'].includes(item.path) ? 'clock-color-icon' : ''}`}
                  data-nav-path={item.path}
                  key={item.label}
                >
                  <span className="cms-nav-icon">{item.icon}</span>
                  <span className="cms-nav-label">{item.label}</span>
                </Link>
              )
            ))}
          </div>

          {/* User Info */}
          <div className="cms-user-info">
            <img src={userAvatar} alt="User" className="cms-user-avatar" />
            <div className="cms-user-details">
              <h4>{userName}</h4>
              <p>{userRole || 'User'}</p>
            </div>
          </div>
        </nav>

        {/* Main Content with Home page styling */}
        <div className="cms-main-content">
          {/* Enhanced Header */}
          <header className="cms-header">
            <div className="cms-header-center">
              <h1>Payroll Management System</h1>
            </div>
            <div className="cms-header-right">
              <HeaderBranding />
              <div className="cms-header-user">
                <div className="cms-notification-icon" onClick={() => setShowNotifications(!showNotifications)}>
                  <Bell size={24} />
                </div>
                <button
                  className="dashboard-btn dashboard-interactive-btn"
                  onClick={refreshAllDashboardData}
                  title="Refresh Dashboard Data"
                  style={{padding: '8px 12px'}}
                >
                  <Activity size={20} />
                </button>
                <img src={userAvatar} alt="User" className="cms-user-avatar" />
                <div className="cms-logout-icon">
                  <Button title="" className="cms-logout-btn" />
                </div>
              </div>
            </div>
          </header>

          {/* Contractor Filter Icon */}
          <div className="dashboard-filter-icon-container">
            <div
              className="dashboard-filter-icon-btn"
              onClick={() => setShowContractorDropdown(!showContractorDropdown)}
              title="Filter by Contractor"
            >
              <Filter size={20} />
            </div>
           
            {/* Contractor Filter Dropdown */}
            {showContractorDropdown && (
              <div className="dashboard-filter-dropdown-panel">
                <div className="dashboard-filter-dropdown-header">
                  <h3>Filter by Contractor</h3>
                  <button
                    className="dashboard-filter-close-btn"
                    onClick={() => setShowContractorDropdown(false)}
                  >
                    ×
                  </button>
                </div>
                <div className="dashboard-filter-search-container">
                  <input
                    type="text"
                    placeholder="Search contractors..."
                    className="dashboard-filter-search-input"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <div className="dashboard-filter-dropdown-content">
                  <div className="dashboard-filter-option" onClick={() => {
                        setSelectedContractor('all');
                    setShowContractorDropdown(false);
                    setSearchTerm('');
                  }}>
                    <span>All Contractors</span>
                    {selectedContractor === 'all' && <CheckCircle size={16} />}
                  </div>
                  {contractors
                    .filter(c => c !== 'All')
                    .filter(c => c.toLowerCase().includes(searchTerm.toLowerCase()))
                    .map((contractor) => (
                    <div
                      key={contractor}
                      className="dashboard-filter-option"
                      onClick={() => {
                        setSelectedContractor(contractor);
                        setShowContractorDropdown(false);
                        setSearchTerm('');
                      }}
                    >
                      <span>{contractor}</span>
                      {selectedContractor === contractor && <CheckCircle size={16} />}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Notification Popup */}
          {showNotifications && (
            <div className="cms-notification-overlay" onClick={() => setShowNotifications(false)}>
              <div className="cms-notification-popup" onClick={(e) => e.stopPropagation()}>
                <div className="cms-notification-header">
                  <h3>Recent Activity</h3>
                  <button
                    className="cms-close-btn"
                    onClick={() => setShowNotifications(false)}
                  >
                    ×
                  </button>
                </div>
                <div className="cms-notification-content">
                  {recentActivities.map((activity, index) => (
                    <div key={index} className="cms-activity-item">
                      <div className="cms-activity-icon">{activity.icon}</div>
                      <div className="cms-activity-content">
                        <h4>{activity.title}</h4>
                        <p>{activity.description}</p>
                        <span className="cms-activity-time">{activity.time}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}



          {/* Dashboard Header */}
         

          {/* Dashboard Content */}
          <main className="cms-dashboard-content">
            {/* Row 1: Animated Stats Cards */}
            <div className="dashboard-stats-grid">
              <div
                className="dashboard-stat-card dashboard-animated-card"
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setTooltipPosition({
                    x: rect.left + rect.width / 2,
                    y: rect.bottom + 10
                  });
                  setShowContractorTooltip(true);
                  fetchContractorDataForTooltip();
                }}
              >
                <div className="dashboard-stat-header">
                  <div>
                    <div className="dashboard-stat-value dashboard-pulse-animation">{animatedStats.total}</div>
                    <div className="dashboard-stat-label">Total Employees</div>
                    <div className="dashboard-stat-change positive">
                      <TrendingUp size={16} /> +5% from last month
                    </div>
                  </div>
                  <div className="dashboard-stat-icon dashboard-gradient-bg-blue">
                    <Users size={28} />
                  </div>
                </div>
                <div className="dashboard-progress-bar">
                  <div className="dashboard-progress-fill" style={{width: '75%'}}></div>
                </div>
              </div>

              <div
                className="dashboard-stat-card dashboard-animated-card"
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setPresentTooltipPosition({
                    x: rect.left + rect.width / 2,
                    y: rect.bottom + 10
                  });
                  setShowPresentTooltip(true);
                  fetchPresentEmployeesData();
                }}
                title="Click to view present employee details"
              >
                <div className="dashboard-stat-header">
                  <div>
                    <div className="dashboard-stat-value dashboard-pulse-animation">{animatedStats.present}</div>
                    <div className="dashboard-stat-label">Present Today (First In)</div>
                    <div className="dashboard-stat-change positive">
                      <TrendingUp size={16} /> {todayAttendance.total > 0 ? `${Math.round((todayAttendance.present / todayAttendance.total) * 100)}%` : '0%'} check-in rate
                    </div>
                   
                  </div>
                  <div className="dashboard-stat-icon dashboard-gradient-bg-green">
                    <CheckCircle size={28} />
                  </div>
                </div>
                <div className="dashboard-progress-bar">
                  <div className="dashboard-progress-fill dashboard-green" style={{width: `${todayAttendance.total > 0 ? (todayAttendance.present / todayAttendance.total) * 100 : 0}%`}}></div>
                </div>
              </div>

              <div
                className="dashboard-stat-card dashboard-animated-card"
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setAbsentTooltipPosition({
                    x: rect.left + rect.width / 2,
                    y: rect.bottom + 10
                  });
                  setShowAbsentTooltip(true);
                  fetchAbsentEmployeesData();
                }}
                title="Click to view absent employee details"
              >
                <div className="dashboard-stat-header">
                  <div>
                    <div className="dashboard-stat-value dashboard-pulse-animation">{animatedStats.absent}</div>
                    <div className="dashboard-stat-label">Absent Today (No Check-in)</div>
                    <div className="dashboard-stat-change negative">
                      <TrendingDown size={16} /> {todayAttendance.total > 0 ? `${Math.round((todayAttendance.absent / todayAttendance.total) * 100)}%` : '0%'} no-show rate
                    </div>
                   
                  </div>
                  <div className="dashboard-stat-icon dashboard-gradient-bg-red">
                    <User size={28} />
                  </div>
                </div>
                <div className="dashboard-progress-bar">
                  <div className="dashboard-progress-fill dashboard-red" style={{width: `${todayAttendance.total > 0 ? (todayAttendance.absent / todayAttendance.total) * 100 : 0}%`}}></div>
              </div>
            </div>

            {/* Refresh Button for Attendance Data */}

              {/* Previous Day Miss Punch Card - click to open modal with employee codes */}
              <div
                className="dashboard-stat-card dashboard-animated-card"
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setMissPunchTooltipPosition({
                    x: rect.left + rect.width / 2,
                    y: rect.bottom + 10
                  });
                  setShowMissPunchTooltip(true);
                }}
                title="Click to view employee codes"
              >
                <div className="dashboard-stat-header">
                  <div>
                    <div className="dashboard-stat-value dashboard-pulse-animation">{prevDayMissPunchData.length}</div>
                    <div className="dashboard-stat-label">Previous Day Miss Punch</div>
                    <div className="dashboard-stat-change negative">
                      <Clock3 size={16} /> Yesterday&apos;s count
                  </div>
                  </div>
                  <div className="dashboard-stat-icon dashboard-gradient-bg-orange">
                    <Clock3 size={28} />
                </div>
                  </div>
                <div className="dashboard-progress-bar">
                  <div className="dashboard-progress-fill dashboard-orange" style={{width: '60%'}}></div>
                </div>
              </div>

              {/* Today's Late In Card - click to open tooltip with employee codes */}
              <div
                className="dashboard-stat-card dashboard-animated-card"
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setTodayLateInTooltipPosition({
                    x: rect.left + rect.width / 2,
                    y: rect.bottom + 10
                  });
                  setShowTodayLateInTooltip(true);
                }}
                title="Click to view employee codes"
              >
                <div className="dashboard-stat-header">
                  <div>
                    <div className="dashboard-stat-value dashboard-pulse-animation">{todayLateInData.length}</div>
                    <div className="dashboard-stat-label">Today&apos;s Late In</div>
                    <div className="dashboard-stat-change negative">
                      <Clock3 size={16} /> Today&apos;s count
                  </div>
                </div>
                  <div className="dashboard-stat-icon dashboard-gradient-bg-purple">
                    <Clock3 size={28} />
              </div>
                </div>
                <div className="dashboard-progress-bar">
                  <div className="dashboard-progress-fill dashboard-purple" style={{width: '40%'}}></div>
                </div>
              </div>
            </div>


            {/* Row 3: Shift Distribution Card */}
            <div className="dashboard-shift-overview">
              <div className="dashboard-shift-header">
                <h3>Live Shift Distribution</h3>
                <div className="dashboard-shift-time">
                  {new Date().toLocaleTimeString()}
                </div>
              </div>
              <div className="dashboard-shift-grid">
                {(dashboardShiftOrder.length > 0 ? dashboardShiftOrder : Object.keys(shiftDistribution))
                  .filter(shiftType => shiftDistribution[shiftType] != null)
                  .map((shiftType, index) => {
                  const data = shiftDistribution[shiftType];
                  // Colors by index so any shift from Shift_function gets a consistent color
                  const colors = ['#4D96FF', '#9B59B6', '#6BCF7F', '#FFD93D', '#FF6B6B', '#4ECDC4', '#FF9F43', '#95A5A6'];
                  const color = colors[index % colors.length];
                  return (
                    <div key={shiftType} className="dashboard-shift-card" style={{animationDelay: `${index * 0.1}s`}}>
                      <div className="dashboard-shift-indicator" style={{backgroundColor: color}}></div>
                      <div className="dashboard-shift-info">
                        <h4>{shiftType}</h4>
                        <p className="dashboard-shift-count">{data.attended}</p>
                        <div className="dashboard-shift-progress">
                          <div
                            className="dashboard-shift-progress-fill"
                            style={{
                              width: `${data.assigned > 0 ? (data.attended / data.assigned) * 100 : 0}%`,
                              backgroundColor: color
                            }}
                          ></div>
                        </div>
                        <div className="dashboard-shift-details">
                          <span className="dashboard-shift-attended">{data.attended} attended</span>
                          <span className="dashboard-shift-assigned">of {data.assigned} assigned</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Row 4: Interactive Charts Grid */}
            <div className="dashboard-charts-mega-grid">
              {/* Monthly Attendance Distribution */}
              <div className="dashboard-chart-card dashboard-interactive-card">
                <div className="dashboard-chart-header">
                  <div className="dashboard-chart-title-row">
                  <h3 className="dashboard-chart-title">
                    <Activity className="dashboard-chart-icon" size={20} />
                    Monthly Attendance Distribution - Present Count (Muster Reports)
                  </h3>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        className="dashboard-btn dashboard-interactive-btn"
                        onClick={() => {
                          console.log('Force refreshing attendance data for month:', selectedMonth);
                          setAttendancePieData([]);
                          const [year, month] = selectedMonth.split('-');
                          const startDate = `${selectedMonth}-01`;
                          const endDate = new Date(parseInt(year), parseInt(month), 0).toISOString().split('T')[0];
                          fetch(`/server/attendance_muster_function?startDate=${startDate}&endDate=${endDate}&source=both`)
                            .then(res => res.json())
                            .then((data) => {
                              if (data && data.muster && data.muster.length > 0) {
                                let presentTotal = 0;
                                let absentTotal = 0;
                                data.muster.forEach((employeeAttendance) => {
                                  if (employeeAttendance && employeeAttendance.length > 0) {
                                    employeeAttendance.forEach((dayStatus) => {
                                      if (dayStatus === 'Present' || dayStatus === 'P') presentTotal += 1;
                                      else if (dayStatus === 'Absent' || dayStatus === 'A') absentTotal += 1;
                                      else if (dayStatus === '0.5' || dayStatus === 0.5 || dayStatus === 'Half Day Present') {
                                        presentTotal += 0.5;
                                        absentTotal += 0.5;
                                      }
                                    });
                                  }
                                });
                                setAttendancePieData([
                                  { name: 'Present', value: Math.round(presentTotal), color: '#4ECDC4' },
                                  { name: 'Absent', value: Math.round(absentTotal), color: '#FF6B6B' },
                                ]);
                              }
                            })
                            .catch(err => console.error('Manual refresh failed:', err));
                        }}
                        title="Refresh Attendance Data"
                      >
                        <Zap size={20} />
                      </button>
                      <button
                        className="dashboard-btn dashboard-interactive-btn dashboard-pdf-btn"
                        onClick={async () => {
                          console.log('=== DEBUG BUTTON CLICKED ===');
                          try {
                            const today = new Date().toISOString().split('T')[0];
                            console.log('Testing debug endpoint for today:', today);
                           
                            const response = await fetch(`/server/importattendance_function/attendance/debug`);
                            const debugData = await response.json();
                            console.log('Debug endpoint response:', debugData);
                           
                            // Also test the regular attendance endpoint
                            const attendanceResponse = await fetch(`/server/importattendance_function/attendance?startDate=${today}&endDate=${today}&perPage=1000`);
                            const attendanceData = await attendanceResponse.json();
                            console.log('Regular attendance endpoint response:', attendanceData);
                           
                            alert(`Debug Results:\n\nDebug Endpoint:\n- Total Records: ${debugData.debug?.totalRecords || 0}\n- Records with FirstIn: ${debugData.debug?.recordsWithFirstIn || 0}\n\nRegular Endpoint:\n- Records Returned: ${attendanceData.data?.attendanceRecords?.length || 0}\n\nCheck console for detailed logs.`);
                          } catch (error) {
                            console.error('Debug button error:', error);
                            alert('Debug failed: ' + error.message);
                          }
                        }}
                        title="Debug Attendance Data"
                      >
                        <Activity size={20} />
                      </button>
                      <button
                        className="dashboard-btn dashboard-interactive-btn dashboard-pdf-btn"
                        onClick={handleDownloadMonthlyAttendancePDF}
                        title="Download Monthly Attendance Distribution PDF"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                          <polyline points="14,2 14,8 20,8"/>
                          <line x1="16" y1="13" x2="8" y2="13"/>
                          <line x1="16" y1="17" x2="8" y2="17"/>
                          <polyline points="10,9 9,9 8,9"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="dashboard-chart-controls">
                    <input
                      type="month"
                      value={selectedMonth}
                      onChange={(e) => setSelectedMonth(e.target.value)}
                      className="dashboard-month-filter"
                    />
                  </div>
                </div>
                <div className="dashboard-chart-canvas">
                  {isAttendanceLoading ? (
                    <div style={{
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      height: '300px',
                      color: '#4facfe',
                      fontSize: '1.1rem',
                      fontWeight: 'bold'
                    }}>
                      Loading attendance data...
                    </div>
                  ) : attendancePieData ? (
                    <canvas ref={diversityChartRef} width={350} height={300}></canvas>
                  ) : (
                    <div style={{
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      height: '300px',
                      color: '#64748b',
                      fontSize: '1.1rem',
                      fontWeight: 'bold',
                      textAlign: 'center'
                    }}>
                      <div>
                        <div style={{ marginBottom: '10px' }}>No attendance data available for the selected month</div>
                        <div style={{ fontSize: '0.9rem', color: '#94a3b8' }}>
                          Present: 0 (0%) | Absent: 0 (0%)
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Attendance Trend */}
              <div className="dashboard-chart-card dashboard-interactive-card">
                <div className="dashboard-chart-header">
                  <div className="dashboard-chart-title-row">
                  <h3 className="dashboard-chart-title">
                    <BarChart3 className="dashboard-chart-icon" size={20} />
                    Last 7 Days Attendance Percentage
                  </h3>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className="dashboard-btn dashboard-interactive-btn"
                      onClick={() => {
                        setAttendanceTrendData([]);
                        setTrendRefreshKey(k => k + 1);
                      }}
                      title="Refresh Attendance Trend"
                    >
                        <Target size={20} />
                    </button>
                    <button
                      className="dashboard-btn dashboard-interactive-btn dashboard-pdf-btn"
                      onClick={handleDownloadAttendanceTrendPDF}
                      title="Download Last 7 Days Attendance Percentage PDF"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14,2 14,8 20,8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                        <polyline points="10,9 9,9 8,9"/>
                      </svg>
                    </button>
                  </div>
                  </div>
                </div>
                <div className="dashboard-chart-canvas">
                  {isTrendLoading ? (
                    <div style={{
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      height: '300px',
                      color: '#4facfe',
                      fontSize: '1.1rem',
                      fontWeight: 'bold'
                    }}>
                      Loading trend data...
                    </div>
                  ) : (
                    <canvas ref={attendanceChartRef} width={350} height={300}></canvas>
                  )}
                </div>
              </div>

              {/* Daily Shift Distribution */}
              <div className="dashboard-chart-card dashboard-interactive-card">
                <div className="dashboard-chart-header">
                  <div className="dashboard-chart-title-row">
                  <h3 className="dashboard-chart-title">
                    <Clock className="dashboard-chart-icon" size={20} />
                    {Object.values(shiftDistribution).reduce((sum, shift) => sum + (shift.assigned || 0), 0) > 0
                      ? 'General Shift - L-Shaped Daily Employee Count'
                      : 'General Shift - Daily Employee Count (No Assignments)'}
                  </h3>
                    <button
                    className="dashboard-btn dashboard-interactive-btn"
                    onClick={() => {
                      setDailyShiftData([]);
                      setShiftDataRefreshKey(k => k + 1);
                    }}
                      title="Refresh daily present count"
                    >
                      <Star size={20} />
                    </button>
                    <button
                      className="dashboard-btn dashboard-interactive-btn dashboard-pdf-btn"
                      onClick={handleDownloadGeneralShiftPDF}
                      title="Download General Shift Daily Employee Count PDF"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14,2 14,8 20,8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                        <polyline points="10,9 9,9 8,9"/>
                      </svg>
                    </button>
                  </div>
                  <div className="dashboard-chart-controls">
                    <select
                      value={selectedShift}
                      onChange={(e) => setSelectedShift(e.target.value)}
                      className="dashboard-month-filter"
                      style={{ marginRight: '10px' }}
                    >
                      <option value="all">All Shifts</option>
                      {shiftList.length > 0 ? (
                        shiftList.map((shift, index) => (
                          <option key={shift} value={shift}>
                            {shift}
                          </option>
                        ))
                      ) : (
                        <option disabled>Loading shifts...</option>
                      )}
                    </select>
                    <div style={{fontSize: '12px', color: '#666', marginLeft: '10px', alignSelf: 'center'}}>
                      {dailyShiftData.length > 0 ? (
                        (() => {
                          const todayData = dailyShiftData.find(d => d.date === 'Today' || d.date === new Date().toLocaleDateString('en-US', { weekday: 'short' }));
                          const todayCount = todayData?.shifts?.General || 0;
                          return `Today's present employees: ${todayCount} | Last 7 days data available`;
                        })()
                      ) : (
                        'Loading employee count data...'
                      )}
                    </div>
                  </div>
                </div>
                <div className="dashboard-chart-canvas">
                  {isShiftDataLoading && dailyShiftData.length === 0 ? (
                    <div style={{
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      height: '300px',
                      color: '#4facfe',
                      fontSize: '1.1rem',
                      fontWeight: 'bold'
                    }}>
                      Loading employee count data...
                    </div>
                  ) : (
                    <canvas ref={shiftChartRef} width={350} height={300}></canvas>
                  )}
                </div>
              </div>

              {/* Late In Report - Week Wise Mon–Sun (replaces CL Addition Trend) */}
              <div className="dashboard-chart-card dashboard-interactive-card">
                <div className="dashboard-chart-header">
                  <div className="dashboard-chart-title-row">
                  <h3 className="dashboard-chart-title">
                    <TrendingUp className="dashboard-chart-icon" size={20} />
                    Late In Report - Week Wise (Mon–Sun with date, Current Month) - LIVE
                    <span style={{
                      display: 'inline-block',
                      width: '8px',
                      height: '8px',
                      backgroundColor: '#4ECDC4',
                      borderRadius: '50%',
                      marginLeft: '8px',
                      animation: 'pulse 2s infinite'
                    }} title="Live data" />
                  </h3>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className="dashboard-btn dashboard-interactive-btn"
                      onClick={() => { fetchLateInTrend(); setTimeout(() => createCLCharts(), 800); }}
                      title="Refresh Late In Trend"
                    >
                      <Heart size={20} />
                    </button>
                  </div>
                  </div>
                </div>
                <div className="dashboard-chart-canvas" style={{ minHeight: 280 }}>
                  {isLateInTrendLoading ? (
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      alignItems: 'center',
                      height: '300px',
                      color: '#4facfe',
                      fontSize: '1.1rem',
                      fontWeight: 'bold'
                    }}>
                      <div style={{ marginBottom: '10px' }}>Loading Late In week-wise data...</div>
                      <div style={{ fontSize: '0.9rem', color: '#666' }}>Auto-refresh every 30s</div>
                    </div>
                  ) : lateInTrendData && lateInTrendData.length > 0 ? (
                    <div style={{ height: 250, width: '100%', position: 'relative' }}>
                      <canvas ref={clAdditionChartRef} style={{ width: '100%', height: '100%', display: 'block' }}></canvas>
                    </div>
                  ) : (
                    <div style={{
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      height: '300px',
                      color: '#64748b',
                      fontSize: '1.1rem',
                      fontWeight: 'bold',
                      textAlign: 'center'
                    }}>
                      No Late In data for current month
                    </div>
                  )}
                </div>
              </div>

              {/* Month Employee Details Modal */}
              {showMonthDetails && (
                <div className="dashboard-modal-overlay" onClick={() => setShowMonthDetails(false)}>
                  <div className="dashboard-modal-content" onClick={(e) => e.stopPropagation()}>
                    <div className="dashboard-modal-header">
                      <h3 className="dashboard-modal-title">
                        <Users size={20} />
                        Employee Details - {selectedChartMonth} {new Date().getFullYear()}
                        {selectedContractorForCLAddition !== 'all' && ` (${selectedContractorForCLAddition})`}
                      </h3>
                      <button
                        className="dashboard-modal-close"
                        onClick={() => setShowMonthDetails(false)}
                      >
                        ×
                      </button>
                    </div>
                   
                    <div className="dashboard-modal-body">
                      {isLoadingMonthDetails ? (
                        <div className="dashboard-modal-no-data">
                          <div style={{ fontSize: '1.2rem', marginBottom: '10px' }}>
                            🔄 Loading employee details...
                          </div>
                          <div style={{ color: '#666' }}>
                            Fetching data for {selectedChartMonth} {new Date().getFullYear()}
                          </div>
                        </div>
                      ) : monthEmployeeDetails.length > 0 ? (
                        <div>
                          <div className="dashboard-modal-summary">
                            <div className="dashboard-modal-stat">
                              <span className="dashboard-modal-stat-label">Total Employees Joined:</span>
                              <span className="dashboard-modal-stat-value">{monthEmployeeDetails.length}</span>
                            </div>
                            <div className="dashboard-modal-stat">
                              <span className="dashboard-modal-stat-label">Last Updated:</span>
                              <span className="dashboard-modal-stat-value">{new Date().toLocaleTimeString()}</span>
                            </div>
                          </div>
                         
                          <div className="dashboard-modal-employee-list">
                            <h4>Employee List:</h4>
                            <div className="dashboard-modal-employee-grid">
                              {monthEmployeeDetails.map((emp, index) => (
                                <div key={index} className="dashboard-modal-employee-card">
                                  <div className="dashboard-modal-employee-info">
                                    <div className="dashboard-modal-employee-name">
                                      {emp.name || 'Unknown Employee'}
                                    </div>
                                    <div className="dashboard-modal-employee-details">
                                      <div><strong>ID:</strong> {emp.employeeId || 'N/A'}</div>
                                      <div><strong>Contractor:</strong> {emp.contractor || 'Unknown'}</div>
                                      <div><strong>Department:</strong> {emp.department || 'N/A'}</div>
                                      <div><strong>Designation:</strong> {emp.designation || 'N/A'}</div>
                                      <div><strong>Joining Date:</strong> {emp.joiningDate ? new Date(emp.joiningDate).toLocaleDateString() : 'N/A'}</div>
                                      <div><strong>Phone:</strong> {emp.phone || 'N/A'}</div>
                                      <div><strong>Email:</strong> {emp.email || 'N/A'}</div>
                                      <div><strong>Location:</strong> {emp.location || 'N/A'}</div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="dashboard-modal-no-data">
                          <div style={{ fontSize: '1.2rem', marginBottom: '10px' }}>
                            📊 No employees found for {selectedChartMonth} {new Date().getFullYear()}
                          </div>
                          <div style={{ color: '#666' }}>
                            {selectedContractorForCLAddition !== 'all'
                              ? `No employees joined for contractor "${selectedContractorForCLAddition}" in this month.`
                              : 'No employees joined in this month.'
                            }
                          </div>
                        </div>
                      )}
                    </div>
                   
                    <div className="dashboard-modal-footer">
                      <button
                        className="dashboard-btn dashboard-primary-btn"
                        onClick={() => setShowMonthDetails(false)}
                      >
                        Close
                      </button>
                      <button
                        className="dashboard-btn dashboard-secondary-btn"
                        onClick={() => {
                          fetchMonthEmployeeDetails(selectedChartMonth, selectedContractorForCLAddition);
                        }}
                      >
                        🔄 Refresh Data
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Payroll - Earned Gross & Total Salary (Last 6 Months) - replaces CL Attrition */}
              <div className="dashboard-chart-card dashboard-interactive-card">
                <div className="dashboard-chart-header">
                  <div className="dashboard-chart-title-row">
                  <h3 className="dashboard-chart-title">
                    <TrendingDown className="dashboard-chart-icon" size={20} />
                    Payroll - Earned Gross & Total Salary (Last 6 Months)
                  </h3>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className="dashboard-btn dashboard-interactive-btn"
                      onClick={() => { fetchPayrollGrossTrend(); setTimeout(() => createCLCharts(), 800); }}
                      title="Refresh Payroll Trend"
                    >
                      <Award size={20} />
                    </button>
                  </div>
                  </div>
                </div>
                <div className="dashboard-chart-canvas" style={{ minHeight: 280 }}>
                  {isPayrollTrendLoading ? (
                    <div style={{
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      height: '300px',
                      color: '#4facfe',
                      fontSize: '1.1rem',
                      fontWeight: 'bold'
                    }}>
                      Loading payroll data...
                    </div>
                  ) : payrollGrossTrendData && payrollGrossTrendData.length > 0 ? (
                    <div style={{ height: 250, width: '100%', position: 'relative' }}>
                      <canvas ref={clAttritionChartRef} style={{ width: '100%', height: '100%', display: 'block' }}></canvas>
                    </div>
                  ) : (
                    <div style={{
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      height: '300px',
                      color: '#64748b',
                      fontSize: '1.1rem',
                      fontWeight: 'bold',
                      textAlign: 'center'
                    }}>
                      No payroll data for the last 6 months
                    </div>
                  )}
                </div>
              </div>

              {/* LOH and OT Hours Month Report - comparison chart */}
              <div className="dashboard-chart-card dashboard-interactive-card">
                <div className="dashboard-chart-header">
                  <div className="dashboard-chart-title-row">
                    <h3 className="dashboard-chart-title">
                      <BarChart3 className="dashboard-chart-icon" size={20} />
                      LOH and OT Hours Month Report
                    </h3>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        className="dashboard-btn dashboard-interactive-btn"
                        onClick={() => { fetchLohOtTrend(); setTimeout(() => createCLCharts(), 800); }}
                        title="Refresh LOH & OT data"
                      >
                        <Activity size={20} />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="dashboard-chart-canvas" style={{ minHeight: 280 }}>
                  {isLohOtLoading ? (
                    <div style={{
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      height: '300px',
                      color: '#4facfe',
                      fontSize: '1.1rem',
                      fontWeight: 'bold'
                    }}>
                      Loading LOH & OT data...
                    </div>
                  ) : lohOtTrendData && lohOtTrendData.length > 0 ? (
                    <div style={{ height: 250, width: '100%', position: 'relative' }}>
                      <canvas ref={lohOtChartRef} style={{ width: '100%', height: '100%', display: 'block' }}></canvas>
                    </div>
                  ) : (
                    <div style={{
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      height: '300px',
                      color: '#64748b',
                      fontSize: '1.1rem',
                      fontWeight: 'bold',
                      textAlign: 'center'
                    }}>
                      No LOH or OT data for the last 6 months
                    </div>
                  )}
                </div>
              </div>

            </div>

            {/* User Welcome Message for App Users */}
            {userRole === 'App User' && (
              <div className="dashboard-welcome-section">
                <div className="dashboard-welcome-card">
                  <div className="dashboard-welcome-icon">
                    <Users size={48} />
                  </div>
                  <div className="dashboard-welcome-content">
                    <h2>Welcome to Your Interactive Dashboard</h2>
                    <p>
                      Experience the power of real-time data visualization and gamified interactions.
                      Your dashboard includes Employee Management, Attendance Tracking, Candidate Management,
                      and Attendance Muster with beautiful animations and insights.
                    </p>
                    <div className="dashboard-feature-highlights">
                      <div className="dashboard-feature-item">
                        <CheckCircle size={20} />
                        <span>Real-time Updates</span>
                      </div>
                      <div className="dashboard-feature-item">
                        <Activity size={20} />
                        <span>Interactive Charts</span>
                      </div>
                      <div className="dashboard-feature-item">
                        <Trophy size={20} />
                        <span>Achievement System</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Contractor Tooltip */}
            {showContractorTooltip && (
              <div
                className="contractor-tooltip"
                style={{
                  position: 'fixed',
                  left: `${tooltipPosition.x}px`,
                  top: `${tooltipPosition.y}px`,
                  transform: 'translateX(-50%)',
                  zIndex: 1000
                }}
              >
                <div className="contractor-tooltip-content">
                  <div className="contractor-tooltip-header">
                    <h3>
                      {contractorViewMode === 'overview' ? 'Employee Distribution' : `Employees - ${(selectedContractorForDetails?.contractorName && selectedContractorForDetails.contractorName !== 'Unknown') ? selectedContractorForDetails.contractorName : 'Employees'}`}
                    </h3>
                    <div className="contractor-tooltip-controls">
                      <button
                        className="contractor-tooltip-close"
                        onClick={handleCloseContractorTooltip}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <div className="contractor-tooltip-body">
                    {contractorViewMode === 'overview' ? (
                      // Contractor overview
                      contractorEmployeeData.length > 0 ? (
                        <div className="contractor-list-container">
                          <div style={{
                            background: 'linear-gradient(135deg, #87CEEB 0%, #4682B4 100%)',
                            color: 'white',
                            padding: '12px 16px',
                            fontWeight: '600',
                            fontSize: '0.9rem',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                            borderRadius: '8px 8px 0 0',
                            display: 'flex',
                            justifyContent: 'space-between'
                          }}>
                            <span>Contractor</span>
                            <span>Count</span>
                          </div>
                          <div style={{border: '1px solid #ddd', borderTop: 'none', borderRadius: '0 0 8px 8px'}}>
                            {contractorEmployeeData.map((contractor, index) => {
                              console.log('Rendering contractor:', contractor);
                              console.log('Contractor name:', contractor.contractorName);
                              return (
                                <div
                                  key={index}
                                  onClick={() => handleContractorDetailsClick(contractor)}
                                  style={{
                                    color: '#000000',
                                    fontWeight: 'bold',
                                    backgroundColor: 'white',
                                    padding: '12px 16px',
                                    borderBottom: '1px solid #ddd',
                                    fontSize: '14px',
                                    cursor: 'pointer',
                                    transition: 'background-color 0.2s ease',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center'
                                  }}
                                  onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(135, 206, 235, 0.1)'}
                                  onMouseLeave={(e) => e.target.style.backgroundColor = 'white'}
                                >
                                  <span>{(contractor.contractorName && contractor.contractorName !== 'Unknown') ? contractor.contractorName : 'Employees'}</span>
                                  <span style={{color: '#4682B4', fontWeight: '800'}}>{contractor.employeeCount}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="no-data" style={{color: '#64748b', padding: '20px', textAlign: 'center'}}>
                          {userRole === 'App User' || userRole === 'Contractor' ? (
                            <div>
                              <div style={{fontSize: '16px', fontWeight: 'bold', marginBottom: '8px'}}>
                                Limited Access
                              </div>
                              <div style={{fontSize: '14px'}}>
                                You can only view data for your assigned contractor.
                              </div>
                              <div style={{fontSize: '12px', marginTop: '8px', color: '#94a3b8'}}>
                                Contact your administrator for full access.
                              </div>
                            </div>
                          ) : (
                            <div>
                              <div style={{fontSize: '16px', fontWeight: 'bold', marginBottom: '8px'}}>
                                No Data Available
                              </div>
                              <div style={{fontSize: '14px'}}>
                                No contractor data found. Please check your data import.
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    ) : (
                      // Employee list view
                      selectedContractorForDetails && (
                        <div className="contractor-employees-list">
                          <div className="contractor-employees-header">
                            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%'}}>
                              <span className="contractor-employees-title">
                                {(selectedContractorForDetails.contractorName && selectedContractorForDetails.contractorName !== 'Unknown') ? selectedContractorForDetails.contractorName : 'Employees'} ({selectedContractorForDetails.employeeCount} employees)
                              </span>
                              <button
                                onClick={handleBackToContractorOverview}
                                style={{
                                  background: 'white',
                                  border: '1px solid #ddd',
                                  color: 'black',
                                  padding: '8px 12px',
                                  borderRadius: '6px',
                                  fontSize: '18px',
                                  fontWeight: 'bold',
                                  cursor: 'pointer',
                                  transition: 'all 0.2s ease',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  minWidth: '32px',
                                  minHeight: '32px',
                                  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
                                }}
                                onMouseEnter={(e) => {
                                  e.target.style.background = '#f0f0f0';
                                  e.target.style.transform = 'scale(1.1)';
                                  e.target.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.2)';
                                }}
                                onMouseLeave={(e) => {
                                  e.target.style.background = 'white';
                                  e.target.style.transform = 'scale(1)';
                                  e.target.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
                                }}
                                title="Back to contractors"
                              >
                                ←
                              </button>
                            </div>
                          </div>
                          <div className="employee-list">
                            {(showAllEmployees ? selectedContractorForDetails.employees : selectedContractorForDetails.employees.slice(0, 5)).map((employee, index) => (
                              <div key={index} className="employee-item">
                                <span className="employee-code">{employee.employeeCode || employee.EmployeeCode || employee.id || 'N/A'}</span>
                                <span className="employee-name">{employee.employeeName}</span>
                              </div>
                            ))}
                            {!showAllEmployees && selectedContractorForDetails.employees.length > 5 && (
                              <button
                                onClick={handleShowAllEmployees}
                                style={{
                                  background: 'linear-gradient(135deg, #87CEEB 0%, #4682B4 100%)',
                                  border: 'none',
                                  color: 'white',
                                  padding: '12px 24px',
                                  borderRadius: '8px',
                                  fontSize: '14px',
                                  fontWeight: '600',
                                  cursor: 'pointer',
                                  transition: 'all 0.2s ease',
                                  width: '100%',
                                  marginTop: '10px',
                                  transform: 'translateY(0)',
                                  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
                                }}
                                onMouseEnter={(e) => {
                                  e.target.style.transform = 'translateY(-2px)';
                                  e.target.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.2)';
                                }}
                                onMouseLeave={(e) => {
                                  e.target.style.transform = 'translateY(0)';
                                  e.target.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
                                }}
                              >
                                Show All {selectedContractorForDetails.employees.length} Employees
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Present Employees Tooltip */}
            {showPresentTooltip && (
              <div
                className="present-tooltip"
                style={{
                  position: 'fixed',
                  left: `${presentTooltipPosition.x}px`,
                  top: `${presentTooltipPosition.y}px`,
                  transform: 'translateX(-50%)',
                  zIndex: 1000
                }}
              >
                <div className="present-tooltip-content">
                  <div className="present-tooltip-header">
                    <h3>
                      {presentViewMode === 'contractors' ? 'Active Employees' : `Employees - ${(selectedPresentContractor && selectedPresentContractor !== 'Unknown') ? selectedPresentContractor : 'Employees'}`}
                    </h3>
                    <div className="present-tooltip-controls">
                      {presentViewMode === 'employees' && (
                        <button
                          className="present-tooltip-back"
                          onClick={handleBackToContractors}
                        >
                          ← Back
                        </button>
                      )}
                      <button
                        className="present-tooltip-close"
                        onClick={handleClosePresentTooltip}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <div className="present-tooltip-body">
                    {presentViewMode === 'contractors' ? (
                      <div className="contractor-list">
                        <div className="present-summary">
                          <span className="present-count">{presentEmployeesData.length} employees present today</span>
                        </div>
                        {contractorEmployeeCounts.map((contractor, index) => (
                          <div
                            key={index}
                            className="contractor-item"
                            onClick={() => handleContractorClick(contractor.contractorName)}
                          >
                            <div className="contractor-info single-line">
                              <div className="contractor-name-count">
                                {(contractor.contractorName && contractor.contractorName !== 'Unknown') ? contractor.contractorName : 'Employees'}
                              </div>
                              <div className="contractor-count">
                                {contractor.employeeCount}
                              </div>
                            </div>
                          </div>
                        ))}
                        {contractorEmployeeCounts.length === 0 && (
                          <div className="no-data">No employees present today</div>
                        )}
                      </div>
                    ) : (
                      <div className="present-employees-list">
                        <div className="present-summary">
                          <span className="present-count">
                            {contractorEmployeeCounts.find(c => c.contractorName === selectedPresentContractor)?.employeeCount || 0} employees from {(selectedPresentContractor && selectedPresentContractor !== 'Unknown') ? selectedPresentContractor : 'Employees'}
                          </span>
                        </div>
                        <div className="employee-codes-table">
                          {contractorEmployeeCounts
                            .find(c => c.contractorName === selectedPresentContractor)
                            ?.employees?.map((employee, index) => (
                              <div key={index} className="employee-code-cell">
                                <span className="employee-code">{employee.employeeCode || employee.EmployeeCode || employee.id || 'N/A'}</span>
                                <span className="employee-name">{employee.employeeName || employee.EmployeeName || employee.name || '—'}</span>
                              </div>
                            ))}
                        </div>
                        {(!contractorEmployeeCounts.find(c => c.contractorName === selectedPresentContractor)?.employees ||
                          contractorEmployeeCounts.find(c => c.contractorName === selectedPresentContractor)?.employees?.length === 0) && (
                          <div className="no-data">No employees found for this contractor</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Previous Day Miss Punch Tooltip - positioned near the card */}
            {showMissPunchTooltip && (
              <div
                className="misspunch-tooltip"
                style={{
                  position: 'fixed',
                  left: `${missPunchTooltipPosition.x}px`,
                  top: `${missPunchTooltipPosition.y}px`,
                  transform: 'translateX(-50%)',
                  zIndex: 1000,
                  minWidth: '320px',
                  maxWidth: '90vw',
                  maxHeight: '80vh'
                }}
              >
                <div className="absent-tooltip-content" style={{ maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
                  <div className="absent-tooltip-header">
                    <h3>Previous Day Miss Punch – Employee Code & Name</h3>
                    <button
                      type="button"
                      className="absent-tooltip-close"
                      onClick={() => setShowMissPunchTooltip(false)}
                    >
                      ×
                    </button>
                  </div>
                  <div className="absent-tooltip-body" style={{ overflow: 'auto', flex: 1 }}>
                    <div className="absent-summary">
                      <span className="absent-count">{prevDayMissPunchData.length} employee(s) with miss punch yesterday</span>
                    </div>
                    {prevDayMissPunchData.length === 0 ? (
                      <div className="no-data">No miss punch for previous day</div>
                    ) : (
                      <div className="employee-codes-table" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '8px 0' }}>
                        {prevDayMissPunchData.map((row, index) => (
                          <div key={`${row.employeeId}-${row.date}-${index}`} className="employee-code-cell">
                            <span className="employee-code">{row.employeeId || 'N/A'}</span>
                            <span className="employee-name">{row.employeeName || '—'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Absent Employees Tooltip */}
            {showAbsentTooltip && (
              <div
                className="absent-tooltip"
                style={{
                  position: 'fixed',
                  left: `${absentTooltipPosition.x}px`,
                  top: `${absentTooltipPosition.y}px`,
                  transform: 'translateX(-50%)',
                  zIndex: 1000
                }}
              >
                <div className="absent-tooltip-content">
                  <div className="absent-tooltip-header">
                    <h3>
                      {absentViewMode === 'contractors' ? 'Absent Employees' : `Employees - ${(selectedAbsentContractor && selectedAbsentContractor !== 'Unknown') ? selectedAbsentContractor : 'Employees'}`}
                    </h3>
                    <div className="absent-tooltip-controls">
                      {absentViewMode === 'employees' && (
                        <button
                          className="absent-tooltip-back"
                          onClick={handleBackToAbsentContractors}
                        >
                          ← Back
                        </button>
                      )}
                      <button
                        className="absent-tooltip-close"
                        onClick={handleCloseAbsentTooltip}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <div className="absent-tooltip-body">
                    {absentViewMode === 'contractors' ? (
                      <div className="contractor-list">
                        <div className="absent-summary">
                          <span className="absent-count">{absentEmployeesData.length} employees absent today</span>
                        </div>
                        {absentContractorEmployeeCounts.map((contractor, index) => (
                          <div
                            key={index}
                            className="contractor-item absent-contractor-item"
onClick={() => handleAbsentContractorClick(contractor.contractorName)}
                            >
                            <div className="contractor-info single-line">
                              <div className="contractor-name-count">
                                {(contractor.contractorName && contractor.contractorName !== 'Unknown') ? contractor.contractorName : 'Employees'}
                              </div>
                              <div className="contractor-count absent-count">
                                {contractor.employeeCount}
                              </div>
                            </div>
                          </div>
                        ))}
                        {absentContractorEmployeeCounts.length === 0 && (
                          <div className="no-data">No employees absent today</div>
                        )}
                      </div>
                    ) : (
                      <div className="absent-employees-list">
                        <div className="absent-summary">
                          <span className="absent-count">
                            {absentContractorEmployeeCounts.find(c => c.contractorName === selectedAbsentContractor)?.employeeCount || 0} employees from {(selectedAbsentContractor && selectedAbsentContractor !== 'Unknown') ? selectedAbsentContractor : 'Employees'}
                          </span>
                        </div>
                        <div className="employee-codes-table">
                          {absentContractorEmployeeCounts
                            .find(c => c.contractorName === selectedAbsentContractor)
                            ?.employees?.map((employee, index) => (
                              <div key={index} className="employee-code-cell">
                                <span className="employee-code">{employee.employeeCode || employee.EmployeeCode || employee.id || 'N/A'}</span>
                                <span className="employee-name">{employee.employeeName || employee.EmployeeName || employee.name || '—'}</span>
                              </div>
                            ))}
                        </div>
                        {(!absentContractorEmployeeCounts.find(c => c.contractorName === selectedAbsentContractor)?.employees ||
                          absentContractorEmployeeCounts.find(c => c.contractorName === selectedAbsentContractor)?.employees?.length === 0) && (
                          <div className="no-data">No employees found for this contractor</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Today's Late In Tooltip - positioned near the card */}
            {showTodayLateInTooltip && (
              <div
                className="today-latein-tooltip"
                style={{
                  position: 'fixed',
                  left: `${todayLateInTooltipPosition.x}px`,
                  top: `${todayLateInTooltipPosition.y}px`,
                  transform: 'translateX(-50%)',
                  zIndex: 1000,
                  minWidth: '320px',
                  maxWidth: '90vw',
                  maxHeight: '80vh'
                }}
              >
                <div className="absent-tooltip-content" style={{ maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
                  <div className="absent-tooltip-header">
                    <h3>Today&apos;s Late In – Employee Code & Name</h3>
                    <button
                      type="button"
                      className="absent-tooltip-close"
                      onClick={() => setShowTodayLateInTooltip(false)}
                    >
                      ×
                    </button>
                  </div>
                  <div className="absent-tooltip-body" style={{ overflow: 'auto', flex: 1 }}>
                    <div className="absent-summary">
                      <span className="absent-count">{todayLateInData.length} employee(s) late in today</span>
                    </div>
                    {todayLateInData.length === 0 ? (
                      <div className="no-data">No late in for today</div>
                    ) : (
                      <div className="employee-codes-table" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '8px 0' }}>
                        {todayLateInData.map((row, index) => (
                          <div key={`${row.employeeId}-${row.date}-${index}`} className="employee-code-cell">
                            <span className="employee-code">{row.employeeId || 'N/A'}</span>
                            <span className="employee-name">{row.employeeName || '—'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </>
  );
}

export default Dashboard;
