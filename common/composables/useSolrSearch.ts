import { commonUtil } from "../utils/commonUtil";
import api from "../core/remoteApi"

const prepareOrderQuery = (params: any) => {
  const viewSize = params.viewSize ? params.viewSize : import.meta.env.VITE_VIEW_SIZE;
  const viewIndex = params.viewIndex ? params.viewIndex : 0;

  const payload = {
    "json": {
      "params": {
        "rows": viewSize,
        "sort": params.sort ? params.sort : "reservedDatetime asc",
        "group": true,
        "group.field": params.groupBy ? params.groupBy : "orderId",
        "group.limit": 1000,
        "group.ngroups": true,
        "q.op": "AND",
        "start": viewIndex * viewSize
      },
      "query": "(*:*)",
      "filter": [`docType: ${params.docType ? params.docType : 'OISGIR'}`]
    }
  } as any

  if (params.queryString) {
    payload.json.query = `(*${params.queryString}*) OR "${params.queryString}"^100`
    payload.json.params['qf'] = params.queryFields ? params.queryFields : "productId productName virtualProductName orderId productSku customerId customerName search_orderIdentifications goodIdentifications"
    payload.json.params['defType'] = "edismax"
  }

  // checking that if the params has filters, and then adding the filter values in the payload filter
  // for each key present in the params filters
  if (params.filters) {
    Object.keys(params.filters).map((key: any) => {
      const filterValue = params.filters[key].value;

      if (Array.isArray(filterValue)) {
        const filterOperator = params.filters[key].op ? params.filters[key].op : 'OR';
        payload.json.filter += ` AND ${key}: (${filterValue.join(' ' + filterOperator + ' ')})`
      } else {
        payload.json.filter += ` AND ${key}: ${filterValue}`
      }
    })
  }

  if (params.facet) {
    payload.json['facet'] = params.facet
  }

  return payload
}

const prepareSolrQuery = (params: any) => {
  const viewSize = params.viewSize ? params.viewSize : import.meta.env.VITE_VIEW_SIZE;
  const viewIndex = params.viewIndex ? params.viewIndex : 0;
  let groupParams = {} as any;

  if (params.isGroupingRequired) {
    groupParams = {
      "group": true,
      "group.field": params.groupBy ? params.groupBy : "orderId",
      "group.limit": params.groupLimit ? params.groupLimit : 1000,
      "group.ngroups": true,
    }
  }

  const payload = {
    "json": {
      "params": {
        "rows": viewSize,
        "sort": params.sort ? params.sort : "reservedDatetime asc",
        "q.op": "AND",
        "start": viewIndex * viewSize,
        ...groupParams
      },
      "query": "(*:*)",
      "filter": [`docType: ${params.docType ? params.docType : 'OISGIR'}`]
    }
  } as any

  // Default coreName is "enterpriseSearch"
  if (params.coreName) payload["coreName"] = params.coreName;

  if (params.queryString) {
    payload.json.query = `(*${params.queryString}*) OR "${params.queryString}"^100`
    payload.json.params['qf'] = params.queryFields ? params.queryFields : "productId productName virtualProductName orderId productSku customerId customerName search_orderIdentifications goodIdentifications"
    payload.json.params['defType'] = "edismax"
  }

  if (params.fieldsToSelect) {
    payload.json.params['fl'] = params.fieldsToSelect
  }

  // checking that if the params has filters, and then adding the filter values in the payload filter
  // for each key present in the params filters
  if (params.filters) {
    Object.keys(params.filters).map((key: any) => {
      const filterValue = params.filters[key].value;

      if (Array.isArray(filterValue)) {
        const filterOperator = params.filters[key].op ? params.filters[key].op : 'OR';
        payload.json.filter += ` AND ${key}: (${filterValue.join(' ' + filterOperator + ' ')})`
      } else {
        payload.json.filter += ` AND ${key}: ${filterValue}`
      }
    })
  }
  //adding solrFilters to pass solr filter strings directly
  if (params.solrFilters) {
    params.solrFilters.forEach((solrFilterString: any) => {
      payload.json.filter += ` AND ${solrFilterString}`
    })
  }

  if (params.facet) {
    payload.json['facet'] = params.facet
  }

  return payload
}

const escapeSolrSpecialChars = (input: any) => {
  const specialChars = ['\\', '+', '-', '&&', '||', '!', '(', ')', '{', '}', '[', ']', '^', '"', '~', '*', '?', ':'];

  // Escape each special character in the input
  const escapedInput = String(input).replace(new RegExp(`[${specialChars.join('\\')}]`, 'g'), '\\$&');
  return escapedInput;
}

const prepareOrderLookupQuery = (query: any) => {
  const viewSize = query.viewSize ? query.viewSize : import.meta.env.VITE_VIEW_SIZE;
  const viewIndex = query.viewIndex ? query.viewIndex : 0;

  const payload = {
    "json": {
      "params": {
        "sort": `${query.sort}`,
        "rows": viewSize,
        "start": viewSize * viewIndex,
        "group": true,
        "group.field": "orderId",
        "group.limit": 10000,
        "group.ngroups": true,
        "q.op": "AND"
      } as any,
      "query": "*:*",
      "filter": ["docType: ORDER", "orderTypeId: SALES_ORDER"]
    }
  } as any

  if (query.fetchFacets) {
    payload.json["facet"] = {
      "productStoreIdFacet": {
        "excludeTags": "orderLookupFilter",
        "field": "productStoreName",
        "mincount": 1,
        "limit": -1,
        "type": "terms",
        "facet": {
          "groups": "unique(orderId)"
        }
      },
      "facilityNameFacet":{
        "excludeTags":"orderLookupFilter",
        "field":"facilityName",
        "mincount":1,
        "limit":-1,
        "type":"terms",
        "facet":{
          "groups":"unique(orderId)"
        }
      },
      "salesChannelDescFacet": {
        "excludeTags": "orderLookupFilter",
        "field": "salesChannelDesc",
        "mincount": 1,
        "limit": -1,
        "type": "terms",
        "facet": {
          "groups": "unique(orderId)"
        }
      },
      "orderStatusDescFacet": {
        "excludeTags": "orderLookupFilter",
        "field": "orderStatusDesc",
        "mincount": 1,
        "limit": -1,
        "sort": {
          "statusSeqId": "asc"
        },
        "type": "terms",
        "facet": {
          "groups": "unique(orderId)",
          "statusSeqId": "max(statusSeqId)"
        }
      },
    }
  }


  if (query.queryString) {
    payload.json.params.defType = "edismax"
    payload.json.params.qf = "orderName orderId customerPartyName productId internalName parentProductName"
    payload.json.query = `*${query.queryString}*`
  }

  // updating the filter value in json object as per the filters selected
  const shipmentMethodMapping: any = {
    storePickup: "STOREPICKUP",
    shipFromStore: "STANDARD"
  }

  const shipmentMethodTypeIdValues = Object.keys(shipmentMethodMapping)
    .filter((key: string) => query[key])
    .map((key: string) => shipmentMethodMapping[key])

  if (shipmentMethodTypeIdValues.length) {
    payload.json.filter.push(`{!tag=orderLookupFilter}shipmentMethodTypeId: (${shipmentMethodTypeIdValues.join(" OR ")})`)
  }

  const arrayFilterMapping: any = {
    facility: "facilityName",
    productStore: "productStoreName",
    channel: "salesChannelDesc",
    status: "orderStatusDesc"
  }

  Object.entries(arrayFilterMapping).forEach(([queryField, solrField]: any) => {
    if (query[queryField]?.length) {
      payload.json.filter.push(`{!tag=orderLookupFilter}${solrField}: ("${query[queryField].join('" OR "')}")`)
    }
  })

  if (query.date && query.date !== "custom") {
    payload.json.filter.push(`{!tag=orderLookupFilter}orderDate: [${query.date}]`)
  } else {
    let dateFilter = ""

    if (query.fromDate) dateFilter += query.fromDate.split("T")[0] + "T00:00:00Z"

    // Added T23:59:59, as we need to include the orders for to date as well
    if (query.toDate) dateFilter += ` TO ${query.toDate.split("T")[0]}` + "T23:59:59Z"
    else if (query.fromDate) dateFilter += " TO *"

    if (dateFilter) {
      payload.json.filter.push(`{!tag=orderLookupFilter}orderDate: [${dateFilter}]`)
    }
  }


  return payload
}

enum OPERATOR {
  AND = 'AND',
  BETWEEN = 'between',
  CONTAINS = 'contains',
  EQUALS = 'equals',
  GREATER_THAN = 'greaterThan',
  GREATER_THAN_EQUAL_TO = 'greaterThanEqualTo',
  IN = 'in',
  LESS_THAN = 'lessThan',
  LESS_THAN_EQUAL_TO = 'lessThanEqualTo',
  LIKE = 'like',
  NOT = 'not',
  NOT_EMPTY = 'not-empty',
  NOT_EQUAL = 'notEqual',
  NOT_LIKE = 'notLike',
  OR = 'OR',
}


async function runSolrQuery(payload: any): Promise<any> {
  return await api({
    url: "admin/runSolrQuery",
    method: "post",
    data: payload
  }) as any;
}

async function searchProducts(params: { keyword?: string, sort?: string, qf?: string, viewSize?: number, viewIndex?: number, filters?: any }): Promise<any> {
  const rows = params.viewSize ?? 100
  const start = rows * (params.viewIndex ?? 0)
  const keyword = params.keyword?.trim();

  const payload = {
    "json": {
      "params": {
        rows,
        start,
        "qf": "productId^20 productName^40 internalName^30 search_goodIdentifications parentProductName",
        "sort": "sort_productName asc",
        "defType": "edismax"
      },
      "query": "*:*",
      "filter": "docType: PRODUCT"
    }
  }

  let keywordString = ""

  if (keyword) {
    // When the searched keyword startWith \", we will consider that user want to make an exact search
    // otherwise we will tokenize the keyword
    if (keyword.startsWith('\"')) {
      // Using multiple replace function as replaceAll does not work due to module type
      keywordString = keyword.replace('\"', "").replace('\"', "");
    } else {
      // create string in the format, abc* OR xyz* or qwe*
      const keywordTokens = keyword.split(" ")
      const tokens: Array<string> = []

      keywordTokens.forEach((token: string) => {
        const regEx = /[`!@#$%^&*()_+\-=\\|,.<>?~]/
        if (regEx.test(token)) {
          const matchedTokens = [...new Set(token.match(regEx))]
          matchedTokens?.forEach((matchedToken: string) => {
            tokens.push(token.split(matchedToken).join(`\\\\${matchedToken}`))
          })
        } else {
          tokens.push(token)
        }
      })

      keywordString = tokens.join(`* ${OPERATOR.OR} `)
      // adding the original searched string with
      keywordString += `* ${OPERATOR.OR} \"${keyword}\"^100`
    }

    if (keywordString) {
      payload.json.query = `(${keywordString})`
    }
  } else {
    params.qf && (payload.json.params.qf = params.qf)
    params.sort && (payload.json.params.sort = params.sort)
  }

  if (params.filters) {
    Object.keys(params.filters).forEach((key: any) => {
      const filterValue = params.filters[key].value;

      if (Array.isArray(filterValue)) {
        const filterOperator = params.filters[key].op ? params.filters[key].op : OPERATOR.OR;
        payload.json.filter += ` ${OPERATOR.AND} ${key}: (${filterValue.join(' ' + filterOperator + ' ')})`
      } else {
        payload.json.filter += ` ${OPERATOR.AND} ${key}: ${filterValue}`
      }
    })
  }

  if (!params.filters?.isVirtual) {
    payload.json.filter += ` ${OPERATOR.AND} isVirtual: false`
  }

  try {
    const resp = await api({
      url: "admin/runSolrQuery",
      method: "post",
      data: payload
    }) as any;

    if (resp.status == 200 && !commonUtil.hasError(resp) && resp.data?.response?.numFound > 0) {

      const product = resp.data.response.docs

      return {
        products: product,
        total: resp.data.response.numFound
      }
    } else {
      return {
        products: {},
        total: 0
      }
    }
  } catch (err) {
    return Promise.reject({
      code: 'error',
      message: 'Something went wrong',
      serverResponse: err
    })
  }
}

export function useSolrSearch() {
  return {
    escapeSolrSpecialChars,
    prepareOrderLookupQuery,
    prepareOrderQuery,
    prepareSolrQuery,
    runSolrQuery,
    searchProducts
  }
} 