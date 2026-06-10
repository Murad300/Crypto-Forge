// Mining calculation engine - Real-time client-side calculation utilities
const SECONDS_IN_DAY = 86400;

export function getBDDate(date = (window.getSyncedNow ? window.getSyncedNow() : new Date())) {
  const d = new Date(date);
  const dhakaTime = new Date(d.getTime() + (6 * 60 * 60 * 1000));
  const y = dhakaTime.getUTCFullYear();
  const m = String(dhakaTime.getUTCMonth() + 1).padStart(2, '0');
  const r = String(dhakaTime.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${r}`;
}

export function getBDMidnight(dateStr) {
  const cleanStr = String(dateStr).replace(/\//g, '-').trim();
  const parts = cleanStr.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const utcMidnightDhaka = Date.UTC(year, month, day) - (6 * 60 * 60 * 1000);
  return new Date(utcMidnightDhaka);
}

export function getBDEndOfDay(dateStr) {
  const cleanStr = String(dateStr).replace(/\//g, '-').trim();
  const parts = cleanStr.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const utcEndDhaka = Date.UTC(year, month, day, 23, 59, 59) - (6 * 60 * 60 * 1000);
  return new Date(utcEndDhaka);
}

export function calculateProfit(seconds, dailyProfit) {
  return (seconds / SECONDS_IN_DAY) * dailyProfit;
}

export function getActiveSecondsForToday(pkg, hasActiveRobot) {
  const now = new Date();
  const todayStr = getBDDate(now);
  
  if (pkg.lastMiningStartDay !== todayStr && !hasActiveRobot) {
    return 0; // Not started manually and no robot
  }
  
  // Start boundary: either when manually started or midnight if robot
  let startTime;
  if (pkg.lastMiningStartDay === todayStr && pkg.lastMiningStartTime) {
    startTime = new Date(pkg.lastMiningStartTime);
  } else {
    startTime = getBDMidnight(todayStr); // Robot starts at midnight
  }
  
  const midnightEnd = getBDEndOfDay(todayStr);
  const totalSecondsInSession = (midnightEnd.getTime() - startTime.getTime()) / 1000;
  
  let elapsedSeconds = (now.getTime() - startTime.getTime()) / 1000;
  if (elapsedSeconds < 0) elapsedSeconds = 0;
  if (elapsedSeconds > totalSecondsInSession) elapsedSeconds = totalSecondsInSession;
  
  return elapsedSeconds;
}

export function calculateInstantCommission(packagePrice) {
  return packagePrice * 0.10; // Offline Direct Partner Level 1 Comm (10%)
}

export function calculateDailyCommission(dailyMiningIncome) {
  return dailyMiningIncome * 0.025; // Inline Active Commission (2.5%)
}

// Universal getDhakaDate helper
export function getDhakaDate(date = new Date()) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Dhaka',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
    const parts = formatter.formatToParts(date);
    const year = parseInt(parts.find(p => p.type === 'year').value, 10);
    const month = parseInt(parts.find(p => p.type === 'month').value, 10) - 1;
    const day = parseInt(parts.find(p => p.type === 'day').value, 10);
    const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
    const minute = parseInt(parts.find(p => p.type === 'minute').value, 10);
    const second = parseInt(parts.find(p => p.type === 'second').value, 10);
    const dDate = new Date(year, month, day, hour, minute, second);
    if (isNaN(dDate.getTime())) throw new Error("Parsed date is NaN");
    return dDate;
  } catch (e) {
    const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
    return new Date(utc + (3600000 * 6)); // Dhaka is UTC+6
  }
}

export function calculateDailySegment(
  dStr,
  pkg,
  myActiveRobots,
  dailyProfit,
  now
) {
  const curMidnight = getBDMidnight(dStr);
  const curEndOfDay = getBDEndOfDay(dStr);
  const pkgExpires = new Date(pkg.expiresAt);

  // If the day starts after the package has expired, zero profit
  if (curMidnight >= pkgExpires) {
    return { elapsedSeconds: 0, startTime: null, endTime: null, isActive: false, isRobotStarted: false };
  }

  // Cap dayEnd at package expiration if it expires during this day
  let dayEnd = curEndOfDay;
  if (pkgExpires < curEndOfDay) {
    dayEnd = pkgExpires;
  }

  // Check if robot was active on this day
  const robot = myActiveRobots && myActiveRobots.find(r => {
    if (r.status !== 'active' || r.isActivated !== true) return false;
    const rExp = r.expiresAt ? new Date(r.expiresAt) : null;
    const rCreated = r.createdAt ? new Date(r.createdAt) : null;
    return rExp && rExp > curMidnight && (!rCreated || rCreated <= curEndOfDay);
  });
  const hasRobot = !!robot;

  let dayStart = null;
  let isRobotStarted = false;

  if (hasRobot) {
    isRobotStarted = true;
    const isPkgFirstDay = getBDDate(new Date(pkg.purchasedAt)) === dStr;
    const isRobotFirstDay = robot && robot.createdAt && (getBDDate(new Date(robot.createdAt)) === dStr);

    if (isPkgFirstDay || isRobotFirstDay) {
      if (pkg.lastMiningStartTime && pkg.lastMiningStartDay === dStr) {
        dayStart = new Date(pkg.lastMiningStartTime);
      } else if (isRobotFirstDay && robot.createdAt) {
        dayStart = new Date(robot.createdAt);
      } else {
        dayStart = new Date(pkg.purchasedAt);
      }
    } else {
      dayStart = curMidnight;
    }
  } else {
    // Manual session
    const isManualStarted = pkg.lastMiningStartDay === dStr && pkg.lastMiningStartTime;
    if (isManualStarted) {
      dayStart = new Date(pkg.lastMiningStartTime);
    } else {
      dayStart = null;
    }
  }

  if (!dayStart) {
    return { elapsedSeconds: 0, startTime: null, endTime: null, isActive: false, isRobotStarted: false };
  }

  if (dayStart < curMidnight) {
    dayStart = curMidnight;
  }
  if (dayStart > dayEnd) {
    return { elapsedSeconds: 0, startTime: dayStart, endTime: dayEnd, isActive: false, isRobotStarted };
  }

  let isActive = false;
  let elapsedMs = 0;

  if (now < dayStart) {
    elapsedMs = 0;
    isActive = false;
  } else if (now >= dayStart && now < dayEnd) {
    elapsedMs = now.getTime() - dayStart.getTime();
    isActive = true;
  } else {
    elapsedMs = dayEnd.getTime() - dayStart.getTime();
    isActive = false;
  }

  const elapsedSeconds = elapsedMs / 1000;
  return {
    elapsedSeconds: elapsedSeconds < 0 ? 0 : elapsedSeconds,
    startTime: dayStart,
    endTime: dayEnd,
    isActive,
    isRobotStarted
  };
}

// Highly elegant package earnings accrual utility
export function calculateAccruedEarnings(pkg, myActiveRobots, now = (window.getSyncedNow ? window.getSyncedNow() : new Date())) {
  const todayStr = getBDDate(now);
  const dailyProfit = Number(pkg.daily || pkg.dailyProfit || 0);
  
  const lastClaimTimeStr = pkg.lastClaimTime || pkg.purchasedAt;
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
  
  // Calculate completed dates from the day after last claim up to yesterday
  let unclaimedCompleted = 0;
  
  try {
    const cur = new Date(getBDMidnight(lastClaimDayStr).getTime());
    cur.setDate(cur.getDate() + 1);
    const yesterdayLimit = new Date(getBDMidnight(todayStr).getTime());
    
    while (cur < yesterdayLimit) {
      const dStr = getBDDate(cur);
      const curEndOfDay = getBDEndOfDay(dStr);
      const segment = calculateDailySegment(dStr, pkg, myActiveRobots, dailyProfit, curEndOfDay);
      unclaimedCompleted += (segment.elapsedSeconds / 86400) * dailyProfit;
      cur.setDate(cur.getDate() + 1);
    }
  } catch (err) {
    console.warn("Calculations for previous days completed with warning:", err);
  }
  
  // Now analyze the current active day (today)
  const segmentToday = calculateDailySegment(todayStr, pkg, myActiveRobots, dailyProfit, now);
  const sessionStartTime = segmentToday.startTime;
  const sessionEndTime = segmentToday.endTime;
  const liveEarnToday = (segmentToday.elapsedSeconds / 86400) * dailyProfit;
  const isActive = segmentToday.isActive;
  const isRobotStarted = segmentToday.isRobotStarted;
  
  let percent = 0;
  if (sessionStartTime && sessionEndTime) {
    const totalSessionMs = sessionEndTime.getTime() - sessionStartTime.getTime();
    const elapsedMs = now.getTime() - sessionStartTime.getTime();
    if (totalSessionMs > 0) {
      percent = (elapsedMs / totalSessionMs) * 100;
      if (percent < 0) percent = 0;
      if (percent > 100) percent = 100;
    }
  }

  let mult = 1;
  if (window.currentUserData && typeof window.currentUserData.earningsMultiplier === 'number' && window.currentUserData.earningsMultiplier > 0) {
    mult = window.currentUserData.earningsMultiplier;
  } else if (pkg && typeof pkg.earningsMultiplier === 'number' && pkg.earningsMultiplier > 0) {
    mult = pkg.earningsMultiplier;
  }

  const unclaimedCompletedMul = Number((unclaimedCompleted * mult).toFixed(2));
  const liveEarnTodayMul = Number((liveEarnToday * mult).toFixed(2));
  const totalClaimable = Number((unclaimedCompletedMul + liveEarnTodayMul).toFixed(2));
  
  const hasClaimedToday = pkg.lastClaimTime ? (getBDDate(new Date(pkg.lastClaimTime)) === todayStr) : false;
  const isSessionOver = sessionEndTime ? (now.getTime() >= sessionEndTime.getTime()) : true;
  const isClaimedToday = hasClaimedToday && (isSessionOver || liveEarnToday === 0);
  
  const activeSession = sessionStartTime ? {
    isActive,
    startTime: sessionStartTime,
    endTime: sessionEndTime,
    elapsedSeconds: sessionStartTime ? (now.getTime() - sessionStartTime.getTime()) / 1000 : 0,
    liveEarnings: liveEarnTodayMul,
    percent: percent > 100 ? 100 : percent,
    maxPotential: dailyProfit,
    isRobotStarted
  } : null;

  return {
    unclaimedCompleted: unclaimedCompletedMul,
    activeSession,
    totalClaimable,
    isClaimedToday
  };
}

// Expose functions globally to window for browser import compatibility
window.getBDDate = getBDDate;
window.getBDMidnight = getBDMidnight;
window.getBDEndOfDay = getBDEndOfDay;
window.calculateProfit = calculateProfit;
window.getActiveSecondsForToday = getActiveSecondsForToday;
window.calculateInstantCommission = calculateInstantCommission;
window.calculateDailyCommission = calculateDailyCommission;
window.getDhakaDate = getDhakaDate;
window.calculateAccruedEarnings = calculateAccruedEarnings;
