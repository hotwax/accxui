import { DateTime } from 'luxon';


// TimeZone format = 04:16 PM EDT
const getCurrentTime = (zone: string, format = 't ZZZZ') => {
  return DateTime.now().setZone(zone).toFormat(format)
}

const handleDateTimeInput = (dateTimeValue: any) => {
  // TODO Handle it in a better way
  // Remove timezone and then convert to timestamp
  // Current date time picker picks browser timezone and there is no supprt to change it
  const dateTime = DateTime.fromISO(dateTimeValue, { setZone: true }).toFormat("yyyy-MM-dd'T'HH:mm:ss")
  return DateTime.fromISO(dateTime).toMillis()
}

const formatDate = (value: any, inFormat?: string, outFormat?: string) => {
  // TODO Make default format configurable and from environment variables
  if (inFormat) {
    return DateTime.fromFormat(value, inFormat).toFormat(outFormat ? outFormat : 'MM-dd-yyyy');
  }
  return DateTime.fromISO(value).toFormat(outFormat ? outFormat : 'MM-dd-yyyy');
}

const formatUtcDate = (value: any, userTimeZone: string, outFormat?: string) => {
  if (!value) return "-";
  let dateTime;
  if (!isNaN(Number(value))) {
    dateTime = DateTime.fromMillis(Number(value), { zone: 'utc' });
  } else {
    dateTime = DateTime.fromISO(value, { zone: 'utc' });
  }
  return dateTime.setZone(userTimeZone).toFormat(outFormat ? outFormat : 'MM-dd-yyyy')
}

const dateOrdinalSuffix = {
  1: 'st',
  21: 'st',
  31: 'st',
  2: 'nd',
  22: 'nd',
  3: 'rd',
  23: 'rd'
} as any

function getDateWithOrdinalSuffix(time: any) {
  if (!time) return "-";
  const dateTime = DateTime.fromMillis(time);
  const suffix = dateOrdinalSuffix[dateTime.day] || "th"
  return `${dateTime.day}${suffix} ${dateTime.toFormat("MMM yyyy")}`;
}

const getTime = (time: any) => {
  // Directly using TIME_SIMPLE for formatting the time results the time always in 24-hour format, as the Intl is set in that way. So, using hourCycle to always get the time in 12-hour format
  // https://github.com/moment/luxon/issues/998
  return time ? DateTime.fromMillis(time).toLocaleString({ ...DateTime.TIME_SIMPLE, hourCycle: "h12" }) : "-";
}

function getDate(runTime: any) {
  return DateTime.fromMillis(runTime).toLocaleString({ ...DateTime.DATE_MED, hourCycle: "h12" });
}

function getDateAndTime(time: any) {
  return time ? DateTime.fromMillis(time).toLocaleString({ ...DateTime.DATETIME_MED, hourCycle: "h12" }) : "-";
}

function getDateAndTimeShort(time: any) {
  // format: hh:mm(localized 12-hour time) date/month
  // Using toLocaleString as toFormat is not converting the time in 12-hour format
  return time ? DateTime.fromMillis(time).toLocaleString({ hour: "numeric", minute: "numeric", day: "numeric", month: "numeric", hourCycle: "h12" }) : "-";
}

function getRelativeTime(endTime: any) {
  const timeDiff = DateTime.fromMillis(endTime).diff(DateTime.local());
  return DateTime.local().plus(timeDiff).toRelative();
}

// Helper to convert date string (YYYY-MM-DD) to ISO start/end of day
const formatDateTime = (dateStr: string, format?: string | null, endOfDay = false) => {
  if (!dateStr) return '';
  const dt = DateTime.fromISO(dateStr);
  const final = endOfDay ? dt.endOf('day') : dt.startOf('day');
  return format ? final.toFormat(format) : final.toFormat("yyyy-MM-dd HH:mm:ss.SSS");
}

/**
 * Parses any date/time value returned by Moqui or OFBiz into a Luxon DateTime.
 * Handles: Luxon DateTime passthrough, epoch milliseconds (number or numeric string),
 * ISO 8601, SQL timestamp, RFC 2822, HTTP date, and common custom format strings.
 * Returns null when the value is empty or cannot be parsed.
 */
const parseDateTimeValue = (value: any): DateTime | null => {
  if (!value) return null
  if (DateTime.isDateTime(value)) return value as DateTime
  if (typeof value === 'number') {
    const dt = DateTime.fromMillis(value)
    return dt.isValid ? dt : null
  }
  if (typeof value !== 'string') return null
  if (/^\d+$/.test(value)) {
    const dt = DateTime.fromMillis(Number(value))
    return dt.isValid ? dt : null
  }
  const norm = value.replace(/^[A-Za-z]{3},\s*/, '')
  const parsers = [
    () => DateTime.fromISO(value),
    () => DateTime.fromSQL(value),
    () => DateTime.fromFormat(value, "yyyy-MM-dd'T'HH:mm:ssZZ"),
    () => DateTime.fromFormat(value, 'yyyy-MM-dd HH:mm:ss.SSS'),
    () => DateTime.fromRFC2822(value),
    () => DateTime.fromHTTP(value),
    () => DateTime.fromFormat(norm, 'dd LLL yyyy HH:mm:ss ZZZ'),
    () => DateTime.fromFormat(norm, 'dd LLL yyyy HH:mm:ss z'),
  ]
  for (const parse of parsers) {
    const dt = parse()
    if (dt.isValid) return dt
  }
  return null
}

/**
 * General-purpose display formatter. Parses any date/time value with
 * parseDateTimeValue and formats it for display. Default output is
 * DateTime.DATETIME_MED locale string (e.g. "Jun 4, 2026, 10:30 AM").
 * Named formatDateTimeValue to distinguish from the existing formatDateTime
 * which is an ISO date-range helper with a different signature.
 */
const formatDateTimeValue = (value: any, format?: string): string => {
  if (!value) return ''
  const dt = parseDateTimeValue(value)
  if (!dt) return ''
  return format ? dt.toFormat(format) : dt.toLocaleString(DateTime.DATETIME_MED)
}

function getDateTimeWithOrdinalSuffix(time: any) {
  if (!time) return "-";
  const dateTime = DateTime.fromMillis(time);
  const suffix = dateOrdinalSuffix[dateTime.day] || "th";
  return `${dateTime.toFormat("h:mm a d")}${suffix} ${dateTime.toFormat("MMM yyyy")}`;
}
export { formatDate, formatDateTime, formatDateTimeValue, parseDateTimeValue, formatUtcDate, getCurrentTime, getDate, getDateAndTime, getDateAndTimeShort, getDateTimeWithOrdinalSuffix, getDateWithOrdinalSuffix, getRelativeTime, getTime, handleDateTimeInput };
