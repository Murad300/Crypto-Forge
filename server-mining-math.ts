// Server-side mining math and pro-rata calculation utilities
const SECONDS_IN_DAY = 86400;

export function getBDDate(date: Date = new Date()): string {
  const d = new Date(date);
  const dhakaTime = new Date(d.getTime() + (6 * 60 * 60 * 1000));
  const y = dhakaTime.getUTCFullYear();
  const m = String(dhakaTime.getUTCMonth() + 1).padStart(2, '0');
  const r = String(dhakaTime.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${r}`;
}

export function getBDMidnight(dateStr: string): Date {
  const cleanStr = String(dateStr).replace(/\//g, '-').trim();
  const parts = cleanStr.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const utcMidnightDhaka = Date.UTC(year, month, day) - (6 * 60 * 60 * 1000);
  return new Date(utcMidnightDhaka);
}

export function getBDEndOfDay(dateStr: string): Date {
  const cleanStr = String(dateStr).replace(/\//g, '-').trim();
  const parts = cleanStr.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const utcEndDhaka = Date.UTC(year, month, day, 23, 59, 59) - (6 * 60 * 60 * 1000);
  return new Date(utcEndDhaka);
}

export function calculateProfit(seconds: number, dailyProfit: number): number {
  return (seconds / SECONDS_IN_DAY) * dailyProfit;
}

export function getActiveSecondsForToday(pkg: any, hasActiveRobot: boolean): number {
  const now = new Date();
  const todayStr = getBDDate(now);
  
  if (pkg.lastMiningStartDay !== todayStr && !hasActiveRobot) {
    return 0;
  }
  
  let startTime;
  if (pkg.lastMiningStartDay === todayStr && pkg.lastMiningStartTime) {
    startTime = new Date(pkg.lastMiningStartTime);
  } else {
    startTime = getBDMidnight(todayStr);
  }
  
  const midnightEnd = getBDEndOfDay(todayStr);
  const totalSecondsInSession = (midnightEnd.getTime() - startTime.getTime()) / 1000;
  
  let elapsedSeconds = (now.getTime() - startTime.getTime()) / 1000;
  if (elapsedSeconds < 0) elapsedSeconds = 0;
  if (elapsedSeconds > totalSecondsInSession) elapsedSeconds = totalSecondsInSession;
  
  return elapsedSeconds;
}

export function calculateInstantCommission(packagePrice: number): number {
  return packagePrice * 0.10; // 10% direct offline commission
}

export function calculateDailyCommission(dailyMiningIncome: number): number {
  return dailyMiningIncome * 0.025; // 2.5% daily mining commission for upline
}

// Universal getDhakaDate helper (mirrored on server)
export function getDhakaDate(date: Date = new Date()): Date {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Dhaka',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    const parts = formatter.formatToParts(date);
    const year = parseInt(parts.find(p => p.type === 'year')?.value || '2026', 10);
    const month = parseInt(parts.find(p => p.type === 'month')?.value || '1', 10) - 1;
    const day = parseInt(parts.find(p => p.type === 'day')?.value || '1', 10);
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
    const second = parseInt(parts.find(p => p.type === 'second')?.value || '0', 10);
    const dDate = new Date(year, month, day, hour, minute, second);
    if (isNaN(dDate.getTime())) throw new Error("Parsed date is NaN");
    return dDate;
  } catch (e) {
    const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
    return new Date(utc + (3600000 * 6)); // Dhaka is UTC+6
  }
}

// Mirror of calculations
export function calculateAccruedEarnings(pkg: any, myActiveRobots: any[], now: Date = new Date()) {
  const todayStr = getBDDate(now);
  const dailyProfit = Number(pkg.daily || pkg.dailyProfit || pkg.dailyProfitAmount || 0);
  
  const lastClaimTimeStr = pkg.lastClaimTime || pkg.purchasedAt || pkg.purchasedAtTime;
  let lastClaimDayStr = todayStr;
  try {
    if (lastClaimTimeStr) {
      const d = new Date(lastClaimTimeStr);
      if (!pkg.lastClaimDate) {
        const shifted = new Date(d.getTime() - 24 * 60 * 60 * 1000);
        lastClaimDayStr = getBDDate(shifted);
      } else {
        lastClaimDayStr = getBDDate(d);
      }
    }
  } catch(e) {
    lastClaimDayStr = todayStr;
  }
  
  let unclaimedCompleted = 0;
  
  try {
    // Calculate completed dates from the day after last claim up to yesterday
    const cur = new Date(getBDMidnight(lastClaimDayStr).getTime());
    cur.setDate(cur.getDate() + 1);
    const yesterdayLimit = new Date(getBDMidnight(todayStr).getTime());
    
    while (cur < yesterdayLimit) {
      const dStr = getBDDate(cur);
      const robotActive = myActiveRobots && myActiveRobots.some(r => {
        if (r.status !== 'active') return false;
        const rExp = r.expiresAt ? new Date(r.expiresAt) : null;
        return rExp && rExp > getBDMidnight(dStr);
      });
      
      if (robotActive) {
        unclaimedCompleted += dailyProfit;
      }
      cur.setDate(cur.getDate() + 1);
    }
  } catch(err) {
    console.warn("Server calculation warn for older days:", err);
  }
  
  // Now analyze the current active day (today)
  const robotActiveToday = myActiveRobots && myActiveRobots.some(r => {
    if (r.status !== 'active') return false;
    const rExp = r.expiresAt ? new Date(r.expiresAt) : null;
    return rExp && rExp > now;
  });
  
  let sessionStartTime = null;
  let sessionEndTime = null;
  let totalSessionSeconds = 0;
  let isRobotStarted = false;
  let sessionType = 'none';
  
  const bdMidnight = getBDMidnight(todayStr);
  
  if (robotActiveToday) {
    // AI robots work 24/7, starting from midnight Dhaka time to run the full day
    sessionStartTime = bdMidnight;
    sessionEndTime = new Date(bdMidnight.getTime() + 24 * 60 * 60 * 1000); // 12:00 AM next day
    totalSessionSeconds = 24 * 60 * 60; // 24 hours (86400 seconds)
    isRobotStarted = true;
    sessionType = 'robot';
  } else if (pkg.lastMiningStartTime) {
    // Check if there is an active manual session currently running
    const mStart = new Date(pkg.lastMiningStartTime);
    const mEnd = new Date(mStart.getTime() + 24 * 60 * 60 * 1000);
    const isClaimedObj = pkg.lastClaimTime && new Date(pkg.lastClaimTime) >= mStart;
    
    if (!isClaimedObj) {
      if (now.getTime() < (mEnd.getTime() - 300000)) { // 5-minute grace period to eliminate small clock skew errors
        sessionStartTime = mStart;
        sessionEndTime = mEnd;
        totalSessionSeconds = 24 * 60 * 60;
        isRobotStarted = false;
        sessionType = 'manual';
      } else {
        // Completed but unclaimed!
        unclaimedCompleted += dailyProfit;
      }
    }
  }
  
  let liveEarnToday = 0;
  let percent = 0;
  let isActive = false;
  
  if (sessionStartTime && !isNaN(sessionStartTime.getTime()) && sessionEndTime && !isNaN(sessionEndTime.getTime()) && totalSessionSeconds > 0) {
    let lastClaimTimeMs = 0;
    try {
      if (lastClaimTimeStr) {
        lastClaimTimeMs = new Date(lastClaimTimeStr).getTime();
      }
    } catch(e) {}
    if (isNaN(lastClaimTimeMs) || !lastClaimTimeMs) {
      lastClaimTimeMs = sessionStartTime.getTime();
    }
    
    const nowTime = now.getTime();
    const startVal = sessionStartTime.getTime();
    const endVal = sessionEndTime.getTime();
    
    if (nowTime < startVal) {
      // Clock skew fallback - start ticking immediately with a small initial padding (e.g. 5 seconds) to keep user interface animated
      isActive = true;
      let totalSessionElapsed = Math.max(1, 5 + (nowTime - startVal) / 1000);
      percent = (totalSessionElapsed / totalSessionSeconds) * 100;
      
      const earningStartTime = new Date(Math.max(startVal, lastClaimTimeMs));
      let elapsedAccrualSeconds = Math.max(totalSessionElapsed, (nowTime - earningStartTime.getTime()) / 1000);
      liveEarnToday = (elapsedAccrualSeconds / totalSessionSeconds) * dailyProfit;
    } else if (nowTime >= endVal) {
      percent = 100;
      isActive = false;
      const earningStartTime = new Date(Math.max(startVal, lastClaimTimeMs));
      let elapsedAccrualSeconds = (endVal - earningStartTime.getTime()) / 1000;
      if (elapsedAccrualSeconds < 0) elapsedAccrualSeconds = 0;
      liveEarnToday = (elapsedAccrualSeconds / totalSessionSeconds) * dailyProfit;
    } else {
      isActive = true;
      let totalSessionElapsed = (nowTime - startVal) / 1000;
      if (totalSessionElapsed < 0) totalSessionElapsed = 0;
      if (totalSessionElapsed > totalSessionSeconds) totalSessionElapsed = totalSessionSeconds;
      percent = (totalSessionElapsed / totalSessionSeconds) * 100;
      
      const earningStartTime = new Date(Math.max(startVal, lastClaimTimeMs));
      const accrualEndTime = new Date(Math.min(nowTime, endVal));
      let elapsedAccrualSeconds = (accrualEndTime.getTime() - earningStartTime.getTime()) / 1000;
      if (elapsedAccrualSeconds < 0) elapsedAccrualSeconds = 0;
      liveEarnToday = (elapsedAccrualSeconds / totalSessionSeconds) * dailyProfit;
    }
  }
  
  if (isNaN(percent) || percent < 0) percent = 0;
  if (isNaN(liveEarnToday) || liveEarnToday < 0) liveEarnToday = 0;
  
  const activeSession = sessionStartTime ? {
    isActive,
    startTime: sessionStartTime,
    endTime: sessionEndTime,
    elapsedSeconds: sessionStartTime ? (now.getTime() - sessionStartTime.getTime()) / 1000 : 0,
    liveEarnings: liveEarnToday,
    percent,
    maxPotential: dailyProfit,
    isRobotStarted
  } : {
    isActive: false,
    maxPotential: dailyProfit
  };
  
  const totalClaimable = unclaimedCompleted + liveEarnToday;
  
  const hasClaimedToday = pkg.lastClaimTime ? (getBDDate(new Date(pkg.lastClaimTime)) === todayStr) : false;
  const isSessionOver = sessionEndTime ? (now.getTime() >= sessionEndTime.getTime()) : true;
  const isClaimedToday = hasClaimedToday && (isSessionOver || liveEarnToday === 0);
  
  return {
    unclaimedCompleted,
    activeSession,
    totalClaimable,
    isClaimedToday
  };
}
