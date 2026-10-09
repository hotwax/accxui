import { CronExpressionParser as cronParser } from 'cron-parser';
import cronstrue from 'cronstrue';
import { getDateAndTime } from './date';


function getCronString(cronExpression: any) {
  try {
    return cronstrue.toString(cronExpression)
  } catch (e) {
    console.info(e)
    return ""
  }
}

function parseCronExpression(cronExpression: any, timeZone?: string) {
  return cronParser.parse(cronExpression, timeZone ? { tz: timeZone } : {})
}

function getNextExecutionTime(cronExpression: any, timeZone?: string) {
  const interval = parseCronExpression(cronExpression, timeZone)
  return getDateAndTime(interval.next().getTime())
}
export { getCronString, getNextExecutionTime, parseCronExpression };
