import { toastController } from "@ionic/vue";
import { DateTime } from "luxon";
import { cookieHelper } from "../helpers/cookieHelper";
import { translate } from "../core/i18n";
// Capacitor Plugins import removed for compatibility
import { saveAs } from 'file-saver';
import Papa from 'papaparse';
import Encoding from 'encoding-japanese';
import cronParser from "cron-parser";
import cronstrue from "cronstrue"
import { useEmbeddedAppStore } from "../store/embeddedApp";

export interface JsonToCsvOption {
  parse?: object | null;
  encode?: object | null;
  name?: string;
  download?: boolean;
}

const goToOms = () => {
  const oms = getOmsURL()!
  const token = getMaargURL()!
  const link = (oms.startsWith('http') ? oms.replace(/\/api\/?|\/$/, "") : `https://${oms}.hotwax.io`) + `/commerce/control/main?token=${token}`

  window.open(link, '_blank', 'noopener, noreferrer')
}

const showToast = async (
  message: string,
  options?: {
    position?: string;
    manualDismiss?: boolean;
    canDismiss?: boolean;
    buttons?: any[];
    icon?: string;
  }
) => {

  const config: any = {
    message,
    position: options?.position ?? 'bottom',
    duration: options?.manualDismiss ? undefined : 3000
  };

  if (options?.icon) {
    config.icon = options.icon;
  }

  const defaultButtons = [];

  if (options?.canDismiss) {
    defaultButtons.push({
      text: translate('Dismiss'),
      role: 'cancel'
    });
  }

  if (options?.buttons?.length) {
    defaultButtons.push(...options.buttons);
  }

  if (defaultButtons.length) {
    config.buttons = defaultButtons;
  }

  const toast = await toastController.create(config);

  // Present automatically unless manual dismiss is required
  return options?.manualDismiss ? toast : toast.present();
};

// TimeZone format = 04:16 PM EDT
const getCurrentTime = (zone: string, format = 't ZZZZ') => {
  return DateTime.now().setZone(zone).toFormat(format)
}

const hasPermission = (permissionId: string) => {
  //TODO: write the logic
  return true
}

function hasError(response: any): boolean {
  const data = response?.data ?? response;
  if (!data || typeof data !== 'object') return false;
  if (typeof data._ERROR_MESSAGE_ === 'string' && data._ERROR_MESSAGE_.length) {
    return true;
  }
  if (
    Array.isArray(data._ERROR_MESSAGE_LIST_) &&
    data._ERROR_MESSAGE_LIST_.length > 0
  ) {
    return true;
  }
  if (data.error) {
    return true;
  }
  return false;
}

function isError(response: any): boolean {
  return response.code === 'error'
}

function getTelecomCountryCode(code: string) {
  return telecomCode[code]
}

function jsonParse(value: any): any {
  let parsedValue;
  try {
    parsedValue = JSON.parse(value);
  } catch (e) {
    parsedValue = value;
  }
  return parsedValue;
}

// Currently, we are utilizing a TypeScript file for storing country codes
// due to encountering declaration errors when using a JSON file format.
// TODO: We acknowledge the need to explore this issue further in the future to determine the root cause and find a suitable solution.
const telecomCode = {
  "AF": "+93",
  "AX": "+358",
  "AL": "+355",
  "DZ": "+213",
  "AS": "+1684",
  "AD": "+376",
  "AO": "+244",
  "AI": "+1264",
  "AQ": "+672",
  "AG": "+1268",
  "AR": "+54",
  "AM": "+374",
  "AW": "+297",
  "AU": "+61",
  "AT": "+43",
  "AZ": "+994",
  "BS": "+1242",
  "BH": "+973",
  "BD": "+880",
  "BB": "+1246",
  "BY": "+375",
  "BE": "+32",
  "BZ": "+501",
  "BJ": "+229",
  "BM": "+1441",
  "BT": "+975",
  "BO": "+591",
  "BA": "+387",
  "BW": "+267",
  "BR": "+55",
  "IO": "+246",
  "BN": "+673",
  "BG": "+359",
  "BF": "+226",
  "BI": "+257",
  "KH": "+855",
  "CM": "+237",
  "CA": "+1",
  "CV": "+238",
  "KY": "+ 345",
  "CF": "+236",
  "TD": "+235",
  "CL": "+56",
  "CN": "+86",
  "CX": "+61",
  "CC": "+61",
  "CO": "+57",
  "KM": "+269",
  "CG": "+242",
  "CD": "+243",
  "CK": "+682",
  "CR": "+506",
  "CI": "+225",
  "HR": "+385",
  "CU": "+53",
  "CY": "+357",
  "CZ": "+420",
  "DK": "+45",
  "DJ": "+253",
  "DM": "+1767",
  "DO": "+1849",
  "EC": "+593",
  "EG": "+20",
  "SV": "+503",
  "GQ": "+240",
  "ER": "+291",
  "EE": "+372",
  "ET": "+251",
  "FK": "+500",
  "FO": "+298",
  "FJ": "+679",
  "FI": "+358",
  "FR": "+33",
  "GF": "+594",
  "PF": "+689",
  "GA": "+241",
  "GM": "+220",
  "GE": "+995",
  "DE": "+49",
  "GH": "+233",
  "GI": "+350",
  "GR": "+30",
  "GL": "+299",
  "GD": "+1473",
  "GP": "+590",
  "GU": "+1671",
  "GT": "+502",
  "GG": "+44",
  "GN": "+224",
  "GW": "+245",
  "GY": "+595",
  "HT": "+509",
  "HN": "+504",
  "HK": "+852",
  "HU": "+36",
  "IS": "+354",
  "IN": "+91",
  "ID": "+62",
  "IR": "+98",
  "IQ": "+964",
  "IE": "+353",
  "IM": "+44",
  "IL": "+972",
  "IT": "+39",
  "JM": "+1876",
  "JP": "+81",
  "JE": "+44",
  "JO": "+962",
  "KZ": "+77",
  "KE": "+254",
  "KI": "+686",
  "KP": "+850",
  "KR": "+82",
  "KW": "+965",
  "KG": "+996",
  "LA": "+856",
  "LV": "+371",
  "LB": "+961",
  "LS": "+266",
  "LR": "+231",
  "LY": "+218",
  "LI": "+423",
  "LT": "+370",
  "LU": "+352",
  "MO": "+853",
  "MK": "+389",
  "MG": "+261",
  "MW": "+265",
  "MY": "+60",
  "MV": "+960",
  "ML": "+223",
  "MT": "+356",
  "MH": "+692",
  "MQ": "+596",
  "MR": "+222",
  "MU": "+230",
  "YT": "+262",
  "MX": "+52",
  "FM": "+691",
  "MD": "+373",
  "MC": "+377",
  "MN": "+976",
  "ME": "+382",
  "MS": "+1664",
  "MA": "+212",
  "MZ": "+258",
  "MM": "+95",
  "NA": "+264",
  "NR": "+674",
  "NP": "+977",
  "NL": "+31",
  "AN": "+599",
  "NC": "+687",
  "NZ": "+64",
  "NI": "+505",
  "NE": "+227",
  "NG": "+234",
  "NU": "+683",
  "NF": "+672",
  "MP": "+1670",
  "NO": "+47",
  "OM": "+968",
  "PK": "+92",
  "PW": "+680",
  "PS": "+970",
  "PA": "+507",
  "PG": "+675",
  "PY": "+595",
  "PE": "+51",
  "PH": "+63",
  "PN": "+872",
  "PL": "+48",
  "PT": "+351",
  "PR": "+1939",
  "QA": "+974",
  "RO": "+40",
  "RU": "+7",
  "RW": "+250",
  "RE": "+262",
  "BL": "+590",
  "SH": "+290",
  "KN": "+1869",
  "LC": "+1758",
  "MF": "+590",
  "PM": "+508",
  "VC": "+1784",
  "WS": "+685",
  "SM": "+378",
  "ST": "+239",
  "SA": "+966",
  "SN": "+221",
  "RS": "+381",
  "SC": "+248",
  "SL": "+232",
  "SG": "+65",
  "SK": "+421",
  "SI": "+386",
  "SB": "+677",
  "SO": "+252",
  "ZA": "+27",
  "SS": "+211",
  "GS": "+500",
  "ES": "+34",
  "LK": "+94",
  "SD": "+249",
  "SR": "+597",
  "SJ": "+47",
  "SZ": "+268",
  "SE": "+46",
  "CH": "+41",
  "SY": "+963",
  "TW": "+886",
  "TJ": "+992",
  "TZ": "+255",
  "TH": "+66",
  "TG": "+228",
  "TK": "+690",
  "TO": "+676",
  "TT": "+1-868",
  "TN": "+216",
  "TR": "+90",
  "TM": "+993",
  "TC": "+1-649",
  "TV": "+688",
  "VI": "+1-340",
  "UG": "+256",
  "UA": "+380",
  "AE": "+971",
  "GB": "+44",
  "US": "+1",
  "UY": "+598",
  "UZ": "+998",
  "VU": "+678",
  "VA": "+379",
  "VE": "+58",
  "VN": "+84",
  "WF": "+681",
  "EH": "+212",
  "YE": "+967",
  "ZM": "+260",
  "ZW": "+263"
} as any;

const getMaargURL = () => {
  const maarg = useEmbeddedAppStore().maarg || cookieHelper().get("maarg")
  let maargURL = ""
  if (maarg) {
    maargURL = maarg.startsWith('http') ? maarg.includes('/rest/s1') ? maarg : `${maarg}/rest/s1/` : `https://${maarg}.hotwax.io/rest/s1/`;
  }
  return maargURL
}

const getMaargBaseURL = () => {
  return useEmbeddedAppStore().maarg ||  cookieHelper().get("maarg")
}

const getOmsURL = () => {
  const oms = useEmbeddedAppStore().oms || cookieHelper().get("oms")
  let omsURL = ""
  if (oms) {
    omsURL = oms.startsWith('http') ? oms.includes('/api') ? oms : `${oms}/api/` : `https://${oms}.hotwax.io/api/`
  }
  return omsURL;
}

const getToken = () => {
  return useEmbeddedAppStore().token.value || cookieHelper().get("token")
}

const getTokenExpiration = () => {
  return useEmbeddedAppStore().token.expiration || cookieHelper().get("expirationTime")
}

const isAppEmbedded = () => {
  return !!useEmbeddedAppStore().shopifyAppBridge
}

const getStatusColor = (statusId: string) => {
  const statusColor = {
    "DmlsCancelled": "danger",
    "DmlsCrashed": "danger",
    "DmlsFailed": "danger",
    "DmlsFinished": "success",
    "DmlsPending": "light",
    "DmlsQueued": "primary",
    "DmlsRunning": "medium",
    "CYCLE_CNT_CREATED": "medium",
    "CYCLE_CNT_IN_PRGS": "primary",
    "SmsgSending": "medium",
    "SmsgSent": "success",
    "SmsgError": "danger"
  } as Record<string, string>

  return statusColor[statusId] || "primary"
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
  // TODO Make default format configurable and from environment variables
  // TODO Fix this setDefault should set the default timezone instead of getting it everytiem and setting the tz
  return DateTime.fromISO(value, { zone: 'utc' }).setZone(userTimeZone).toFormat(outFormat ? outFormat : 'MM-dd-yyyy')
}

const getFeatures = (productFeatures: any) => {
  const features = productFeatures
    ?.sort((firstFeature: string, secondFeature: string) => firstFeature.split('/')[0].localeCompare(secondFeature.split('/')[0]))
    ?.map((feature: string) => feature.substring(feature.indexOf("/") + 1)) // Not using split method as we may have features with value as `Size/N/S` and thus the only value returned is N when accessing 1st index considering that 1st index will have actual feature value, so we need to have some additional handling in case of split method
    ?.join(' ');
  return features || "";
}

const getFeature = (featureHierarchy: any, featureKey: string) => {
  let featureValue = ''
  if (featureHierarchy) {
    const feature = featureHierarchy.find((featureItem: any) => featureItem.startsWith(featureKey))
    const featureSplit = feature ? feature.split('/') : [];
    featureValue = featureSplit[2] ? featureSplit[2] : '';
  }
  return featureValue;
}

const downloadCsv = (csv: any, fileName: any) => {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  saveAs(blob, fileName ? fileName : "default.csv");
  return blob;
};

const jsonToCsv = (file: any, options: JsonToCsvOption = {}) => {
  const csv = Papa.unparse(file, {
    ...options.parse
  });
  const encoding = {
    type: String,
    default: "utf-8",
    ...options.encode
  } as any;

  let buffer: Uint8Array;
  let blob: Blob;
  if (encoding.default === 'shift-jis') {
    buffer = new Uint8Array(Encoding.convert(Encoding.stringToCode(csv), 'SJIS'));
    blob = new Blob([buffer as any], { type: `application/csv;charset=${encoding.default}` });

  } else {
    blob = new Blob([csv], { type: `application/csv;charset=${encoding.default}` });
  }

  if (options.download) {
    saveAs(blob, options.name ? options.name : "default.csv");
  }
  return blob;
}

const copyToClipboard = async (value: string, text?: string) => {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(value).then(() => {
      text ? showToast(translate(text)) : showToast(translate("Copied", { value }));
    }).catch((err) => {
      console.error("Failed to copy text: ", err);
    });
  } else {
    showToast(translate("Clipboard not available"));
  }
}

const getIdentificationId = (identifications: any, id: string) => {
  let externalId = ''
  if (identifications) {
    const externalIdentification = identifications.find((identification: any) => identification.startsWith(id))
    const externalIdentificationSplit = externalIdentification ? externalIdentification.split('/') : [];
    externalId = externalIdentificationSplit[1] ? externalIdentificationSplit[1] : '';
  }
  return externalId;
}

const formatPhoneNumber = (countryCode: string | null, areaCode: string | null, contactNumber: string | null) => {
  if (countryCode && areaCode) {
    return `+${countryCode}-${areaCode}-${contactNumber}`;
  } else if (countryCode) {
    return `+${countryCode}-${contactNumber}`;
  } else {
    return contactNumber;
  }
}


const generateInternalId = (name: string) => {
  return name.trim().toUpperCase().split(' ').join('_');
}

const sortItems = (items: any, sortByField: any) => {
  items.sort((firstMethod: any, secondMethod: any) => {
    if (firstMethod[sortByField] === null && secondMethod[sortByField] !== null) {
      return 1;
    } else if (firstMethod[sortByField] !== null && secondMethod[sortByField] === null) {
      return -1;
    } else {
      return firstMethod[sortByField] - secondMethod[sortByField];
    }
  });
}

const isValidDeliveryDays = (deliveryDays: any) => {
  // Regular expression pattern for a valid delivery days
  // Allow only positive integers (no decimals, no zero, no negative)
  const delieveryDaysPattern = /^(0*[1-9]\d*)$/;
  return delieveryDaysPattern.test(deliveryDays);
}

const isValidCarrierCode = (trackingCode: any) => {
  // Regular expression pattern for a valid tracking code
  const trackingCodePattern = /^[a-zA-Z0-9]*$/;
  return trackingCodePattern.test(trackingCode);
}

const isPdf = (url: any) => {
  const pdfUrlPattern = /\.pdf(\?.*)?$/;
  return url && pdfUrlPattern.test(url.toLowerCase());
}

const currentSymbol: any = {
  "USD": "$",
  "EUR": "€",
  "JPY": "¥"
}

const formatCurrency = (amount: any, code: string) => {
  return `${currentSymbol[code] || code || "$"}${amount || 0}`
}

const getColorByDesc = (desc: string) => ({
  "Approved": "primary",
  "Authorized": "medium",
  "Cancellation Requested": "medium",
  "Cancelled": "danger",
  "Completed": "success",
  "Created": "medium",
  "default": "medium",
  "Declined": "danger",
  "Expired": "warning",
  "Held": "warning",
  "Hold": "warning",
  "Not-Authorized": "warning",
  "Not-Received": "warning",
  "Pending": "warning",
  "Picked up": "success",
  "Picking": "dark",
  "Ready for pickup": "primary",
  "Received": "success",
  "Refunded": "success",
  "Rejected": "warning",
  "Reserved": "medium",
  "Settled": "success",
} as any)[desc]

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

const hasWebcamAccess = async () => {
  try {
    await navigator.mediaDevices.getUserMedia({ video: true });
    return true;
  } catch {
    return false;
  }
}


const parseCsv = async (file: File, options?: any) => {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: function (results: any) {
        if (results.errors.length) {
          reject(results.error)
        } else {
          resolve(results.data)
        }
      },
      ...options
    });
  })
}

/**
 * Returns true if the query object contains any active filters, excluding specified fields; 
 * add future fields to `excludedFields` to ignore them in the check.
 */
const hasActiveFilters = (query: any): boolean => {
  const excludedFields = ["viewSize", "viewIndex", "queryString", "hideLoader"];
  return Object.keys(query).some((key: string) =>
    !excludedFields.includes(key) && (Array.isArray(query[key]) ? query[key].length : query[key].trim())
  );
}

const parseBooleanSetting = (value: any): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value !== "string") return false;

  const normalizedValue = value.trim().toLowerCase();
  if (["true", "1", "y", "yes"].includes(normalizedValue)) return true;
  if (["false", "0", "n", "no", ""].includes(normalizedValue)) return false;

  try {
    return parseBooleanSetting(JSON.parse(value));
  } catch {
    return false;
  }
}

const getProductIdentificationValue = (productIdentifier: string, product: any) => {
  // handled this case as on page load initially the data is not available, so not to execute furthur code
  // untill product is not available
  if (!Object.keys(product).length) {
    return;
  }

  let value = product[productIdentifier]

  // considered that the goodIdentification will always have values in the format "productIdentifier/value" and there will be no entry like "productIdentifier/"
  const identification = product['goodIdentifications']?.find((identification: string) => identification.startsWith(productIdentifier + "/"))

  if (identification) {
    const goodIdentification = identification.split('/')
    value = goodIdentification[1]
  }

  return value;
}

const getOMSInstanceName = () => {
  const instanceUrl = getOmsURL();
  const hostname = instanceUrl.replace(/^(https?:\/\/)/, "").replace(/\/.*/, "").replace(/:.*/, "");             
  return hostname.split(".")[0];
};

const sortSequence = (sequence: Array<any>, sortOnField = "sequenceNum") => {
  // Currently, sorting is only performed on a single parameter, so if two sequence have same value for that parameter then they will be arranged in FCFS basis
  // TODO: Need to check that if for the above case we need to define the sorting on name as well, when previous param is same
  return sequence.sort((a: any, b: any) => {
    if(a[sortOnField] === b[sortOnField]) return 0;

    // Sort undefined values at last
    if(a[sortOnField] == undefined) return 1;
    if(b[sortOnField] == undefined) return -1;

    return a[sortOnField] - b[sortOnField]
  })
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

function getCronString(cronExpression: any) {
  try {
    return cronstrue.toString(cronExpression)
  } catch(e) {
    console.info(e)
    return ""
  }
}

function parseCronExpression(cronExpression: any, timeZone?: string) {
  return cronParser.parseExpression(cronExpression, timeZone ? { tz: timeZone } : {})
}

// Helper to convert date string (YYYY-MM-DD) to ISO start/end of day
const formatDateTime = (dateStr: string, format?: string | null, endOfDay = false) => {
  if (!dateStr) return '';
  const dt = DateTime.fromISO(dateStr);
  const final = endOfDay ? dt.endOf('day') : dt.startOf('day');
  return format ? final.toFormat(format) : final.toFormat("yyyy-MM-dd HH:mm:ss.SSS");
}

function getDateTimeWithOrdinalSuffix(time: any) {
  if (!time) return "-";
  const dateTime = DateTime.fromMillis(time);
  const suffix = dateOrdinalSuffix[dateTime.day] || "th";
  return `${dateTime.toFormat("h:mm a d")}${suffix} ${dateTime.toFormat("MMM yyyy")}`;
}

const getFacilityChipLabel = (selectedFacilityIds: string[], facilities: any[]): string => {
  if (selectedFacilityIds.length === 0) {
    return translate('All');
  } else if (selectedFacilityIds.length === 1) {
    const facility = facilities.find((f: any) => f.facilityId === selectedFacilityIds[0]);
    return facility?.facilityName || selectedFacilityIds[0];
  } else {
    return `${selectedFacilityIds.length} ${translate('facilities')}`;
  }
};

export const commonUtil = {
  isAppEmbedded,
  copyToClipboard,
  downloadCsv,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatPhoneNumber,
  formatUtcDate,
  generateInternalId,
  getColorByDesc,
  getCurrentTime,
  getCronString,
  getDate,
  getDateAndTime,
  getDateAndTimeShort,
  getDateTimeWithOrdinalSuffix,
  getDateWithOrdinalSuffix,
  getFacilityChipLabel,
  getFeature,
  getFeatures,
  getIdentificationId,
  getMaargBaseURL,
  getMaargURL,
  getOMSInstanceName,
  getOmsURL,
  getProductIdentificationValue,
  getRelativeTime,
  getStatusColor,
  getTelecomCountryCode,
  getTime,
  getToken,
  getTokenExpiration,
  goToOms,
  handleDateTimeInput,
  hasActiveFilters,
  hasError,
  hasWebcamAccess,
  isError,
  isPdf,
  isValidCarrierCode,
  isValidDeliveryDays,
  jsonParse,
  jsonToCsv,
  parseBooleanSetting,
  parseCronExpression,
  parseCsv,
  showToast,
  sortItems,
  sortSequence
}