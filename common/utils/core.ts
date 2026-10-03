import { toastController } from '@ionic/vue';
import { cookieHelper } from '../helpers/cookieHelper';
import { translate } from '../core/i18n';
import { useEmbeddedAppStore } from '../store/embeddedApp';


const getEmbeddedAppStoreSafe = () => {
  try {
    return useEmbeddedAppStore();
  } catch (e) {
    return {} as any;
  }
}

const goToOms = () => {
  const oms = getOmsURL()!
  const token = getToken()!
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
  const maarg = getEmbeddedAppStoreSafe().maarg || cookieHelper().get("maarg")
  let maargURL = ""
  if (maarg) {
    maargURL = maarg.startsWith('http') ? maarg.includes('/rest/s1') ? maarg : `${maarg}/rest/s1/` : `https://${maarg}.hotwax.io/rest/s1/`;
  }
  return maargURL
}

const getMaargBaseURL = () => {
  return getEmbeddedAppStoreSafe().maarg || cookieHelper().get("maarg")
}

const getOmsURL = (isMoquiOnly = isMoqui()) => {
  const oms = getEmbeddedAppStoreSafe().oms || cookieHelper().get("oms")
  // VITE_OMS_TYPE=MOQUI → use Moqui REST paths (/rest/s1/)
  // VITE_OMS_TYPE unset  → use OFBiz paths (/api/)  [default, backward-compatible]
  let omsURL = ""
  if (oms) {
    const trimmedOms = oms.trim()
    if (trimmedOms.startsWith('http')) {
      const cleanOms = trimmedOms.replace(/\/+$/, '')
      // Full URL provided — use as-is if it already has a known path suffix
      omsURL = (trimmedOms.includes('/api') || trimmedOms.includes('/rest/'))
        ? trimmedOms
        : isMoquiOnly ? `${cleanOms}/rest/s1/` : `${cleanOms}/api/`
    } else {
      // Plain subdomain — build full URL for the configured backend type
      omsURL = isMoquiOnly
        ? `https://${trimmedOms}.hotwax.io/rest/s1/`
        : `https://${trimmedOms}.hotwax.io/api/`
    }
    if (omsURL && !omsURL.endsWith('/')) omsURL += '/'
  }
  return omsURL;
}

const getToken = () => {
  return getEmbeddedAppStoreSafe().getToken || cookieHelper().get("token")
}

const getTokenExpiration = () => {
  return getEmbeddedAppStoreSafe().getTokenExpiration || cookieHelper().get("expirationTime")
}

const isAppEmbedded = () => {
  return !!getEmbeddedAppStoreSafe().shopifyAppBridge
}

const statusColor = {
  // DMLS
  "DmlsCancelled": "danger",
  "DmlsCrashed": "danger",
  "DmlsFailed": "danger",
  "DmlsFinished": "success",
  "DmlsPending": "light",
  "DmlsQueued": "primary",
  "DmlsRunning": "medium",
  // SMSG
  "SmsgConsumed": "success",
  "SmsgConfirmed": "success",
  "SmsgProduced": "primary",
  "SmsgReceived": "primary",
  "SmsgSending": "primary",
  "SmsgSent": "primary",
  "SmsgConsuming": "primary",
  "SmsgRejected": "warning",
  "SmsgError": "danger",
  "SmsgCancelled": "medium",
  // ITEM
  "ITEM_CREATED": "medium",
  "ITEM_APPROVED": "primary",
  "ITEM_PENDING_FULFILL": "warning",
  "ITEM_PENDING_RECEIPT": "warning",
  "ITEM_REQ_CANCELATN": "warning",
  "ITEM_REJECTED": "danger",
  "ITEM_CANCELLED": "danger",
  "ITEM_COMPLETED": "success",
  // PAYMENT
  "PAYMENT_AUTHORIZED": "medium",
  "PAYMENT_NOT_AUTH": "warning",
  "PAYMENT_NOT_RECEIVED": "warning",
  "PAYMENT_CANCELLED": "danger",
  "PAYMENT_DECLINED": "danger",
  "PAYMENT_RECEIVED": "success",
  "PAYMENT_REFUNDED": "success",
  "PAYMENT_SETTLED": "success",
  // ORDER
  "ORDER_CREATED": "medium",
  "ORDER_APPROVED": "primary",
  "ORDER_HOLD": "warning",
  "ORDER_CANCELLED": "danger",
  "ORDER_REJECTED": "danger",
  "ORDER_COMPLETED": "success",
  // SHIPMENT
  "SHIPMENT_INPUT": "medium",
  "SHIPMENT_APPROVED": "primary",
  "SHIPMENT_PACKED": "secondary",
  "SHIPMENT_CANCELLED": "danger",
  "SHIPMENT_SHIPPED": "success",
  // CYCLE COUNT
  "CYCLE_CNT_CREATED": "medium",
  "CYCLE_CNT_IN_PRGS": "primary",
  // JOB RUNS
  "FAILED": "danger",
  "RUNNING": "warning",
  "SUCCESSFUL": "success"
} as Record<string, string>

const getStatusColor = (statusId: string) => {
  return statusColor[statusId] || "medium"
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

const isValidEmail = (email: string) => {
  const emailPattern = /^[A-Za-z0-9._%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,4}$/;
  return emailPattern.test(email);
}

const isValidPassword = (password: string) => {
  const passwordPattern = /^.*(?=.{5,})(?=.*[a-zA-Z])(?=.*[0-9])(?=.*[!@#$%^&*]).*$/;
  return passwordPattern.test(password);
}

// Matches semver with optional -prerelease and +build metadata,
// plus an optional leading "v"/"V" prefix (e.g. "v1.2.3-rc.1+build.5").
const SEMANTIC_VERSION_PATTERN = /^[vV]?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

// Checks whether the passed value is a valid semver string.
const isValidVersion = (value: any): boolean => {
  return typeof value === "string" && SEMANTIC_VERSION_PATTERN.test(value.trim());
}

// Checks whether currentVersion is greater than or equal to the requiredVersion,
// Any -prerelease / +build metadata is stripped and ignored, so 1.0.0 and 1.0.0-rc.1 compare as equal.
const isVersionGreaterOrEqual = (requiredVersion: string, currentVersion: string): boolean => {
  // If no compatibility requirement is configured or current version is not available or invalid
  // (assuming that the server is on some branch), allow access by default
  if (!isValidVersion(requiredVersion) || !isValidVersion(currentVersion)) return true;
  const parse = (version: string) => version.trim().replace(/^[vV]/, "").split(/[-+]/)[0].split(".").map(Number);
  const [requiredMajor, requiredMinor, requiredPatch] = parse(requiredVersion);
  const [currentMajor, currentMinor, currentPatch] = parse(currentVersion);
  if (currentMajor !== requiredMajor) return currentMajor > requiredMajor;
  if (currentMinor !== requiredMinor) return currentMinor > requiredMinor;
  return currentPatch >= requiredPatch;
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
  const symbol = currentSymbol[code] || code || ""
  return `${symbol}${amount != null ? Number(amount).toFixed(2) : '0.00'}`
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

const hasWebcamAccess = async () => {
  try {
    await navigator.mediaDevices.getUserMedia({ video: true });
    return true;
  } catch {
    return false;
  }
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

const getOMSInstanceName = () => {
  const instanceUrl = getOmsURL();
  const hostname = instanceUrl.replace(/^(https?:\/\/)/, "").replace(/\/.*/, "").replace(/:.*/, "");
  return hostname.split(".")[0];
};

const sortSequence = (sequence: Array<any>, sortOnField = "sequenceNum") => {
  // Currently, sorting is only performed on a single parameter, so if two sequence have same value for that parameter then they will be arranged in FCFS basis
  // TODO: Need to check that if for the above case we need to define the sorting on name as well, when previous param is same
  return sequence.sort((a: any, b: any) => {
    if (a[sortOnField] === b[sortOnField]) return 0;

    // Sort undefined values at last
    if (a[sortOnField] == undefined) return 1;
    if (b[sortOnField] == undefined) return -1;

    return a[sortOnField] - b[sortOnField]
  })
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

const isMoqui = () => {
  return import.meta.env.VITE_OMS_TYPE === "MOQUI"
}

function dedupeFacilities(facilities: any[]) {
  const dedupedFacilities = new Map<string, any>();
  facilities.forEach((facility: any) => {
    if (facility?.facilityId && !dedupedFacilities.has(facility.facilityId)) dedupedFacilities.set(facility.facilityId, facility);
  });
  return Array.from(dedupedFacilities.values()).sort((a, b) => (a.facilityName || a.facilityId).localeCompare(b.facilityName || b.facilityId));
}
export { isAppEmbedded, isMoqui, copyToClipboard, dedupeFacilities, formatCurrency, formatPhoneNumber, generateInternalId, getColorByDesc, getFacilityChipLabel, getMaargBaseURL, getMaargURL, getOMSInstanceName, getOmsURL, getStatusColor, getTelecomCountryCode, getToken, getTokenExpiration, goToOms, hasActiveFilters, hasError, hasWebcamAccess, isError, isPdf, isValidCarrierCode, isValidDeliveryDays, isValidEmail, isValidPassword, isValidVersion, isVersionGreaterOrEqual, jsonParse, parseBooleanSetting, showToast, sortSequence };
